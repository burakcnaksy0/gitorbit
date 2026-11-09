use crate::errors::CommandError;
use crate::git::adapter::GitAdapter;
use std::path::{Path, PathBuf};
use std::time::Duration;

const CLONE_TIMEOUT: Duration = Duration::from_secs(120);

pub struct GitCloneManager;

impl GitCloneManager {
    /// Validates a clone URL before it is passed to Git as a single argument.
    ///
    /// Rejects:
    /// - empty values and values that could be interpreted as options (`-...`)
    /// - control characters / whitespace
    /// - embedded HTTP(S) credentials (`https://user:pass@host/...`) so that
    ///   tokens do not leak into process listings.
    pub fn validate_url(url: &str) -> Result<String, CommandError> {
        let trimmed = url.trim();
        if trimmed.is_empty() {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                "Repository adresi boş olamaz.",
                true,
            ));
        }
        if trimmed.starts_with('-') {
            return Err(CommandError::invalid_path(
                "Repository adresi '-' ile başlayamaz.",
            ));
        }
        if trimmed.chars().any(|c| c.is_control() || c.is_whitespace()) {
            return Err(CommandError::invalid_path(
                "Repository adresi boşluk veya kontrol karakteri içeremez.",
            ));
        }

        let supported = ["https://", "http://", "ssh://", "git://", "file://"]
            .iter()
            .any(|prefix| trimmed.starts_with(prefix))
            || (trimmed.contains('@') && trimmed.contains(':') && !trimmed.contains("://"));

        if !supported {
            return Err(CommandError::invalid_path(
                "Desteklenmeyen repository adresi. https://, ssh://, git:// veya git@host:path biçimini kullanın.",
            ));
        }

        if let Some(rest) = trimmed
            .strip_prefix("https://")
            .or_else(|| trimmed.strip_prefix("http://"))
        {
            let authority = rest.split('/').next().unwrap_or("");
            if let Some(userinfo) = authority.rsplit_once('@').map(|(u, _)| u)
                && userinfo.contains(':')
            {
                return Err(CommandError::new(
                    "VALIDATION_ERROR",
                    "Repository adresine gömülü kullanıcı adı/parola kabul edilmez. Sistem Git credential helper'ını kullanın.",
                    true,
                ));
            }
        }

        Ok(trimmed.to_string())
    }

    /// Validates the destination directory and clones `url` into it.
    ///
    /// The destination must be an absolute path whose parent exists. Cloning
    /// into a non-empty existing directory is rejected to avoid overwriting
    /// user files.
    pub fn clone_repository(url: &str, destination: &str) -> Result<PathBuf, CommandError> {
        let url = Self::validate_url(url)?;

        let dest_raw = destination.trim();
        if dest_raw.is_empty() {
            return Err(CommandError::invalid_path(
                "Klonlama hedef klasörü boş olamaz.",
            ));
        }
        let dest = Path::new(dest_raw);
        if !dest.is_absolute() {
            return Err(CommandError::invalid_path(
                "Klonlama hedefi mutlak bir yol olmalıdır.",
            ));
        }

        if dest.exists() {
            if !dest.is_dir() {
                return Err(CommandError::invalid_path(
                    "Klonlama hedefi bir dosya; klasör olmalıdır.",
                ));
            }
            let mut entries = std::fs::read_dir(dest)
                .map_err(|e| CommandError::io_error(format!("Hedef klasör okunamadı: {}", e)))?;
            if entries.next().is_some() {
                return Err(CommandError::invalid_path(
                    "Hedef klasör boş değil. Var olan dosyaların üzerine yazılmaz.",
                ));
            }
        } else {
            let parent = dest.parent().ok_or_else(|| {
                CommandError::invalid_path("Hedef klasörün üst dizini belirlenemedi.")
            })?;
            if !parent.exists() {
                return Err(CommandError::invalid_path(
                    "Hedef klasörün üst dizini mevcut değil.",
                ));
            }
        }

        let dest_str = dest.to_string_lossy().to_string();
        let work_dir = dest.parent().unwrap_or(Path::new("."));
        let output = GitAdapter::execute_with_env_and_timeout(
            work_dir,
            &["clone", "--", &url, &dest_str],
            &[("GIT_TERMINAL_PROMPT", "0"), ("GIT_ASKPASS", "echo")],
            Some(CLONE_TIMEOUT),
        )?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // Best-effort cleanup of a partially created clone directory.
            if dest.exists()
                && dest
                    .read_dir()
                    .map(|mut d| d.next().is_some())
                    .unwrap_or(false)
            {
                // Do not remove recursively: leave the user's directory intact
                // and report it, rather than risking deleting unrelated files.
            }
            let code = if stderr.contains("Authentication failed")
                || stderr.contains("could not read Username")
                || stderr.contains("Permission denied")
            {
                "AUTH_REQUIRED"
            } else if stderr.contains("Could not resolve host")
                || stderr.contains("unable to access")
                || stderr.contains("Failed to connect")
            {
                "NETWORK_ERROR"
            } else if stderr.contains("already exists") {
                "VALIDATION_ERROR"
            } else {
                "GIT_COMMAND_FAILED"
            };
            return Err(CommandError::new(
                code,
                format!("Klonlama başarısız oldu: {}", stderr.trim()),
                true,
            ));
        }

        Ok(dest.to_path_buf())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_option_injection() {
        assert!(GitCloneManager::validate_url("--upload-pack=evil").is_err());
    }

    #[test]
    fn rejects_embedded_credentials() {
        let err = GitCloneManager::validate_url("https://user:secret@github.com/org/repo.git")
            .unwrap_err();
        assert_eq!(err.code, "VALIDATION_ERROR");
        assert!(!err.message.contains("secret"));
    }

    #[test]
    fn accepts_common_clone_urls() {
        assert!(GitCloneManager::validate_url("https://github.com/org/repo.git").is_ok());
        assert!(GitCloneManager::validate_url("git@github.com:org/repo.git").is_ok());
        assert!(GitCloneManager::validate_url("ssh://git@github.com/org/repo.git").is_ok());
    }

    #[test]
    fn rejects_non_empty_destination() {
        let dir = std::env::temp_dir().join(format!(
            "gybe-clone-test-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("keep.txt"), "user data").unwrap();

        let err = GitCloneManager::clone_repository(
            "https://github.com/org/repo.git",
            dir.to_str().unwrap(),
        )
        .unwrap_err();
        assert_eq!(err.code, "INVALID_PATH");
        assert!(dir.join("keep.txt").exists());
        std::fs::remove_dir_all(&dir).ok();
    }
}
