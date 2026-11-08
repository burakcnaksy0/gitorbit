use crate::errors::CommandError;
use crate::git::adapter::GitAdapter;
use crate::models::{CommitResult, GitIdentity};
use std::path::Path;
use std::time::Duration;

const COMMIT_TIMEOUT: Duration = Duration::from_secs(60);

pub struct GitCommitManager;

/// GO-05c: commit mesajı karakter kapısı. Yazılabilir karakterler ile satır
/// sonu (`\n`) ve sekme (`\t`) serbest; diğer ASCII kontrol karakterleri ve
/// DEL (0x7F) REDDEDİLİR. ANSI kaçış dizileri (ESC, 0x1B) bu kapıdan geçemez
/// — terminali manipüle eden içerik commit geçmişine/terminal loglarına
/// taşınamaz (ör. `git log` çıktısına gizli ANSI enjekte eden mesajlar).
fn validate_commit_message(message: &str) -> Result<(), CommandError> {
    if let Some((idx, ch)) = message
        .chars()
        .enumerate()
        .find(|(_, c)| (c.is_ascii_control() && *c != '\n' && *c != '\t') || *c == '\u{7f}')
    {
        return Err(CommandError::new(
            "VALIDATION_ERROR",
            format!(
                "Commit mesajı geçersiz kontrol karakteri içeriyor (konum {}, U+{:04X}). Yalnızca yazılabilir karakterler, satır sonu ve sekme kullanılabilir.",
                idx, ch as u32
            ),
            true,
        ));
    }
    Ok(())
}

impl GitCommitManager {
    /// Reads effective Git user.name and user.email for the repository.
    pub fn get_identity(repo_dir: &Path) -> Result<GitIdentity, CommandError> {
        let canonical_repo = repo_dir
            .canonicalize()
            .map_err(|e| CommandError::io_error(format!("Geçersiz depo dizini: {}", e)))?;

        let name_output = GitAdapter::execute(&canonical_repo, &["config", "user.name"]);
        let name = match name_output {
            Ok(out) if out.status.success() => {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if s.is_empty() { None } else { Some(s) }
            }
            _ => None,
        };

        let email_output = GitAdapter::execute(&canonical_repo, &["config", "user.email"]);
        let email = match email_output {
            Ok(out) if out.status.success() => {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if s.is_empty() { None } else { Some(s) }
            }
            _ => None,
        };

        Ok(GitIdentity { name, email })
    }

    /// Sets repository-local Git identity (user.name and user.email).
    pub fn set_identity(
        repo_dir: &Path,
        name: &str,
        email: &str,
    ) -> Result<GitIdentity, CommandError> {
        let canonical_repo = repo_dir
            .canonicalize()
            .map_err(|e| CommandError::io_error(format!("Geçersiz depo dizini: {}", e)))?;

        let trimmed_name = name.trim();
        let trimmed_email = email.trim();

        if trimmed_name.is_empty() {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                "İsim (user.name) alanı boş olamaz.",
                true,
            ));
        }

        if trimmed_email.is_empty() || !trimmed_email.contains('@') {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                "Geçerli bir e-posta (user.email) girilmelidir.",
                true,
            ));
        }

        let name_res = GitAdapter::execute(
            &canonical_repo,
            &["config", "--local", "--", "user.name", trimmed_name],
        )?;
        if !name_res.status.success() {
            let stderr = String::from_utf8_lossy(&name_res.stderr);
            return Err(CommandError::new(
                "GIT_COMMAND_FAILED",
                format!("user.name ayarlanamadı: {}", stderr.trim()),
                true,
            ));
        }

        let email_res = GitAdapter::execute(
            &canonical_repo,
            &["config", "--local", "--", "user.email", trimmed_email],
        )?;
        if !email_res.status.success() {
            let stderr = String::from_utf8_lossy(&email_res.stderr);
            return Err(CommandError::new(
                "GIT_COMMAND_FAILED",
                format!("user.email ayarlanamadı: {}", stderr.trim()),
                true,
            ));
        }

        Ok(GitIdentity {
            name: Some(trimmed_name.to_string()),
            email: Some(trimmed_email.to_string()),
        })
    }

    /// Creates a commit with the provided message.
    ///
    /// Safety & validation checks:
    /// 1. Message must not be empty after trimming.
    /// 2. Must have staged files.
    /// 3. Effective git user.name and user.email must be configured (Identity Guard).
    /// 4. Amend is rejected in Faz 4 (history rewrite is out of scope).
    /// 5. Does not use shell concatenation; arguments passed cleanly.
    pub fn commit(
        repo_dir: &Path,
        message: &str,
        amend: bool,
    ) -> Result<CommitResult, CommandError> {
        let canonical_repo = repo_dir
            .canonicalize()
            .map_err(|e| CommandError::io_error(format!("Geçersiz depo dizini: {}", e)))?;

        let trimmed_message = message.trim();
        if trimmed_message.is_empty() {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                "Commit mesajı boş olamaz.",
                true,
            ));
        }
        // GO-05c: boşluk kontrolünden sonra karakter kapısı (ansi escape vb.)
        validate_commit_message(trimmed_message)?;

        // Amend rewrites existing history. Faz 4 does not expose this flow;
        // reject it rather than silently rewriting the last commit.
        if amend {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                "Commit amend Faz 4 kapsamında desteklenmez. Mevcut geçmiş sessizce değiştirilmez.",
                true,
            ));
        }

        // 1. Check staged changes
        let status = crate::git::GitStatusParser::get_status(&canonical_repo)?;
        if status.staged_files.is_empty() {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                "Commit edilecek staged değişiklik yok. Önce dosyaları stage edin.",
                true,
            ));
        }

        // 2. Identity guard check
        let identity = Self::get_identity(&canonical_repo)?;
        let name_valid = identity
            .name
            .as_deref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false);
        let email_valid = identity
            .email
            .as_deref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false);

        if !name_valid || !email_valid {
            return Err(CommandError::new(
                "IDENTITY_MISSING",
                "Git kullanıcı kimliği (user.name veya user.email) eksik. Lütfen commit oluşturmadan önce repository kimliğinizi yapılandırın.",
                true,
            ));
        }

        // 3. Execute git commit (argument list, never a shell string).
        let args = ["commit", "-m", trimmed_message];
        let output = GitAdapter::execute_with_timeout(&canonical_repo, &args, COMMIT_TIMEOUT)?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(CommandError::new(
                "GIT_COMMAND_FAILED",
                format!("Commit başarısız oldu: {}", stderr.trim()),
                true,
            ));
        }

        // 4. Retrieve new commit SHA
        let sha_output = GitAdapter::execute(&canonical_repo, &["rev-parse", "HEAD"])?;
        let commit_sha = if sha_output.status.success() {
            String::from_utf8_lossy(&sha_output.stdout)
                .trim()
                .to_string()
        } else {
            return Err(CommandError::new(
                "GIT_COMMAND_FAILED",
                "Yeni commit SHA'sı okunamadı.",
                true,
            ));
        };

        // 5. Read refreshed Git status
        let fresh_status = crate::git::GitStatusParser::get_status(&canonical_repo)?;

        Ok(CommitResult {
            commit_sha,
            status: fresh_status,
        })
    }

    /// Amend-güvenliği kararının saf hali:
    /// - upstream varsa: son commit yalnızca `ahead > 0` ise upstream'de değildir.
    /// - upstream yoksa: HEAD herhangi bir uzak-takip dalındaysa push edilmiştir.
    /// Saf fonksiyon — birim testli.
    pub fn amend_allowed(upstream: Option<&str>, ahead: u32, head_on_remote: bool) -> bool {
        match upstream {
            Some(_) => ahead > 0,
            None => !head_on_remote,
        }
    }

    /// HEAD'in herhangi bir uzak-takip dalında (origin/main vb.) bulunup
    /// bulunmadığını `git branch -r --contains HEAD` ile sorgular.
    fn head_on_remote_branch(repo_dir: &Path) -> Result<bool, CommandError> {
        let output = GitAdapter::execute_with_timeout(
            repo_dir,
            &["branch", "--remotes", "--contains", "HEAD"],
            COMMIT_TIMEOUT,
        )?;
        Ok(output.status.success()
            && !String::from_utf8_lossy(&output.stdout).trim().is_empty())
    }

    /// Son commit'in **yalnızca mesajını** yeniden yazar (`commit --amend --only`).
    ///
    /// Faz 4 ilkesi korunur: geçmiş sessizce değiştirilmez.
    /// - Yalnızca mesaj değişir; staged/unstaged içerik commit'e eklenmez
    ///   (`--only`, staged dosyalar oldugu yerde kalır).
    /// - Son commit upstream'e (veya herhangi bir uzak dalın tarihçesine)
    ///   ulaşmışsa `AMEND_PUSHED` ile reddedilir.
    /// - Unborn HEAD / detached HEAD reddedilir.
    pub fn amend_message(
        repo_dir: &Path,
        new_message: &str,
    ) -> Result<CommitResult, CommandError> {
        let canonical_repo = repo_dir
            .canonicalize()
            .map_err(|e| CommandError::io_error(format!("Geçersiz depo dizini: {}", e)))?;

        let message = new_message.trim();
        if message.is_empty() {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                "Commit mesajı boş olamaz.",
                true,
            ));
        }
        // GO-05c: commit() ile aynı karakter kapısı — amend bypass olamaz.
        validate_commit_message(message)?;

        // 1. HEAD exists? (unborn HEAD has nothing to amend)
        let head_exists = GitAdapter::execute_with_timeout(
            &canonical_repo,
            &["rev-parse", "--verify", "--quiet", "HEAD"],
            COMMIT_TIMEOUT,
        )
        .map(|o| o.status.success())
        .unwrap_or(false);
        if !head_exists {
            return Err(CommandError::new(
                "NO_COMMITS",
                "Düzenlenecek son commit bulunmuyor (depo henüz boş).",
                true,
            ));
        }

        // 2. Detached HEAD: dalı kaydıracağı için bilincli olarak reddedilir.
        let status = crate::git::GitStatusParser::get_status(&canonical_repo)?;
        if status.is_detached_head || status.branch.is_none() {
            return Err(CommandError::new(
                "DETACHED_HEAD",
                "Başlısız HEAD durumunda commit mesajı düzenlenemez.",
                true,
            ));
        }

        // 3. Push-guard: commit henüz uzakta olmali.
        let head_on_remote = if status.upstream.is_some() {
            false
        } else {
            Self::head_on_remote_branch(&canonical_repo)?
        };
        if !Self::amend_allowed(status.upstream.as_deref(), status.ahead, head_on_remote) {
            return Err(CommandError::new(
                "AMEND_PUSHED",
                "Son commit zaten push edilmiş görünüyor; push edilmiş geçmiş bu arayüzden yeniden yazılamaz. Bunun yerine yeni bir commit atın.",
                false,
            ));
        }

        // 4. Message-only amend: --only, staged içerigi bu commit'e katmaz.
        let output = GitAdapter::execute_with_timeout(
            &canonical_repo,
            &["commit", "--amend", "--only", "-m", message],
            COMMIT_TIMEOUT,
        )?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(CommandError::new(
                "GIT_COMMAND_FAILED",
                format!("Commit mesajı güncellenemedi: {}", stderr.trim()),
                true,
            ));
        }

        // 5. Yeni SHA + tazelenmiş durum
        let sha_output = GitAdapter::execute_with_timeout(
            &canonical_repo,
            &["rev-parse", "HEAD"],
            COMMIT_TIMEOUT,
        )?;
        let commit_sha = String::from_utf8_lossy(&sha_output.stdout)
            .trim()
            .to_string();
        let fresh_status = crate::git::GitStatusParser::get_status(&canonical_repo)?;

        Ok(CommitResult {
            commit_sha,
            status: fresh_status,
        })
    }
}

#[cfg(test)]
mod amend_tests {
    use super::GitCommitManager;

    #[test]
    fn amend_guard_requires_unpushed_head() {
        // Upstream var: ahead>0 ise son commit upstream'de değil → serbest.
        assert!(GitCommitManager::amend_allowed(Some("origin/main"), 1, false));
        assert!(GitCommitManager::amend_allowed(Some("origin/main"), 7, false));
        // ahead == 0 → son commit push edilmiş → reddedilir.
        assert!(!GitCommitManager::amend_allowed(Some("origin/main"), 0, false));
        // Upstream yok ama HEAD baska bir uzak dalda → reddedilir.
        assert!(!GitCommitManager::amend_allowed(None, 0, true));
        // Tamamen yerel dal → serbest.
        assert!(GitCommitManager::amend_allowed(None, 0, false));
    }
}

// ---------------------------------------------------------------------------
// GO-05c: karakter kapısı birim testleri
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::validate_commit_message;

    #[test]
    fn go05c_normal_and_multiline_messages_accepted() {
        assert!(validate_commit_message("Fix login flow").is_ok());
        assert!(validate_commit_message("Başlık\n\nGövde satırı\tsekme ile").is_ok());
        assert!(validate_commit_message("Türkçe karakterler: çğıöşü ✓ emoji 🚀").is_ok());
    }

    #[test]
    fn go05c_control_characters_rejected() {
        // NUL, Bell, CR, ESC (ANSI kaçış dizilerinin başlangıcı) reddedilmeli
        for bad in ["a\u{0}b", "risk\u{7}", "satır\u{d}sonu", "\u{1b}[31mkırmızı\u{1b}[0m"] {
            let err = validate_commit_message(bad).expect_err("kontrol karakteri geçmemeli");
            assert_eq!(err.code, "VALIDATION_ERROR");
        }
        // DEL de reddedilir
        assert!(validate_commit_message("del\u{7f}sonu").is_err());
    }
}
