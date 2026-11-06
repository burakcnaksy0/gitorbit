/// GitHub service — device-flow OAuth, multi-account management, and repository API.
///
/// # Security invariants (enforced by design)
/// - No token/secret is ever passed to the frontend, written to SQLite, or logged.
/// - `device_code` from GitHub stays inside `PendingDeviceFlow` in memory only.
/// - The session_token returned to the frontend is NOT a cryptographic secret;
///   it's an opaque correlation ID valid for a single device-flow session.
/// - OS credential store (`CredentialStore` trait) is the sole token persistence layer.
/// - `OsCredentialStore` returns CREDENTIAL_STORE_UNAVAILABLE if the OS keyring is
///   inaccessible; plaintext fallback is forbidden.
/// - Duplicate logins (same provider_user_id) update the existing DB row; no duplicate rows.
///
/// # GitHub Device Flow (RFC 8628)
/// Preferred for desktop public clients because it requires no `client_secret`.
/// The `client_id` is NOT a secret and may be embedded in the binary.
///
/// Flow:
/// 1. `begin_device_flow` → POST /login/device/code → return `DeviceFlowSession` to UI.
/// 2. UI shows `user_code`, opens `verification_uri` in the browser.
/// 3. UI polls `poll_device_flow(session_token)` every `interval` seconds.
/// 4. When authorised: token stored in OS keyring, account upserted to DB.
use crate::credential_store::CredentialStore;
use crate::db::Database;
use crate::db::github_accounts::GitHubAccountDao;
use crate::errors::CommandError;
use crate::models::{
    DeviceFlowSession, GitHubAccount, GitHubConnectionStatus, GitHubCreatedRepo, GitHubProfile,
    GitHubRepo, GitHubRepoPage, PollResult,
};
use chrono::Utc;
use serde::Deserialize;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// GitHub client_id configuration
// OAuth App with Device Flow enabled (public client — no client secret).
// Per RFC 8628 the client_id is NOT a secret and may ship in the binary.
// Override at launch with GITORBIT_GITHUB_CLIENT_ID (e.g. for forks/custom
// OAuth app registrations).
// ---------------------------------------------------------------------------

const DEFAULT_GITHUB_CLIENT_ID: &str = "Ov23liE5su3QknwkABnY";

fn github_client_id() -> String {
    std::env::var("GITORBIT_GITHUB_CLIENT_ID")
        .unwrap_or_else(|_| DEFAULT_GITHUB_CLIENT_ID.to_string())
}

const GITHUB_OAUTH_SCOPE: &str = "read:user,public_repo";

// ---------------------------------------------------------------------------
// HTTP client trait — enables mocking in tests
// ---------------------------------------------------------------------------

/// Low-level GitHub API calls.  The trait boundary allows tests to inject a
/// deterministic mock without any real HTTP traffic.
pub trait GitHubHttpClient: Send + Sync {
    fn begin_device_flow(
        &self,
        client_id: &str,
        scope: &str,
    ) -> Result<RawDeviceFlowResponse, CommandError>;

    fn poll_device_token(
        &self,
        client_id: &str,
        device_code: &str,
    ) -> Result<RawPollResponse, CommandError>;

    fn get_authenticated_user(&self, token: &str) -> Result<RawUserResponse, CommandError>;

    fn list_repos(
        &self,
        token: &str,
        page: u32,
        per_page: u32,
    ) -> Result<Vec<RawRepoResponse>, CommandError>;

    /// Creates a new repository owned by the authenticated user
    /// (`POST /user/repos`).
    fn create_repo(
        &self,
        token: &str,
        name: &str,
        description: Option<&str>,
        private: bool,
    ) -> Result<RawCreatedRepo, CommandError>;
}

// ---------------------------------------------------------------------------
// Raw API response types (private; not exposed to frontend)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct RawDeviceFlowResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

/// GitHub's device-flow poll can return success or an error payload.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum RawPollResponse {
    Success {
        access_token: String,
        token_type: String,
        scope: String,
    },
    Pending {
        error: String,
        error_description: Option<String>,
    },
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct RawUserResponse {
    #[serde(default)]
    pub id: i64,
    #[serde(default)]
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    /// Profile overview fields — all optional so older/partial payloads and
    /// test fixtures keep deserialising.
    #[serde(default)]
    pub bio: Option<String>,
    #[serde(default)]
    pub html_url: Option<String>,
    #[serde(default)]
    pub company: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub public_repos: Option<i64>,
    #[serde(default)]
    pub followers: Option<i64>,
    #[serde(default)]
    pub following: Option<i64>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RawRepoResponse {
    pub id: i64,
    pub name: String,
    pub full_name: String,
    pub description: Option<String>,
    pub clone_url: String,
    pub ssh_url: String,
    pub html_url: String,
    pub private: bool,
    pub fork: bool,
    pub default_branch: String,
    pub language: Option<String>,
    pub stargazers_count: i64,
    pub visibility: Option<String>,
    pub owner: RawOwner,
}

#[derive(Debug, Deserialize)]
pub struct RawOwner {
    pub login: String,
}

/// Response of `POST /user/repos` (subset we need).
#[derive(Debug, Clone, Deserialize)]
pub struct RawCreatedRepo {
    pub full_name: String,
    pub html_url: String,
    pub clone_url: String,
    #[serde(default)]
    pub ssh_url: String,
    #[serde(default)]
    pub private: bool,
}

// ---------------------------------------------------------------------------
// Real HTTP client using ureq v2
// ---------------------------------------------------------------------------

pub struct RealGitHubHttpClient;

/// Map a `ureq::Error` to a typed `CommandError`.
/// Special-cases rate-limit 403 vs permission 403.
fn map_ureq_error(e: ureq::Error) -> CommandError {
    match e {
        ureq::Error::Status(401, _) => {
            CommandError::auth_required("GitHub kimlik doğrulaması gerekiyor (401).")
        }
        ureq::Error::Status(403, ref resp) => {
            // Rate-limit 403 has X-RateLimit-Remaining: 0
            let remaining = resp.header("X-RateLimit-Remaining");
            if remaining == Some("0") {
                let reset = resp
                    .header("X-RateLimit-Reset")
                    .unwrap_or("bilinmiyor")
                    .to_string();
                CommandError::rate_limited(format!(
                    "GitHub API rate limit aşıldı. Sıfırlanma zamanı: {} (Unix timestamp).",
                    reset
                ))
            } else {
                CommandError::permission_denied(
                    "GitHub API isteği reddedildi (403). Kapsam/izin yetersiz olabilir.",
                )
            }
        }
        ureq::Error::Status(404, _) => {
            CommandError::github_api_error(404, "Kaynak bulunamadı veya erişim izniniz yok (404).")
        }
        ureq::Error::Status(422, _) => {
            CommandError::github_api_error(422, "İstek doğrulama hatası (422).")
        }
        ureq::Error::Status(code, _) if code >= 500 => CommandError::github_api_error(
            code,
            format!(
                "GitHub sunucu hatası ({}). Daha sonra tekrar deneyin.",
                code
            ),
        ),
        ureq::Error::Status(code, _) => {
            CommandError::github_api_error(code, format!("GitHub API hatası ({}).", code))
        }
        ureq::Error::Transport(t) => CommandError::network_error(format!("Ağ hatası: {}", t)),
    }
}

impl GitHubHttpClient for RealGitHubHttpClient {
    fn begin_device_flow(
        &self,
        client_id: &str,
        scope: &str,
    ) -> Result<RawDeviceFlowResponse, CommandError> {
        let resp = ureq::post("https://github.com/login/device/code")
            .set("Accept", "application/json")
            .set("User-Agent", "GitOrbit/0.1")
            .send_form(&[("client_id", client_id), ("scope", scope)])
            .map_err(map_ureq_error)?;

        resp.into_json::<RawDeviceFlowResponse>().map_err(|e| {
            CommandError::network_error(format!("Device flow yanıtı işlenemedi: {}", e))
        })
    }

    fn poll_device_token(
        &self,
        client_id: &str,
        device_code: &str,
    ) -> Result<RawPollResponse, CommandError> {
        let resp = ureq::post("https://github.com/login/oauth/access_token")
            .set("Accept", "application/json")
            .set("User-Agent", "GitOrbit/0.1")
            .send_form(&[
                ("client_id", client_id),
                ("device_code", device_code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .map_err(map_ureq_error)?;

        resp.into_json::<RawPollResponse>().map_err(|e| {
            CommandError::network_error(format!("Token poll yanıtı işlenemedi: {}", e))
        })
    }

    fn get_authenticated_user(&self, token: &str) -> Result<RawUserResponse, CommandError> {
        let resp = ureq::get("https://api.github.com/user")
            .set("Authorization", &format!("Bearer {}", token))
            .set("Accept", "application/vnd.github+json")
            .set("X-GitHub-Api-Version", "2022-11-28")
            .set("User-Agent", "GitOrbit/0.1")
            .call()
            .map_err(map_ureq_error)?;

        resp.into_json::<RawUserResponse>().map_err(|e| {
            CommandError::network_error(format!("Kullanıcı bilgisi işlenemedi: {}", e))
        })
    }

    fn list_repos(
        &self,
        token: &str,
        page: u32,
        per_page: u32,
    ) -> Result<Vec<RawRepoResponse>, CommandError> {
        let url = format!(
            "https://api.github.com/user/repos?page={}&per_page={}&sort=updated&affiliation=owner,collaborator,organization_member",
            page, per_page
        );
        let resp = ureq::get(&url)
            .set("Authorization", &format!("Bearer {}", token))
            .set("Accept", "application/vnd.github+json")
            .set("X-GitHub-Api-Version", "2022-11-28")
            .set("User-Agent", "GitOrbit/0.1")
            .call()
            .map_err(map_ureq_error)?;

        resp.into_json::<Vec<RawRepoResponse>>()
            .map_err(|e| CommandError::network_error(format!("Repo listesi işlenemedi: {}", e)))
    }

    fn create_repo(
        &self,
        token: &str,
        name: &str,
        description: Option<&str>,
        private: bool,
    ) -> Result<RawCreatedRepo, CommandError> {
        let body = serde_json::json!({
            "name": name,
            "description": description.unwrap_or(""),
            "private": private,
            "auto_init": false,
            "has_issues": true,
            "has_wiki": false,
        });

        let resp = ureq::post("https://api.github.com/user/repos")
            .set("Authorization", &format!("Bearer {}", token))
            .set("Accept", "application/vnd.github+json")
            .set("X-GitHub-Api-Version", "2022-11-28")
            .set("User-Agent", "GitOrbit/0.1")
            .send_json(body)
            .map_err(map_ureq_error)?;

        resp.into_json::<RawCreatedRepo>().map_err(|e| {
            CommandError::network_error(format!("Repo oluşturma yanıtı işlenemedi: {}", e))
        })
    }
}

// ---------------------------------------------------------------------------
// Pending device-flow session (kept in Rust memory, never sent to frontend)
// ---------------------------------------------------------------------------

/// In-progress device-flow session.  The `device_code` MUST NOT be exposed to
/// the frontend or logged.
pub struct PendingDeviceFlow {
    pub session_token: String,
    device_code: String, // PRIVATE — never exposed outside this module
    pub client_id: String,
    pub expires_at: Instant,
    pub poll_interval_secs: u64,
}

impl PendingDeviceFlow {
    pub fn device_code(&self) -> &str {
        &self.device_code
    }

    pub fn is_expired(&self) -> bool {
        Instant::now() >= self.expires_at
    }

    /// Test-only helper: return a copy of this pending flow with expiry in the past.
    #[cfg(any(test, feature = "test-support"))]
    pub fn make_expired_for_test(mut self) -> Self {
        self.expires_at = Instant::now() - Duration::from_secs(1);
        self
    }
}

// ---------------------------------------------------------------------------
// GitHubService
// ---------------------------------------------------------------------------

/// High-level GitHub operations composed from an HTTP client and a credential
/// store.  Both are injectable for testing.
pub struct GitHubService {
    client: Box<dyn GitHubHttpClient>,
    store: Box<dyn CredentialStore>,
}

impl GitHubService {
    pub fn new(client: Box<dyn GitHubHttpClient>, store: Box<dyn CredentialStore>) -> Self {
        Self { client, store }
    }

    /// Construct the production service using the real GitHub API and OS keyring.
    pub fn new_real() -> Self {
        Self::new(
            Box::new(RealGitHubHttpClient),
            Box::new(crate::credential_store::OsCredentialStore),
        )
    }

    // -----------------------------------------------------------------------
    // Device-flow OAuth
    // -----------------------------------------------------------------------

    /// Initiates a GitHub Device-Flow login.
    ///
    /// Returns a `(DeviceFlowSession, PendingDeviceFlow)` pair.
    /// - `DeviceFlowSession` is safe to send to the frontend (no secrets).
    /// - `PendingDeviceFlow` MUST be kept in Rust memory only.
    pub fn begin_device_flow(
        &self,
    ) -> Result<(DeviceFlowSession, PendingDeviceFlow), CommandError> {
        let client_id = github_client_id();
        let raw = self
            .client
            .begin_device_flow(&client_id, GITHUB_OAUTH_SCOPE)?;

        let session_token = Uuid::new_v4().to_string();
        let expires_at = Instant::now() + Duration::from_secs(raw.expires_in);

        let session = DeviceFlowSession {
            session_token: session_token.clone(),
            user_code: raw.user_code,
            verification_uri: raw.verification_uri,
            expires_in: raw.expires_in,
            interval: raw.interval,
        };

        let pending = PendingDeviceFlow {
            session_token,
            device_code: raw.device_code, // stays server-side
            client_id,
            expires_at,
            poll_interval_secs: raw.interval,
        };

        Ok((session, pending))
    }

    /// Polls the device-flow once with the given session token.
    ///
    /// Returns:
    /// - `Ok(PollResult::Pending)` — user not yet authorised; try again after `interval` secs.
    /// - `Ok(PollResult::Success { account })` — authorised; account upserted in DB.
    /// - `Err(OAUTH_STATE_MISMATCH)` — `session_token` does not match `pending`.
    /// - `Err(DEVICE_FLOW_EXPIRED)` — the device code has expired.
    /// - `Err(AUTH_REQUIRED)` — user denied access.
    pub fn poll_device_flow(
        &self,
        db: &Database,
        pending: &PendingDeviceFlow,
        session_token: &str,
    ) -> Result<PollResult, CommandError> {
        // 1. Validate session token
        if pending.session_token != session_token {
            return Err(CommandError::oauth_state_mismatch(
                "OAuth oturum belirteci eşleşmiyor.",
            ));
        }

        // 2. Check expiry
        if pending.is_expired() {
            return Err(CommandError::device_flow_expired(
                "GitHub cihaz akışı süresi doldu. Lütfen tekrar başlatın.",
            ));
        }

        // 3. Poll GitHub
        let raw_poll = self
            .client
            .poll_device_token(&pending.client_id, pending.device_code())?;

        match raw_poll {
            RawPollResponse::Pending { error, .. } => match error.as_str() {
                "authorization_pending" | "slow_down" => Ok(PollResult::Pending),
                "access_denied" => Err(CommandError::auth_required(
                    "Kullanıcı GitHub erişimini reddetti.",
                )),
                "expired_token" => Err(CommandError::device_flow_expired(
                    "GitHub cihaz kodu süresi doldu.",
                )),
                other => Err(CommandError::new(
                    "DEVICE_FLOW_ERROR",
                    format!("Beklenmeyen device flow hatası: {}", other),
                    true,
                )),
            },
            RawPollResponse::Success { access_token, .. } => {
                // 4. Fetch user profile (token used here — never forwarded to frontend)
                let user = self.client.get_authenticated_user(&access_token)?;

                // 5. Build credential_ref = "github:{provider_user_id}"
                let credential_ref = format!("github:{}", user.id);

                // 6. Store token in OS credential store (NEVER in DB)
                self.store.set_credential(&credential_ref, &access_token)?;

                // 7. Upsert account in DB (no token in any field)
                let now = Utc::now().to_rfc3339();
                let account = db.with_conn(|conn| {
                    // Check for existing account (to reuse its id)
                    let existing =
                        GitHubAccountDao::find_by_provider_user_id(conn, &user.id.to_string())?;

                    let id = existing
                        .as_ref()
                        .map(|a| a.id.clone())
                        .unwrap_or_else(|| Uuid::new_v4().to_string());

                    let account = GitHubAccount {
                        id,
                        provider: "github".to_string(),
                        provider_user_id: user.id.to_string(),
                        login: user.login.clone(),
                        display_name: user.name.clone(),
                        avatar_url: user.avatar_url.clone(),
                        credential_ref: credential_ref.clone(),
                        connection_status: GitHubConnectionStatus::Connected,
                        created_at: existing
                            .as_ref()
                            .map(|a| a.created_at.clone())
                            .unwrap_or_else(|| now.clone()),
                        last_used_at: Some(now.clone()),
                    };

                    GitHubAccountDao::upsert(conn, &account)?;
                    Ok(account)
                })?;

                Ok(PollResult::Success {
                    account: Box::new(account),
                })
            }
        }
    }

    // -----------------------------------------------------------------------
    // Account management
    // -----------------------------------------------------------------------

    /// Lists all connected GitHub accounts (no token in any returned field).
    pub fn list_accounts(&self, db: &Database) -> Result<Vec<GitHubAccount>, CommandError> {
        db.with_conn(GitHubAccountDao::list)
    }

    /// Disconnects a GitHub account:
    /// 1. Deletes the token from the OS credential store.
    /// 2. Removes the account metadata from SQLite.
    ///
    /// Git credential helpers are NOT touched (per spec §6.2).
    pub fn disconnect_account(&self, db: &Database, account_id: &str) -> Result<(), CommandError> {
        // Look up the account to get its credential_ref
        let account = db
            .with_conn(|conn| GitHubAccountDao::get_by_id(conn, account_id))?
            .ok_or_else(|| {
                CommandError::new(
                    "ACCOUNT_NOT_FOUND",
                    format!("Hesap bulunamadı: {}", account_id),
                    false,
                )
            })?;

        // Delete from OS keyring first (idempotent even if already missing)
        self.store.delete_credential(&account.credential_ref)?;

        // Then remove the DB record
        db.with_conn(|conn| {
            GitHubAccountDao::remove(conn, account_id)?;
            Ok(())
        })?;

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Repository API
    // -----------------------------------------------------------------------

    /// Access token of a connected account (read from the OS keyring, held
    /// only in-process). Used by callers that must run git operations as this
    /// account — the token is never returned to the frontend or persisted.
    pub fn access_token(&self, db: &Database, account_id: &str) -> Result<String, CommandError> {
        let (_, token) = self.account_with_token(db, account_id)?;
        Ok(token)
    }

    /// Push kimliği çözümü: remote URL'sinin owner'ı hangi bağlı hesabın
    /// login'iyle eşleşiyorsa o hesabın token'ı döner. Eşleşme yoksa ya da
    /// keyring okunamazsa `Ok(None)` — push sistem kimliğiyle denenir.
    pub fn token_for_repo_owner(
        &self,
        db: &Database,
        owner: &str,
    ) -> Result<Option<String>, CommandError> {
        let accounts = db.with_conn(|conn| GitHubAccountDao::list(conn))?;
        let Some(account) = accounts
            .into_iter()
            .find(|a| a.login.eq_ignore_ascii_case(owner))
        else {
            return Ok(None);
        };
        Ok(self.account_with_token(db, &account.id).ok().map(|(_, t)| t))
    }

    /// Lists repositories for the given account with pagination.
    /// `page` is 1-indexed; `per_page` is clamped to 1–100.
    /// Loads the DB account record and its token from the OS credential store.
    /// Shared by `list_repos` and `get_account_profile`. The token is returned
    /// only for in-process use — never serialised to the frontend.
    fn account_with_token(
        &self,
        db: &Database,
        account_id: &str,
    ) -> Result<(crate::models::GitHubAccount, String), CommandError> {
        let account = db
            .with_conn(|conn| GitHubAccountDao::get_by_id(conn, account_id))?
            .ok_or_else(|| {
                CommandError::new(
                    "ACCOUNT_NOT_FOUND",
                    format!("Hesap bulunamadı: {}", account_id),
                    false,
                )
            })?;

        let token = self
            .store
            .get_credential(&account.credential_ref)
            .map_err(|e| {
                if e.code == "NO_CREDENTIAL" || e.code == "CREDENTIAL_STORE_UNAVAILABLE" {
                    CommandError::auth_expired(
                        "GitHub token bulunamadı. Lütfen hesabı tekrar bağlayın.",
                    )
                } else {
                    e
                }
            })?;

        Ok((account, token))
    }

    pub fn list_repos(
        &self,
        db: &Database,
        account_id: &str,
        page: u32,
        per_page: u32,
    ) -> Result<GitHubRepoPage, CommandError> {
        let per_page = per_page.clamp(1, 100);
        let page = page.max(1);

        // Token retrieved here only for this request — never stored or forwarded
        let (_account, token) = self.account_with_token(db, account_id)?;

        let raw_repos = self.client.list_repos(&token, page, per_page)?;

        // Touch last_used_at on successful API call
        let _ = db.with_conn(|conn| GitHubAccountDao::touch_last_used(conn, account_id));

        let has_more = raw_repos.len() as u32 == per_page;

        let repos = raw_repos
            .into_iter()
            .map(|r| GitHubRepo {
                id: r.id,
                name: r.name,
                full_name: r.full_name,
                description: r.description,
                clone_url: r.clone_url,
                ssh_url: r.ssh_url,
                html_url: r.html_url,
                private: r.private,
                fork: r.fork,
                default_branch: r.default_branch,
                language: r.language,
                stargazers_count: r.stargazers_count,
                visibility: r.visibility.unwrap_or_else(|| "public".to_string()),
                owner_login: r.owner.login,
            })
            .collect();

        Ok(GitHubRepoPage {
            repos,
            page,
            per_page,
            has_more,
        })
    }

    /// Creates a new repository for the connected account on GitHub and
    /// returns its public metadata. The token stays inside this call.
    pub fn create_remote_repo(
        &self,
        db: &Database,
        account_id: &str,
        name: &str,
        description: Option<&str>,
        private: bool,
    ) -> Result<GitHubCreatedRepo, CommandError> {
        let name = name.trim();
        let valid = !name.is_empty()
            && name.len() <= 100
            && !name.starts_with('.')
            && !name.starts_with('-')
            && !name.ends_with('.')
            && name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
        if !valid {
            return Err(CommandError::new(
                "REPO_NAME_INVALID",
                "Depo adı boş olamaz ve yalnızca harf, rakam, '-', '_', '.' içerebilir (en fazla 100 karakter).",
                false,
            ));
        }

        let (account, token) = self.account_with_token(db, account_id)?;
        let created = self
            .client
            .create_repo(&token, name, description, private)?;

        let _ = db.with_conn(|conn| GitHubAccountDao::touch_last_used(conn, account_id));

        // Çoklu SSH hesabı: hesap login'i için bir host alias tanımlıysa
        // origin SSH adresi alias'lı kurulumla eşleşir (~/.ssh/config).
        let ssh_remote = ssh_host_alias(&account.login)
            .and_then(|alias| ssh_url_with_alias(&created.ssh_url, &alias));

        Ok(GitHubCreatedRepo {
            full_name: created.full_name,
            html_url: created.html_url,
            clone_url: created.clone_url,
            private: created.private,
            ssh_remote,
        })
    }

    /// Fetches the live public profile/overview for a connected account
    /// (`GET /user`). The token is retrieved from the OS credential store for
    /// this single request and is never returned or logged.
    pub fn get_account_profile(
        &self,
        db: &Database,
        account_id: &str,
    ) -> Result<GitHubProfile, CommandError> {
        let (account, token) = self.account_with_token(db, account_id)?;

        let user = self.client.get_authenticated_user(&token)?;

        // Touch last_used_at on successful API call
        let _ = db.with_conn(|conn| GitHubAccountDao::touch_last_used(conn, &account.id));

        let html_url = user
            .html_url
            .unwrap_or_else(|| format!("https://github.com/{}", user.login));

        Ok(GitHubProfile {
            login: user.login,
            name: user.name,
            avatar_url: user.avatar_url,
            bio: user.bio,
            html_url,
            company: user.company,
            location: user.location,
            public_repos: user.public_repos.unwrap_or(0),
            followers: user.followers.unwrap_or(0),
            following: user.following.unwrap_or(0),
            created_at: user.created_at,
        })
    }
}

// ---------------------------------------------------------------------------
// Çoklu SSH hesabı — host alias eşlemesi
// ---------------------------------------------------------------------------

/// Optional user mapping: GitHub login -> SSH host alias defined in
/// `~/.ssh/config`. Read from `~/.config/gitorbit/ssh_hosts.toml` with one
/// `login = "alias"` pair per line (`#` starts a comment). Missing file or
/// missing entry simply means "no SSH preference for this account".
pub fn ssh_host_alias(login: &str) -> Option<String> {
    let config_dir = match std::env::var("XDG_CONFIG_HOME") {
        Ok(v) if !v.is_empty() => Some(PathBuf::from(v)),
        _ => std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .ok()
            .map(|home| {
                #[cfg(windows)]
                {
                    if let Ok(appdata) = std::env::var("APPDATA") {
                        return PathBuf::from(appdata);
                    }
                }
                PathBuf::from(home).join(".config")
            }),
    }?;
    let path = config_dir.join("gitorbit").join("ssh_hosts.toml");
    let content = std::fs::read_to_string(path).ok()?;
    parse_ssh_hosts(&content, login)
}

/// Pure parser for the `ssh_hosts.toml` mapping (unit-testable).
fn parse_ssh_hosts(content: &str, login: &str) -> Option<String> {
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim().trim_matches('"').trim_matches('\'');
        let value = value
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .trim_end_matches(',');
        if key.eq_ignore_ascii_case(login) && !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

/// Rewrites a standard GitHub SSH clone URL (`git@github.com:owner/repo.git`)
/// to use the user's host alias (`git@github-alt:owner/repo.git`).
/// Returns `None` for empty or non-github.com URLs.
fn ssh_url_with_alias(ssh_url: &str, alias: &str) -> Option<String> {
    let rest = ssh_url.strip_prefix("git@github.com:")?;
    if rest.is_empty() || alias.is_empty() {
        return None;
    }
    Some(format!("git@{}:{}", alias, rest))
}

#[cfg(test)]
mod ssh_alias_tests {
    use super::{parse_ssh_hosts, ssh_url_with_alias};

    const SAMPLE: &str = r#"
# GitHub login -> ~/.ssh/config Host alias
burakcnaksy0 = "github.com"
diger-hesap  = 'github-alt'
"#;

    #[test]
    fn parses_quoted_pairs_and_skips_comments() {
        assert_eq!(
            parse_ssh_hosts(SAMPLE, "diger-hesap").as_deref(),
            Some("github-alt")
        );
        assert_eq!(
            parse_ssh_hosts(SAMPLE, "BURAKCNAKSY0").as_deref(),
            Some("github.com")
        );
        assert_eq!(parse_ssh_hosts(SAMPLE, "olmayan-hesap"), None);
    }

    #[test]
    fn rewrites_github_host_to_alias() {
        assert_eq!(
            ssh_url_with_alias("git@github.com:acme/repo.git", "github-alt").as_deref(),
            Some("git@github-alt:acme/repo.git")
        );
        assert_eq!(ssh_url_with_alias("", "github-alt"), None);
        assert_eq!(
            ssh_url_with_alias("git@gitlab.com:acme/repo.git", "github-alt"),
            None
        );
        assert_eq!(ssh_url_with_alias("git@github.com:", "github-alt"), None);
    }
}
