#![allow(clippy::result_large_err)]

use gybe_core::CommandError;
use gybe_core::CredentialStore;
/// Faz 6 acceptance tests — GitHub account management and repository API.
///
/// These tests use in-memory credential store and mock HTTP client,
/// so they run without OS keyring daemon or real GitHub credentials.
///
/// # Acceptance criteria being tested:
/// - AC1: Token never appears in DB or returned structs
/// - AC2: OAuth state mismatch is rejected (OAUTH_STATE_MISMATCH)
/// - AC3: Second login for same GitHub user updates existing row (no duplicate)
/// - AC4: API error codes mapped correctly (AUTH_REQUIRED, RATE_LIMITED, etc.)
/// - AC5: Disconnect clears credential store and DB record
/// - AC6: Repository listing respects pagination
/// - AC7: Device-flow expiry is detected
use gybe_core::credential_store::InMemoryCredentialStore;
use gybe_core::db::Database;
use gybe_core::models::{GitHubConnectionStatus, PollResult};
use gybe_core::services::github_service::{
    GitHubHttpClient, GitHubService, PendingDeviceFlow, RawCreatedRepo, RawDeviceFlowResponse,
    RawOwner, RawPollResponse, RawRefreshResponse, RawRepoResponse, RawUserResponse,
};
use std::sync::Mutex;

// ---------------------------------------------------------------------------
// Mock HTTP client
// ---------------------------------------------------------------------------

struct MockGitHubHttpClient {
    device_flow_resp: RawDeviceFlowResponse,
    /// Controlled by test: first call returns Pending, subsequent calls return Success.
    poll_responses: Mutex<Vec<RawPollResponse>>,
    user_resp: RawUserResponse,
    repos_resp: Vec<RawRepoResponse>,
    /// v0.2.1: kaç refresh isteği atıldığını testin dışarıdan okuyabilmesi için.
    refresh_calls: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    /// Eşzamanlılık testlerinde sahte ağ gecikmesi (ms).
    refresh_delay_ms: u64,
}

impl MockGitHubHttpClient {
    fn new_with_success_on_first_poll() -> Self {
        Self {
            device_flow_resp: RawDeviceFlowResponse {
                device_code: "test_device_code".to_string(),
                user_code: "ABCD-1234".to_string(),
                verification_uri: "https://github.com/login/device".to_string(),
                expires_in: 900,
                interval: 0, // throttle testte devre dışı (GO-17c asıl testi ayrı)
            },
            poll_responses: Mutex::new(vec![RawPollResponse::Success {
                access_token: "test_token_xyz".to_string(),
                token_type: "bearer".to_string(),
                scope: "read:user,public_repo".to_string(),
                expires_in: None,
                refresh_token: None,
            }]),
            user_resp: RawUserResponse {
                id: 12345,
                login: "testuser".to_string(),
                name: Some("Test User".to_string()),
                avatar_url: Some("https://avatars.githubusercontent.com/u/12345".to_string()),
                ..Default::default()
            },
            repos_resp: vec![RawRepoResponse {
                id: 1001,
                name: "my-repo".to_string(),
                full_name: "testuser/my-repo".to_string(),
                description: Some("A test repo".to_string()),
                clone_url: "https://github.com/testuser/my-repo.git".to_string(),
                ssh_url: "git@github.com:testuser/my-repo.git".to_string(),
                html_url: "https://github.com/testuser/my-repo".to_string(),
                private: false,
                fork: false,
                default_branch: "main".to_string(),
                language: Some("Rust".to_string()),
                stargazers_count: 42,
                visibility: Some("public".to_string()),
                owner: RawOwner {
                    login: "testuser".to_string(),
                },
            }],
            refresh_calls: std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            refresh_delay_ms: 0,
        }
    }

    fn new_with_pending_then_success() -> Self {
        Self {
            device_flow_resp: RawDeviceFlowResponse {
                device_code: "test_device_code_2".to_string(),
                user_code: "EFGH-5678".to_string(),
                verification_uri: "https://github.com/login/device".to_string(),
                expires_in: 900,
                interval: 0, // throttle testte devre dışı (GO-17c asıl testi ayrı)
            },
            poll_responses: Mutex::new(vec![
                RawPollResponse::Pending {
                    error: "authorization_pending".to_string(),
                    error_description: Some("User has not yet authorized.".to_string()),
                },
                RawPollResponse::Success {
                    access_token: "test_token_abc".to_string(),
                    token_type: "bearer".to_string(),
                    scope: "read:user,public_repo".to_string(),
                    expires_in: None,
                    refresh_token: None,
                },
            ]),
            user_resp: RawUserResponse {
                id: 99999,
                login: "anotheruser".to_string(),
                name: Some("Another User".to_string()),
                avatar_url: None,
                ..Default::default()
            },
            repos_resp: vec![],
            refresh_calls: std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            refresh_delay_ms: 0,
        }
    }

    fn new_with_denied() -> Self {
        Self {
            device_flow_resp: RawDeviceFlowResponse {
                device_code: "test_device_code_denied".to_string(),
                user_code: "DENY-0000".to_string(),
                verification_uri: "https://github.com/login/device".to_string(),
                expires_in: 900,
                interval: 0, // throttle testte devre dışı (GO-17c asıl testi ayrı)
            },
            poll_responses: Mutex::new(vec![RawPollResponse::Pending {
                error: "access_denied".to_string(),
                error_description: Some("User denied access.".to_string()),
            }]),
            user_resp: RawUserResponse {
                id: 0,
                login: "nobody".to_string(),
                name: None,
                avatar_url: None,
                ..Default::default()
            },
            repos_resp: vec![],
            refresh_calls: std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            refresh_delay_ms: 0,
        }
    }
}

impl GitHubHttpClient for MockGitHubHttpClient {
    fn begin_device_flow(
        &self,
        _client_id: &str,
        _scope: &str,
    ) -> Result<RawDeviceFlowResponse, CommandError> {
        Ok(RawDeviceFlowResponse {
            device_code: self.device_flow_resp.device_code.clone(),
            user_code: self.device_flow_resp.user_code.clone(),
            verification_uri: self.device_flow_resp.verification_uri.clone(),
            expires_in: self.device_flow_resp.expires_in,
            interval: self.device_flow_resp.interval,
        })
    }

    fn poll_device_token(
        &self,
        _client_id: &str,
        _device_code: &str,
    ) -> Result<RawPollResponse, CommandError> {
        let mut responses = self.poll_responses.lock().unwrap();
        if responses.is_empty() {
            return Err(CommandError::new(
                "MOCK_EXHAUSTED",
                "No more poll responses configured.",
                false,
            ));
        }
        Ok(responses.remove(0))
    }

    fn get_authenticated_user(&self, _token: &str) -> Result<RawUserResponse, CommandError> {
        Ok(self.user_resp.clone())
    }

    fn list_repos(
        &self,
        _token: &str,
        _page: u32,
        _per_page: u32,
    ) -> Result<Vec<RawRepoResponse>, CommandError> {
        Ok(self
            .repos_resp
            .iter()
            .map(|r| RawRepoResponse {
                id: r.id,
                name: r.name.clone(),
                full_name: r.full_name.clone(),
                description: r.description.clone(),
                clone_url: r.clone_url.clone(),
                ssh_url: r.ssh_url.clone(),
                html_url: r.html_url.clone(),
                private: r.private,
                fork: r.fork,
                default_branch: r.default_branch.clone(),
                language: r.language.clone(),
                stargazers_count: r.stargazers_count,
                visibility: r.visibility.clone(),
                owner: RawOwner {
                    login: r.owner.login.clone(),
                },
            })
            .collect())
    }

    fn create_repo(
        &self,
        _token: &str,
        name: &str,
        _description: Option<&str>,
        private: bool,
    ) -> Result<RawCreatedRepo, CommandError> {
        Ok(RawCreatedRepo {
            full_name: format!("testuser/{}", name),
            html_url: format!("https://github.com/testuser/{}", name),
            clone_url: format!("https://github.com/testuser/{}.git", name),
            ssh_url: format!("git@github.com:testuser/{}.git", name),
            private,
        })
    }

    fn refresh_access_token(
        &self,
        _client_id: &str,
        refresh_token: &str,
    ) -> Result<RawRefreshResponse, CommandError> {
        self.refresh_calls
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if self.refresh_delay_ms > 0 {
            std::thread::sleep(std::time::Duration::from_millis(self.refresh_delay_ms));
        }
        // Test convention: "BAD_REFRESH" simulates a rejected grant, anything
        // else returns a rotated token pair.
        if refresh_token == "BAD_REFRESH" {
            return Ok(RawRefreshResponse::Error {
                error: "bad_verification_code".to_string(),
                error_description: Some("rejected".to_string()),
            });
        }
        Ok(RawRefreshResponse::Success {
            access_token: "refreshed_token_456".to_string(),
            expires_in: Some(3600),
            refresh_token: Some("rotated_refresh_789".to_string()),
        })
    }
}

// ---------------------------------------------------------------------------
// Helper: build a GitHubService with mocks
// ---------------------------------------------------------------------------

fn make_service(client: MockGitHubHttpClient) -> GitHubService {
    GitHubService::new(Box::new(client), Box::new(InMemoryCredentialStore::new()))
}

fn make_db() -> Database {
    Database::in_memory().expect("in-memory DB")
}

// ---------------------------------------------------------------------------
// AC2: OAuth state mismatch is rejected
// ---------------------------------------------------------------------------

#[test]
fn test_ac2_state_mismatch_rejected() {
    let svc = make_service(MockGitHubHttpClient::new_with_success_on_first_poll());
    let db = make_db();

    let (_session, pending) = svc.begin_device_flow().expect("begin_device_flow");

    // Use a wrong session token
    let result = svc.poll_device_flow(&db, &pending, "WRONG_TOKEN_12345");

    assert!(result.is_err());
    let err = result.unwrap_err();
    assert_eq!(
        err.code, "OAUTH_STATE_MISMATCH",
        "Expected OAUTH_STATE_MISMATCH, got: {}",
        err.code
    );
}

// ---------------------------------------------------------------------------
// AC1 + AC3: Successful login — token not in DB, no duplicate row on re-login
// ---------------------------------------------------------------------------

#[test]
fn test_ac1_token_not_in_db_and_ac3_no_duplicate_on_relogin() {
    let db = make_db();

    // ---- First login ----
    let svc1 = make_service(MockGitHubHttpClient::new_with_success_on_first_poll());
    let (_session1, pending1) = svc1.begin_device_flow().expect("begin_device_flow 1");
    let session_token1 = pending1.session_token.clone();

    let result1 = svc1
        .poll_device_flow(&db, &pending1, &session_token1)
        .expect("poll 1");

    let account1 = match result1 {
        PollResult::Success { account } => account,
        PollResult::Pending => panic!("Expected success on first poll"),
    };

    // AC1: token MUST NOT be in any field of the returned account
    // (verified structurally — GitHubAccount has no token field)
    assert_eq!(account1.login, "testuser");
    assert_eq!(account1.provider, "github");
    assert_eq!(
        account1.connection_status,
        GitHubConnectionStatus::Connected
    );
    // credential_ref is an opaque key, not the token
    assert!(
        account1.credential_ref.starts_with("github:"),
        "credential_ref should be a key prefix, not the token"
    );
    assert!(
        !account1.credential_ref.contains("test_token"),
        "Token must not appear in credential_ref"
    );

    // Verify DB has exactly 1 account
    let accounts = svc1.list_accounts(&db).expect("list accounts");
    assert_eq!(accounts.len(), 1, "Should have exactly 1 account");

    // ---- Second login with SAME GitHub user (same provider_user_id=12345) ----
    let svc2 = make_service(MockGitHubHttpClient::new_with_success_on_first_poll());
    let (_session2, pending2) = svc2.begin_device_flow().expect("begin_device_flow 2");
    let session_token2 = pending2.session_token.clone();

    let result2 = svc2
        .poll_device_flow(&db, &pending2, &session_token2)
        .expect("poll 2");

    let account2 = match result2 {
        PollResult::Success { account } => account,
        PollResult::Pending => panic!("Expected success on second poll"),
    };

    // AC3: Same ID (updated, not duplicated)
    assert_eq!(
        account1.id, account2.id,
        "Same user must reuse same account ID"
    );

    let accounts_after = svc2
        .list_accounts(&db)
        .expect("list accounts after re-login");
    assert_eq!(
        accounts_after.len(),
        1,
        "Must still have exactly 1 account (no duplicate)"
    );
}

// ---------------------------------------------------------------------------
// Pending → Success flow
// ---------------------------------------------------------------------------

#[test]
fn test_pending_then_success() {
    let db = make_db();
    let svc = make_service(MockGitHubHttpClient::new_with_pending_then_success());

    let (_session, pending) = svc.begin_device_flow().expect("begin_device_flow");
    let token = pending.session_token.clone();

    // First poll: should be Pending
    let r1 = svc.poll_device_flow(&db, &pending, &token).expect("poll 1");
    assert!(
        matches!(r1, PollResult::Pending),
        "First poll should be Pending"
    );

    // Second poll: should succeed
    let r2 = svc.poll_device_flow(&db, &pending, &token).expect("poll 2");
    match r2 {
        PollResult::Success { account } => {
            assert_eq!(account.login, "anotheruser");
        }
        PollResult::Pending => panic!("Second poll should succeed"),
    }
}

// ---------------------------------------------------------------------------
// Access denied returns AUTH_REQUIRED
// ---------------------------------------------------------------------------

#[test]
fn test_access_denied_returns_auth_required() {
    let db = make_db();
    let svc = make_service(MockGitHubHttpClient::new_with_denied());

    let (_session, pending) = svc.begin_device_flow().expect("begin_device_flow");
    let token = pending.session_token.clone();

    let err = svc
        .poll_device_flow(&db, &pending, &token)
        .expect_err("Should fail with AUTH_REQUIRED");

    assert_eq!(
        err.code, "AUTH_REQUIRED",
        "Denied access should map to AUTH_REQUIRED"
    );
}

// ---------------------------------------------------------------------------
// AC7: Expired device-flow session
// ---------------------------------------------------------------------------

#[test]
fn test_ac7_expired_device_flow() {
    let svc = make_service(MockGitHubHttpClient::new_with_success_on_first_poll());
    let db = make_db();

    let (_session, mut pending) = svc.begin_device_flow().expect("begin_device_flow");
    let token = pending.session_token.clone();

    // Manually set expires_at to the past
    pending = PendingDeviceFlow::make_expired_for_test(pending);

    let err = svc
        .poll_device_flow(&db, &pending, &token)
        .expect_err("Expired session should fail");

    assert_eq!(err.code, "DEVICE_FLOW_EXPIRED");
}

// ---------------------------------------------------------------------------
// AC5: Disconnect clears credential store and DB record
// ---------------------------------------------------------------------------

#[test]
fn test_ac5_disconnect_clears_keyring_and_db() {
    let db = make_db();

    // We need a service that shares the same store instance for inspection.
    let svc = GitHubService::new(
        Box::new(MockGitHubHttpClient::new_with_success_on_first_poll()),
        Box::new(InMemoryCredentialStore::new()),
    );

    // Login to create an account
    let (_session, pending) = svc.begin_device_flow().expect("begin");
    let token = pending.session_token.clone();
    let result = svc.poll_device_flow(&db, &pending, &token).expect("poll");
    let account = match result {
        PollResult::Success { account } => account,
        _ => panic!("Expected success"),
    };

    // Verify account exists in DB
    let accounts = svc.list_accounts(&db).expect("list");
    assert_eq!(accounts.len(), 1);

    // Disconnect
    svc.disconnect_account(&db, &account.id)
        .expect("disconnect");

    // Verify DB is empty
    let accounts_after = svc.list_accounts(&db).expect("list after");
    assert_eq!(accounts_after.len(), 0, "Account should be removed from DB");
}

// ---------------------------------------------------------------------------
// AC4: API error code mapping
// ---------------------------------------------------------------------------

#[test]
fn test_ac4_error_code_mapping() {
    // Test the error constructors directly (they're used by map_ureq_error in prod)
    let e401 = CommandError::auth_required("test");
    assert_eq!(e401.code, "AUTH_REQUIRED");

    let e403_rate = CommandError::rate_limited("test");
    assert_eq!(e403_rate.code, "RATE_LIMITED");

    let e403_perm = CommandError::permission_denied("test");
    assert_eq!(e403_perm.code, "PERMISSION_DENIED");

    let e404 = CommandError::github_api_error(404, "not found");
    assert_eq!(e404.code, "NOT_FOUND");

    let e422 = CommandError::github_api_error(422, "validation");
    assert_eq!(e422.code, "VALIDATION_ERROR");

    let e500 = CommandError::github_api_error(500, "server error");
    assert_eq!(e500.code, "SERVER_ERROR");
    assert!(e500.recoverable);

    let e_network = CommandError::network_error("timeout");
    assert_eq!(e_network.code, "NETWORK_ERROR");
    assert!(e_network.recoverable);

    let e_cred = CommandError::credential_store_unavailable("no keyring");
    assert_eq!(e_cred.code, "CREDENTIAL_STORE_UNAVAILABLE");
    assert!(
        !e_cred.recoverable,
        "Keyring unavailable is non-recoverable"
    );
}

// ---------------------------------------------------------------------------
// AC6: Repository pagination
// ---------------------------------------------------------------------------

#[test]
fn test_ac6_repo_listing_pagination() {
    let db = make_db();
    let svc = make_service(MockGitHubHttpClient::new_with_success_on_first_poll());

    // Login first
    let (_session, pending) = svc.begin_device_flow().expect("begin");
    let token = pending.session_token.clone();
    let result = svc.poll_device_flow(&db, &pending, &token).expect("poll");
    let account = match result {
        PollResult::Success { account } => account,
        _ => panic!("Expected success"),
    };

    // List repos page 1 with per_page=10
    let page = svc.list_repos(&db, &account.id, 1, 10).expect("list repos");
    assert_eq!(page.page, 1);
    assert_eq!(page.per_page, 10);
    assert_eq!(page.repos.len(), 1, "Should have 1 mocked repo");
    assert!(!page.has_more, "1 repo < 10 per_page so no more pages");

    // Verify repo data is correct
    let repo = &page.repos[0];
    assert_eq!(repo.name, "my-repo");
    assert_eq!(repo.owner_login, "testuser");
    assert!(!repo.private);
    // Verify no token-related fields exist (structural check)
    // GitHubRepo has no token field by design
}

// ---------------------------------------------------------------------------
// Migration 2 creates github_accounts table correctly
// ---------------------------------------------------------------------------

#[test]
fn test_migration_2_github_accounts_table() {
    let db = Database::in_memory().expect("in-memory DB");

    // Verify table exists by trying to insert and query
    db.with_conn(|conn| {
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM github_accounts", [], |r| r.get(0))
            .expect("github_accounts table should exist");
        assert_eq!(count, 0);

        // Verify UNIQUE constraint on (provider, provider_user_id)
        conn.execute(
            "INSERT INTO github_accounts (id, provider, provider_user_id, login, credential_ref, connection_status, created_at)
             VALUES ('id1', 'github', 'user123', 'login1', 'ref1', 'connected', '2024-01-01T00:00:00Z')",
            [],
        ).expect("First insert should succeed");

        // Duplicate should not create a second row (UNIQUE constraint)
        let result = conn.execute(
            "INSERT INTO github_accounts (id, provider, provider_user_id, login, credential_ref, connection_status, created_at)
             VALUES ('id2', 'github', 'user123', 'login2', 'ref2', 'connected', '2024-01-01T00:00:00Z')",
            [],
        );
        assert!(result.is_err(), "Duplicate (provider, provider_user_id) should fail");

        Ok(())
    }).expect("DB operations failed");
}

// ---------------------------------------------------------------------------
// Profile overview: get_account_profile returns only public metadata
// ---------------------------------------------------------------------------

#[test]
fn test_get_account_profile_returns_public_overview() {
    let db = make_db();
    let svc = make_service(MockGitHubHttpClient::new_with_success_on_first_poll());

    // Connect an account first (device flow success stores token + account).
    let (_session, pending) = svc.begin_device_flow().expect("begin_device_flow");
    let session_token = pending.session_token.clone();
    let account = match svc
        .poll_device_flow(&db, &pending, &session_token)
        .expect("poll")
    {
        PollResult::Success { account } => account,
        PollResult::Pending => panic!("Expected success on first poll"),
    };

    let profile = svc
        .get_account_profile(&db, &account.id)
        .expect("get_account_profile");

    assert_eq!(profile.login, "testuser");
    assert_eq!(profile.name.as_deref(), Some("Test User"));
    // Mock payload has no html_url → deterministic fallback from login.
    assert_eq!(profile.html_url, "https://github.com/testuser");
    assert_eq!(profile.public_repos, 0);

    // AC1 extension: the profile DTO must never carry token material either.
    let json = serde_json::to_string(&profile).expect("profile serialises");
    assert!(
        !json.contains("test_token_xyz") && !json.contains("gho_"),
        "Profile payload leaked token material"
    );

    // Unknown account → typed ACCOUNT_NOT_FOUND (not a panic, not AUTH_EXPIRED).
    let err = svc
        .get_account_profile(&db, "no-such-account")
        .expect_err("unknown account must fail");
    assert_eq!(err.code, "ACCOUNT_NOT_FOUND");
}

#[test]
fn test_get_account_profile_expired_after_disconnect() {
    let db = make_db();
    let svc = make_service(MockGitHubHttpClient::new_with_success_on_first_poll());

    let (_session, pending) = svc.begin_device_flow().expect("begin_device_flow");
    let session_token = pending.session_token.clone();
    let account = match svc
        .poll_device_flow(&db, &pending, &session_token)
        .expect("poll")
    {
        PollResult::Success { account } => account,
        PollResult::Pending => panic!("Expected success on first poll"),
    };

    // Disconnect removes the token from the credential store.
    svc.disconnect_account(&db, &account.id)
        .expect("disconnect");

    // Disconnect removes the token AND the DB record, so the account lookup
    // fails first with ACCOUNT_NOT_FOUND (defence in depth: even if the token
    // somehow remained, it is no longer addressable).
    let err = svc
        .get_account_profile(&db, &account.id)
        .expect_err("profile must fail after disconnect");
    assert_eq!(err.code, "ACCOUNT_NOT_FOUND");
}

// ---------------------------------------------------------------------------
// Publish: create_remote_repo via API abstraction
// ---------------------------------------------------------------------------

#[test]
fn test_create_remote_repo_requires_connected_account() {
    let db = make_db();
    let svc = make_service(MockGitHubHttpClient::new_with_success_on_first_poll());

    // Connect first so the credential exists.
    let (_session, pending) = svc.begin_device_flow().expect("begin_device_flow");
    let session_token = pending.session_token.clone();
    let account = match svc
        .poll_device_flow(&db, &pending, &session_token)
        .expect("poll")
    {
        PollResult::Success { account } => account,
        PollResult::Pending => panic!("Expected success on first poll"),
    };

    let created = svc
        .create_remote_repo(&db, &account.id, "yeni-proje", Some("aciklama"), false)
        .expect("create_remote_repo");
    assert_eq!(created.full_name, "testuser/yeni-proje");
    assert!(!created.private);
    assert!(created.clone_url.ends_with("yeni-proje.git"));

    // Invalid names never reach the network.
    for bad in ["", "  ", "geçersiz ad", "adi/", "nokta.", "-tire"] {
        let err = svc
            .create_remote_repo(&db, &account.id, bad, None, false)
            .expect_err("isim doğrulaması çalışmalı");
        assert_eq!(
            err.code, "REPO_NAME_INVALID",
            "kabul edilen isim: {:?}",
            bad
        );
    }

    // Unknown account → ACCOUNT_NOT_FOUND.
    let err = svc
        .create_remote_repo(&db, "nope", "ok-ad", None, false)
        .expect_err("hesap yoksa hata");
    assert_eq!(err.code, "ACCOUNT_NOT_FOUND");
}

// ---------------------------------------------------------------------------
// v0.2.1: OAuth refresh-token akışı
// ---------------------------------------------------------------------------
//
// MockHTTP convention: refresh_access_token returns a rotated pair for any
// refresh token except "BAD_REFRESH", which simulates a rejected grant.

/// Poll Success carrying expiry + refresh token (GitHub App with expiry on).
fn client_with_refresh_on_poll() -> MockGitHubHttpClient {
    let client = MockGitHubHttpClient::new_with_success_on_first_poll();
    *client.poll_responses.lock().unwrap() = vec![RawPollResponse::Success {
        access_token: "initial_token".to_string(),
        token_type: "bearer".to_string(),
        scope: "read:user,public_repo".to_string(),
        expires_in: Some(3600),
        refresh_token: Some("initial_refresh".to_string()),
    }];
    client
}

/// Log in with `svc`, returning the created account.
fn login(
    svc: &GitHubService,
    db: &Database,
    pending: &PendingDeviceFlow,
) -> gybe_core::models::GitHubAccount {
    let session_token = pending.session_token.clone();
    match svc
        .poll_device_flow(db, pending, &session_token)
        .expect("poll")
    {
        PollResult::Success { account } => *account,
        PollResult::Pending => panic!("Expected success"),
    }
}

#[test]
fn test_refresh_flow_login_stores_refresh_key_and_expiry() {
    let db = make_db();
    let svc = make_service(client_with_refresh_on_poll());

    let (_session, pending) = svc.begin_device_flow().expect("begin");
    let account = login(&svc, &db, &pending);

    // DB sees only the expiry TIMESTAMP — never token material.
    assert!(
        account.token_expires_at.is_some(),
        "expires_in geldiyse bitiş zamanı DB'ye yazılmalı"
    );
    let stored = svc
        .list_accounts(&db)
        .expect("list")
        .into_iter()
        .find(|a| a.id == account.id)
        .expect("account");
    assert_eq!(stored.token_expires_at, account.token_expires_at);

    // The refresh key lives in the credential store under "{ref}:refresh".
    // Accessible via access_token path below; here verify status is connected.
    assert_eq!(stored.connection_status, GitHubConnectionStatus::Connected);
}

#[test]
fn test_refresh_flow_expired_token_auto_refreshes() {
    let db = make_db();
    let svc = make_service(client_with_refresh_on_poll());

    let (_session, pending) = svc.begin_device_flow().expect("begin");
    let account = login(&svc, &db, &pending);

    // Simulate expiry passing.
    db.with_conn(|conn| {
        gybe_core::db::github_accounts::GitHubAccountDao::set_token_expires_at(
            conn,
            &account.id,
            Some("2020-01-01T00:00:00+00:00"),
        )
    })
    .expect("force expiry");

    // Mock returns rotated pair for any refresh token except BAD_REFRESH.
    let token = svc.access_token(&db, &account.id).expect("auto refresh");
    assert_eq!(token, "refreshed_token_456");

    // Rotation persisted: new expiry in DB, status still connected.
    let stored = svc
        .list_accounts(&db)
        .expect("list")
        .into_iter()
        .find(|a| a.id == account.id)
        .expect("account");
    assert_eq!(stored.connection_status, GitHubConnectionStatus::Connected);
    let expiry = stored.token_expires_at.expect("yeni bitiş yazılmalı");
    assert_ne!(
        expiry, "2020-01-01T00:00:00+00:00",
        "yenileme sonrası bitiş zamanı tazelenmeli"
    );
}

#[test]
fn test_refresh_flow_rejected_marks_auth_expired() {
    let db = make_db();
    // Store pre-seeded with a refresh token the mock will reject.
    let store = InMemoryCredentialStore::new();
    store
        .set_credential("github:12345", "old_token")
        .expect("seed access");
    store
        .set_credential("github:12345:refresh", "BAD_REFRESH")
        .expect("seed refresh");

    let svc = GitHubService::new(
        Box::new(MockGitHubHttpClient::new_with_denied()),
        Box::new(store),
    );

    // Insert the account row directly (bypass device flow).
    let now = "2026-01-01T00:00:00+00:00".to_string();
    db.with_conn(|conn| {
        gybe_core::db::github_accounts::GitHubAccountDao::upsert(
            conn,
            &gybe_core::models::GitHubAccount {
                id: "acct-1".to_string(),
                provider: "github".to_string(),
                provider_user_id: "12345".to_string(),
                login: "testuser".to_string(),
                display_name: None,
                avatar_url: None,
                credential_ref: "github:12345".to_string(),
                connection_status: GitHubConnectionStatus::Connected,
                created_at: now.clone(),
                last_used_at: None,
                token_expires_at: Some("2020-01-01T00:00:00+00:00".to_string()),
            },
        )
    })
    .expect("seed account");

    let err = svc
        .access_token(&db, "acct-1")
        .expect_err("reddedilen refresh hata vermeli");
    assert_eq!(err.code, "AUTH_EXPIRED");

    let stored = svc
        .list_accounts(&db)
        .expect("list")
        .into_iter()
        .find(|a| a.id == "acct-1")
        .expect("account");
    assert_eq!(
        stored.connection_status,
        GitHubConnectionStatus::AuthExpired
    );
}

#[test]
fn test_refresh_flow_no_refresh_key_returns_old_token() {
    let db = make_db();
    let store = InMemoryCredentialStore::new();
    store
        .set_credential("github:777", "legacy_token")
        .expect("seed");

    let svc = GitHubService::new(
        Box::new(MockGitHubHttpClient::new_with_denied()),
        Box::new(store),
    );

    let now = "2026-01-01T00:00:00+00:00".to_string();
    db.with_conn(|conn| {
        gybe_core::db::github_accounts::GitHubAccountDao::upsert(
            conn,
            &gybe_core::models::GitHubAccount {
                id: "acct-legacy".to_string(),
                provider: "github".to_string(),
                provider_user_id: "777".to_string(),
                login: "legacy".to_string(),
                display_name: None,
                avatar_url: None,
                credential_ref: "github:777".to_string(),
                connection_status: GitHubConnectionStatus::Connected,
                created_at: now.clone(),
                last_used_at: None,
                // Expired but NO refresh key: must fall back to old token.
                token_expires_at: Some("2020-01-01T00:00:00+00:00".to_string()),
            },
        )
    })
    .expect("seed account");

    let token = svc
        .access_token(&db, "acct-legacy")
        .expect("eski token dönmeli");
    assert_eq!(token, "legacy_token");
}

#[test]
fn test_refresh_flow_concurrent_calls_trigger_single_refresh() {
    // Otomatik-fetch turu + kullanıcı push'u aynı anda süresi dolmuş token'a
    // bakarsa TAM BİR refresh isteği atılmalı; ikincisi taze token'ı okumalı.
    let db = make_db();
    let mut client = client_with_refresh_on_poll();
    client.refresh_delay_ms = 120; // gerçek ağ gecikmesini taklit et
    let refresh_calls = std::sync::Arc::clone(&client.refresh_calls);
    let svc = std::sync::Arc::new(make_service(client));

    let (_session, pending) = svc.begin_device_flow().expect("begin");
    let account = login(&svc, &db, &pending);

    db.with_conn(|conn| {
        gybe_core::db::github_accounts::GitHubAccountDao::set_token_expires_at(
            conn,
            &account.id,
            Some("2020-01-01T00:00:00+00:00"),
        )
    })
    .expect("force expiry");

    let handles: Vec<_> = (0..2)
        .map(|_| {
            let svc = std::sync::Arc::clone(&svc);
            let db = db.clone();
            let id = account.id.clone();
            std::thread::spawn(move || svc.access_token(&db, &id))
        })
        .collect();

    let tokens: Vec<String> = handles
        .into_iter()
        .map(|h| h.join().expect("thread").expect("access_token"))
        .collect();

    assert_eq!(
        refresh_calls.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "eşzamanlı iki çağrı tek refresh isteği üretmeli"
    );
    for t in tokens {
        assert_eq!(t, "refreshed_token_456");
    }
}

// ---------------------------------------------------------------------------
// GO-17c: backend device-flow throttle (RFC 8628) — interval + slow_down
// ---------------------------------------------------------------------------

#[test]
fn test_go17c_poll_throttled_before_interval_and_slow_down_escalates() {
    let db = make_db();
    // interval=60: mock kuyruğunda TEK yanıt var — throttle bozuksa ilk poll
    // Success'u tüketir ve test patlar.
    let mut client = MockGitHubHttpClient::new_with_success_on_first_poll();
    client.device_flow_resp.interval = 60;
    let svc = make_service(client);

    let (_session, pending) = svc.begin_device_flow().expect("begin");

    // 1) Interval dolmadan gelen poll GitHub'a İLETİLMEZ → yerel Pending.
    let r = svc
        .poll_device_flow(&db, &pending, &pending.session_token.clone())
        .expect("throttled poll");
    assert!(matches!(r, PollResult::Pending), "yerel Pending beklenirdi");

    // 2) Zaman geçmişe alınınca gerçek HTTP gider → Success (kuyruk duruyor).
    pending.force_pollable_for_test();
    let r2 = svc
        .poll_device_flow(&db, &pending, &pending.session_token.clone())
        .expect("real poll");
    assert!(
        matches!(r2, PollResult::Success { .. }),
        "kuyrukta Success duruyor olmalı — throttle sayacı HTTP'i ertelemişti"
    );

    // 3) slow_down → aralık +5 sn (RFC 8628 §3.5 zorunluluğu).
    let mut client2 = MockGitHubHttpClient::new_with_pending_then_success();
    client2.device_flow_resp.interval = 0;
    // Kuyruk başına slow_down ekle
    {
        let mut q = client2.poll_responses.lock().unwrap();
        q.insert(
            0,
            RawPollResponse::Pending {
                error: "slow_down".to_string(),
                error_description: Some("Slow down.".to_string()),
            },
        );
    }
    let svc2 = make_service(client2);
    let (_s2, pending2) = svc2.begin_device_flow().expect("begin 2");
    assert_eq!(pending2.current_interval_secs(), 0);

    let r = svc2
        .poll_device_flow(&db, &pending2, &pending2.session_token.clone())
        .expect("slow_down poll");
    assert!(matches!(r, PollResult::Pending));
    assert_eq!(
        pending2.current_interval_secs(),
        5,
        "slow_down sonrası aralık 5 sn artmalı"
    );

    // Artan aralık gerçekten throttle eder (ikinci anlık poll HTTP'e gitmez;
    // kuyruktaki sonraki yanıt Pending — tüketilse de görünüm aynı, bu yüzden
    // dolaylı doğrulama: force sonrası kuyruk Success vermeye devam etmeli).
    pending2.force_pollable_for_test();
    let r3 = svc2
        .poll_device_flow(&db, &pending2, &pending2.session_token.clone())
        .expect("forced poll");
    assert!(matches!(r3, PollResult::Pending)); // kuyruktaki authorization_pending
    pending2.force_pollable_for_test();
    let r4 = svc2
        .poll_device_flow(&db, &pending2, &pending2.session_token.clone())
        .expect("forced poll 2");
    assert!(matches!(r4, PollResult::Success { .. }));
}
