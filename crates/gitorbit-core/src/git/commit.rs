use crate::errors::CommandError;
use crate::git::adapter::GitAdapter;
use crate::models::{CommitResult, GitIdentity};
use std::path::Path;
use std::time::Duration;

const COMMIT_TIMEOUT: Duration = Duration::from_secs(60);

pub struct GitCommitManager;

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
}
