use crate::errors::CommandError;
use crate::git::adapter::GitAdapter;
use crate::git::status::GitStatusParser;
use crate::models::{GitStatus, RemoteInfo, RepositoryOperationState};
use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

/// Geçici push credential helper'ı: git, `!` ile başlayan helper'ı shell'de
/// çalıştırır; token yalnızca çocuğun ortamındaki GYBE_GH_TOKEN'dan okunur.
/// Böylece token argv'ye, URL'e, .git/config'e veya loglara asla düşmez.
const PUSH_TOKEN_HELPER: &str =
    "!f() { echo username=x-access-token; echo \"password=$GYBE_GH_TOKEN\"; }; f";

pub struct GitRemoteManager;

impl GitRemoteManager {
    /// Validates a remote or branch name to protect against command-line argument injection.
    pub fn validate_name(name: &str, field_name: &str) -> Result<(), CommandError> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                format!("{} boş olamaz.", field_name),
                true,
            ));
        }
        if trimmed.starts_with('-') {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                format!("{} '-' ile başlayamaz.", field_name),
                true,
            ));
        }
        if trimmed.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                format!("{} boşluk veya kontrol karakteri içeremez.", field_name),
                true,
            ));
        }
        Ok(())
    }

    /// Lists all remotes configured for the repository.
    pub fn list_remotes(repo_dir: &Path) -> Result<Vec<RemoteInfo>, CommandError> {
        let output = GitAdapter::execute(repo_dir, &["remote", "-v"])?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(CommandError::new(
                "GIT_COMMAND_FAILED",
                format!("Remote listesi alınamadı: {}", stderr.trim()),
                true,
            ));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut map: HashMap<String, (Option<String>, Option<String>)> = HashMap::new();
        let mut ordered_names = Vec::new();

        for line in stdout.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 3 {
                let name = parts[0].to_string();
                let url = parts[1].to_string();
                let kind = parts[2];

                if !map.contains_key(&name) {
                    ordered_names.push(name.clone());
                    map.insert(name.clone(), (None, None));
                }

                let entry = map.get_mut(&name).expect("Entry was inserted");
                if kind.contains("fetch") {
                    entry.0 = Some(url);
                } else if kind.contains("push") {
                    entry.1 = Some(url);
                }
            }
        }

        let mut remotes = Vec::new();
        for name in ordered_names {
            let (fetch_url, push_url) = map.remove(&name).unwrap_or((None, None));
            remotes.push(RemoteInfo {
                name,
                fetch_url,
                push_url,
            });
        }

        Ok(remotes)
    }

    /// Adds a new remote (`git remote add <name> <url>`).
    /// Rejects duplicate remote names and option-looking URLs (argument
    /// injection guard); arguments are always passed as an argv array.
    pub fn add(repo_dir: &Path, name: &str, url: &str) -> Result<Vec<RemoteInfo>, CommandError> {
        Self::validate_name(name, "Remote adı")?;

        let url = url.trim();
        if url.is_empty() {
            return Err(CommandError::invalid_path("Remote bos olamaz"));
        }
        if url.starts_with('-') || url.contains(char::is_whitespace) {
            return Err(CommandError::invalid_path(
                "Remote geçersiz bir adres içeriyor.",
            ));
        }
        let scheme_ok = url.starts_with("https://")
            || url.starts_with("http://")
            || url.starts_with("git://")
            || url.starts_with("ssh://")
            || url.starts_with("git@");
        if !scheme_ok {
            return Err(CommandError::invalid_path(
                "Remote adresi http(s)://, git://, ssh:// veya git@ ile başlamalıdır.",
            ));
        }

        // GO-06: URL'e gömülü kimlik bilgileri (PAT/token) `.git/config`'e
        // yazılır ve `list_remotes` ile arayüze döner — "token diske/config'e
        // ASLA yazılmaz" ilkesi clone'dan sonra remote add için de geçerli.
        // ssh://kullanici@host serbest (o bir kullanıcı adı, sır değil);
        // ssh://içinde bile ':' varsa (user:pass) reddedilir.
        if let Some(pos) = url.find("://") {
            let scheme = &url[..pos];
            let authority_end = url[pos + 3..]
                .find('/')
                .map(|i| pos + 3 + i)
                .unwrap_or(url.len());
            let authority = &url[pos + 3..authority_end];
            if let Some(at) = authority.rfind('@') {
                let userinfo = &authority[..at];
                let reject = scheme != "ssh" || userinfo.contains(':');
                if reject {
                    return Err(CommandError::invalid_path(
                        "Remote adresine gömülü kullanıcı adı/parola/token kabul edilmiyor. \
                         Kimlik bilgileri Gybe tarafından geçici olarak enjekte edilir; \
                         URL'i kimlik bilgisi olmadan girin.",
                    ));
                }
            }
        }

        let existing = Self::list_remotes(repo_dir)?;
        if existing.iter().any(|r| r.name == name) {
            return Err(CommandError::new(
                "REMOTE_EXISTS",
                format!("'{}' adında bir remote zaten tanımlı.", name),
                false,
            ));
        }

        let output = GitAdapter::execute(repo_dir, &["remote", "add", name, url])?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(CommandError::new(
                "GIT_COMMAND_FAILED",
                format!("Remote eklenemedi: {}", stderr.trim()),
                true,
            ));
        }

        Self::list_remotes(repo_dir)
    }

    /// Hedef remote'un doğrulanabilir URL'i (push_url öncelikli) — auth_envs
    /// için HTTPS karar girdisi. Bulunamazsa None (kimlik enjekte edilmez).
    fn remote_url(repo_dir: &Path, remote: &str) -> Option<String> {
        Self::list_remotes(repo_dir).ok().and_then(|remotes| {
            remotes
                .into_iter()
                .find(|r| r.name == remote)
                .and_then(|r| r.push_url.or(r.fetch_url))
        })
    }

    /// GO-04: fetch/pull/push için ortak kimlik ortamı kurucusu. Token
    /// SADECE hedef remote HTTPS ise enjekte edilir ve yalnızca çocuk sürecin
    /// ortamında yaşar — diske, URL'e veya config'e ASLA yazılmaz. SSH
    /// remote'larında ~/.ssh/config kimliği devrededir; injection gerekmez.
    /// R-06: URL'yi çağırının kendisi çözer (fetch zaten listeliyordu — ikinci
    /// `list_remotes` subprocess'i auto-fetch başına bedavaya yanıyordu).
    fn auth_envs<'a>(
        envs: &mut Vec<(&'static str, &'a str)>,
        remote_url: Option<&str>,
        access_token: Option<&'a str>,
    ) {
        let Some(token) = access_token.filter(|t| !t.is_empty()) else {
            return;
        };
        let is_https = remote_url
            .and_then(|u| Self::parse_remote_owner(u).map(|(_, https)| https))
            .unwrap_or(false);
        if is_https {
            envs.push(("GYBE_GH_TOKEN", token));
            envs.push(("GIT_CONFIG_COUNT", "2"));
            envs.push(("GIT_CONFIG_KEY_0", "credential.helper"));
            envs.push(("GIT_CONFIG_VALUE_0", "")); // stored helpers sıfırla
            envs.push(("GIT_CONFIG_KEY_1", "credential.helper"));
            envs.push(("GIT_CONFIG_VALUE_1", PUSH_TOKEN_HELPER));
        }
    }

    /// Fetches changes from a remote without modifying working tree files.
    /// Updates remote-tracking references and refreshes upstream ahead/behind counts.
    /// GO-04: `access_token` yalnızca HTTPS remote'larda geçici credential
    /// helper olarak kullanılır (push ile aynı simetri) — diske yazılmaz.
    pub fn fetch(
        repo_dir: &Path,
        remote: Option<&str>,
        access_token: Option<&str>,
    ) -> Result<GitStatus, CommandError> {
        let mut args = vec!["fetch", "--prune"];

        let remotes = Self::list_remotes(repo_dir)?;

        let target_remote = match remote {
            Some(r) => {
                Self::validate_name(r, "Remote adı")?;
                r.to_string()
            }
            None => {
                if remotes.is_empty() {
                    return Err(CommandError::new(
                        "NO_REMOTES",
                        "Depoda tanımlı bir uzak sunucu (remote) bulunamadı.",
                        true,
                    ));
                }
                // Prefer 'origin', else first remote
                if remotes.iter().any(|r| r.name == "origin") {
                    "origin".to_string()
                } else {
                    remotes[0].name.clone()
                }
            }
        };

        args.push(&target_remote);

        let mut envs: Vec<(&'static str, &str)> =
            vec![("GIT_TERMINAL_PROMPT", "0"), ("GIT_ASKPASS", "echo")];
        // R-06: `remotes` zaten çözülmüştü — URL oradan okunur, ikinci
        // list_remotes subprocess'i yok (auto-fetch her tur buradan geçer).
        let target_url = remotes
            .iter()
            .find(|r| r.name == target_remote)
            .and_then(|r| r.push_url.as_deref().or(r.fetch_url.as_deref()));
        Self::auth_envs(&mut envs, target_url, access_token);

        let output = GitAdapter::execute_with_env_and_timeout(
            repo_dir,
            &args,
            &envs,
            Some(Duration::from_secs(30)),
        )?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(Self::map_remote_error(&stderr, "Fetch"));
        }

        GitStatusParser::get_status(repo_dir)
    }

    /// Pulls changes from upstream or specified remote/branch into the current branch.
    /// Preserves safety invariants:
    /// 1. Rejects if no upstream exists and none is specified (`NO_UPSTREAM`).
    /// 2. Never performs destructive reset (`git reset --hard`) on conflict.
    /// 3. Detects conflicts and transitions repository state to `MergeInProgress`.
    pub fn pull(
        repo_dir: &Path,
        remote: Option<&str>,
        branch: Option<&str>,
        strategy: Option<&str>,
        access_token: Option<&str>,
    ) -> Result<GitStatus, CommandError> {
        let status_before = GitStatusParser::get_status(repo_dir)?;

        // GO-02c: detached HEAD'da pull anlamsızdır — git hangi dala merge
        // edeceğini bilemez ve kafa karıştırıcı hata verir. Dürüst gerekçe.
        if status_before.is_detached_head {
            return Err(CommandError::new(
                "INVALID_STATE",
                "Detached HEAD durumunda pull yapılamaz. Lütfen önce bir dal oluşturun veya seçin.",
                true,
            ));
        }

        if status_before.upstream.is_none() && remote.is_none() && branch.is_none() {
            return Err(CommandError::new(
                "NO_UPSTREAM",
                "Aktif dal için upstream bilgisi bulunamadı. Lütfen önce upstream dalını belirleyin veya remote/branch belirtin.",
                true,
            ));
        }

        let mut args = vec!["pull", "--no-stat"];
        if let Some(strat) = strategy {
            if strat == "rebase" {
                args.push("--rebase");
            } else {
                args.push("--no-rebase");
            }
        } else {
            args.push("--no-rebase");
        }

        // GO-03c: `branch` verilip `remote` verilmeyince branch sessizce
        // yok sayılıyordu (git pull <branch> remote ADI olarak yorumlanır!).
        // Varsayılan remote'u çöz: upstream öneki → origin → ilk remote.
        let mut remote_owned: Option<String> = None;
        let mut branch_owned: Option<String> = None;
        match (remote, branch) {
            (Some(r), b) => {
                Self::validate_name(r, "Remote adı")?;
                remote_owned = Some(r.to_string());
                if let Some(b) = b {
                    Self::validate_name(b, "Branch adı")?;
                    branch_owned = Some(b.to_string());
                }
            }
            (None, Some(b)) => {
                Self::validate_name(b, "Branch adı")?;
                let default_remote = status_before
                    .upstream
                    .as_deref()
                    .and_then(|u| u.split_once('/'))
                    .map(|(r, _)| r.to_string())
                    .or_else(|| {
                        let remotes = Self::list_remotes(repo_dir).ok()?;
                        if remotes.iter().any(|r| r.name == "origin") {
                            Some("origin".to_string())
                        } else {
                            remotes.first().map(|r| r.name.clone())
                        }
                    });
                match default_remote {
                    Some(r) => {
                        remote_owned = Some(r);
                        branch_owned = Some(b.to_string());
                    }
                    None => {
                        return Err(CommandError::new(
                            "NO_REMOTES",
                            "Branch belirtildi ancak kullanılacak remote çözülemedi (upstream yok ve depoda remote tanımlı değil).",
                            true,
                        ));
                    }
                }
            }
            (None, None) => {}
        }
        if let Some(r) = &remote_owned {
            args.push(r);
        }
        if let Some(b) = &branch_owned {
            args.push(b);
        }

        // GO-04: token enjeksiyonu push ile simetrik — hedef remote HTTPS ise.
        let target_remote = remote_owned.clone().unwrap_or_else(|| {
            status_before
                .upstream
                .as_deref()
                .and_then(|u| u.split_once('/'))
                .map(|(r, _)| r.to_string())
                .unwrap_or_else(|| "origin".to_string())
        });
        let mut envs: Vec<(&'static str, &str)> =
            vec![("GIT_TERMINAL_PROMPT", "0"), ("GIT_ASKPASS", "echo")];
        let target_url = Self::remote_url(repo_dir, &target_remote);
        Self::auth_envs(&mut envs, target_url.as_deref(), access_token);

        let output = GitAdapter::execute_with_env_and_timeout(
            repo_dir,
            &args,
            &envs,
            Some(Duration::from_secs(45)),
        )?;

        // Always inspect refreshed repository status and operation state
        let status_after = GitStatusParser::get_status(repo_dir)?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);

            // Check if merge conflicts were created
            if status_after.operation_state == RepositoryOperationState::MergeInProgress
                || !status_after.conflicted_files.is_empty()
                || stderr.contains("Automatic merge failed")
                || stderr.contains("CONFLICT")
            {
                // CRITICAL: DO NOT call `git reset --hard` or auto-discard!
                // Report conflict presence while leaving the repository in MergeInProgress.
                let conflict_list = status_after.conflicted_files.join(", ");
                return Err(CommandError::new(
                    "CONFLICTS_PRESENT",
                    format!(
                        "Uzak depodaki değişiklikler çekilirken çakışma oluştu. Çakışan dosyalar: {}",
                        if conflict_list.is_empty() {
                            "belirlenemedi"
                        } else {
                            &conflict_list
                        }
                    ),
                    true,
                ));
            }

            // Check if pull was blocked by uncommitted local changes
            if stderr
                .contains("Your local changes to the following files would be overwritten by merge")
                || stderr.contains("Please commit your changes or stash them")
                || stderr.contains("Cannot pull with rebase: You have unstaged changes")
            {
                return Err(CommandError::new(
                    "DIRTY_WORKTREE",
                    "Çalışma dizininde kaydedilmemiş değişiklikler var. Pull yapmadan önce lütfen değişikliklerinizi commit edin veya stash'leyin.",
                    true,
                ));
            }

            // Check if no tracking information exists
            if stderr.contains("There is no tracking information for the current branch") {
                return Err(CommandError::new(
                    "NO_UPSTREAM",
                    "Aktif dal için upstream bilgisi bulunamadı.",
                    true,
                ));
            }

            return Err(Self::map_remote_error(&stderr, "Pull"));
        }

        Ok(status_after)
    }

    /// Pushes current branch commits to the remote.
    /// Preserves safety invariants:
    /// 1. Rejects if no upstream exists and set_upstream is false (`NO_UPSTREAM`).
    /// 2. Rejects non-fast-forward updates (`REMOTE_REJECTED`) and NEVER automatically converts to `--force`.
    /// 3. Force push (if explicitly requested by caller) uses `--force-with-lease`.
    pub fn push(
        repo_dir: &Path,
        remote: Option<&str>,
        branch: Option<&str>,
        force: bool,
        set_upstream: bool,
        access_token: Option<&str>,
    ) -> Result<GitStatus, CommandError> {
        let status_before = GitStatusParser::get_status(repo_dir)?;

        // GO-02c: branch alanı detached HEAD'da bile Some("HEAD (sha)") olur —
        // eski `.ok_or_else` koruması hiç tetiklenmiyordu (ölü kod) ve push
        // "HEAD (abc1234)" adında olmayan bir dalı göndermeye çalışıyordu.
        // Gerçek kapı is_detached_head olmalı.
        if status_before.is_detached_head {
            return Err(CommandError::new(
                "INVALID_STATE",
                "Detached HEAD durumunda doğrudan push yapılamaz. Lütfen önce bir dal oluşturun veya seçin.",
                true,
            ));
        }

        let current_branch = status_before.branch.clone().ok_or_else(|| {
            CommandError::new(
                "INVALID_STATE",
                "Aktif dal adı belirlenemedi; push iptal edildi.",
                true,
            )
        })?;

        if status_before.upstream.is_none() && !set_upstream && remote.is_none() {
            return Err(CommandError::new(
                "NO_UPSTREAM",
                "Bu dalın henüz bir upstream dalı bulunmuyor. Dalı uzak depoya göndermek için publish/set-upstream seçeneğini kullanın.",
                true,
            ));
        }

        let mut args = vec!["push"];
        if set_upstream {
            args.push("-u");
        }
        if force {
            // Spec 4.12: "--force-with-lease tercih edilmeli"
            args.push("--force-with-lease");
        }

        let target_remote = match remote {
            Some(r) => {
                Self::validate_name(r, "Remote adı")?;
                r.to_string()
            }
            None => {
                // If upstream is set (e.g., "origin/main"), extract remote name
                if let Some(ref u) = status_before.upstream
                    && let Some((rem, _)) = u.split_once('/')
                {
                    rem.to_string()
                } else {
                    "origin".to_string()
                }
            }
        };
        args.push(&target_remote);

        let target_branch = match branch {
            Some(b) => {
                Self::validate_name(b, "Branch adı")?;
                b.to_string()
            }
            None => current_branch,
        };
        args.push(&target_branch);

        // GO-04: hesap token'i geçici credential helper olarak enjekte edilir
        // (süreç ortamında yaşar; diske, URL'e veya config'e ASLA yazılmaz).
        let mut envs: Vec<(&'static str, &str)> =
            vec![("GIT_TERMINAL_PROMPT", "0"), ("GIT_ASKPASS", "echo")];
        let target_url = Self::remote_url(repo_dir, &target_remote);
        Self::auth_envs(&mut envs, target_url.as_deref(), access_token);

        let output = GitAdapter::execute_with_env_and_timeout(
            repo_dir,
            &args,
            &envs,
            Some(Duration::from_secs(45)),
        )?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);

            // CRITICAL ACCEPTANCE CRITERION: Non-fast-forward push must NOT be auto-forced.
            if stderr.contains("[rejected]")
                || stderr.contains("non-fast-forward")
                || stderr.contains("fetch first")
                || stderr
                    .contains("Updates were rejected because the remote contains work that you do")
            {
                return Err(CommandError::new(
                    "REMOTE_REJECTED",
                    "Uzak depo güncellemeyi reddetti (non-fast-forward). Uzak depoda henüz yerelinizde bulunmayan yeni commit'ler var. Lütfen önce pull yaparak değişiklikleri birleştirin.",
                    true,
                ));
            }

            return Err(Self::map_remote_error(&stderr, "Push"));
        }

        GitStatusParser::get_status(repo_dir)
    }

    /// Parses the owner segment of a GitHub remote URL and whether the URL is
    /// HTTPS (token push only applies to HTTPS). Accepted shapes:
    /// `https://github.com/owner/repo(.git)`, `git@github.com:owner/repo.git`,
    /// `git@<ssh-host-alias>:owner/repo.git`, `ssh://git@host/owner/repo(.git)`.
    pub fn parse_remote_owner(url: &str) -> Option<(String, bool)> {
        let url = url.trim();
        // owner/repo yolunu uc URL biciminden cikar: https://host/o/r,
        // ssh://git@host/o/r, git@host:o/r (host bir ssh alias'i de olabilir).
        // Onceden her dal `?` ile erken donuyordu; or_else zinciri ayni sonucu
        // verir (oneklar karsilikli dışlayici).
        let path = url
            .strip_prefix("https://")
            .or_else(|| url.strip_prefix("http://"))
            .and_then(|rest| rest.split_once('/'))
            .or_else(|| {
                url.strip_prefix("ssh://")
                    .and_then(|rest| rest.split_once('/'))
            })
            .or_else(|| {
                url.strip_prefix("git@")
                    .and_then(|rest| rest.split_once(':'))
            })
            .map(|(_, path)| path)?;
        let mut segments = path.trim_matches('/').split('/');
        let owner = segments.next()?.trim();
        let repo = segments.next()?.trim();
        if owner.is_empty() || repo.is_empty() {
            return None;
        }
        Some((owner.to_string(), url.starts_with("http")))
    }

    /// Maps Git stderr output to structured, user-friendly CommandErrors.
    fn map_remote_error(stderr: &str, operation: &str) -> CommandError {
        let trimmed = stderr.trim();

        if trimmed.contains("Could not resolve host")
            || trimmed.contains("Failed to connect to")
            || trimmed.contains("Connection timed out")
            || trimmed.contains("Network is unreachable")
            || trimmed.contains("unable to access")
        {
            return CommandError::new(
                "NETWORK_ERROR",
                format!("Ağ bağlantı hatası oluştu: {}", trimmed),
                true,
            );
        }

        if trimmed.contains("Authentication failed")
            || trimmed.contains("Permission denied (publickey)")
            || trimmed.contains("terminal prompts disabled")
            || trimmed.contains("fatal: could not read Username")
            || trimmed.contains("fatal: could not read Password")
        {
            return CommandError::new(
                "AUTH_REQUIRED",
                format!(
                    "Uzak sunucu kimlik doğrulaması başarısız oldu veya yetki yetersiz: {}",
                    trimmed
                ),
                true,
            );
        }

        if trimmed.contains("does not appear to be a git repository")
            || trimmed.contains("Could not read from remote repository")
        {
            return CommandError::new(
                "REMOTE_NOT_FOUND",
                format!("Uzak depo bulunamadı veya erişilemedi: {}", trimmed),
                true,
            );
        }

        CommandError::new(
            "GIT_COMMAND_FAILED",
            format!("{} işlemi başarısız oldu: {}", operation, trimmed),
            true,
        )
    }
}

#[cfg(test)]
mod remote_owner_tests {
    use super::GitRemoteManager;

    #[test]
    fn parses_https_and_ssh_remote_shapes() {
        let cases = [
            ("https://github.com/acme/repo.git", "acme", true),
            ("https://github.com/acme/repo", "acme", true),
            ("git@github.com:acme/repo.git", "acme", false),
            ("git@github-alt:acme/repo.git", "acme", false),
            ("ssh://git@github.com/acme/repo.git", "acme", false),
        ];
        for (url, owner, https) in cases {
            let (got_owner, got_https) = GitRemoteManager::parse_remote_owner(url)
                .unwrap_or_else(|| panic!("parse failed: {url}"));
            assert_eq!(got_owner, owner, "owner for {url}");
            assert_eq!(got_https, https, "https flag for {url}");
        }
    }

    #[test]
    fn rejects_malformed_or_unrelated_urls() {
        for url in [
            "",
            "not-a-url",
            "https://github.com/onlyowner",
            "https://github.com/",
            "git@github.com:owneronly",
            "file:///tmp/repo",
        ] {
            assert!(
                GitRemoteManager::parse_remote_owner(url).is_none(),
                "should reject: {url:?}"
            );
        }
    }
}
