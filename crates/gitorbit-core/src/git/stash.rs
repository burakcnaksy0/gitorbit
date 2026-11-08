use crate::errors::CommandError;
use crate::git::adapter::GitAdapter;
use crate::git::status::GitStatusParser;
use crate::models::{GitStatus, StashEntry};
use std::path::Path;
use std::time::Duration;

const STASH_TIMEOUT: Duration = Duration::from_secs(60);

/// `git stash` yüzeyi: kirli çalışma ağacını kenara al / geri yükle.
///
/// Güvenlik ilkeleri:
/// - Yalnızca `stash@{N}` biçiminde (N rakam) referans kabul edilir — enjeksiyon guard.
/// - apply/pop çakışma üretirse stash SİLİNMEZ; `CONFLICTS_PRESENT` hatası ve
///   "stash korundu" ipucuyla döner (pop, apply başarısızsa drop etmez).
pub struct GitStashManager;

impl GitStashManager {
    /// Kullanıcı girdisi stash referansını (`0`, `1`, ...) güvenli `stash@{N}`
    /// biçimine çevirir. Hatalı girdi reddedilir. Saf fonksiyon — testli.
    pub fn parse_ref(id: &str) -> Result<String, CommandError> {
        let trimmed = id.trim();
        let digits_only = !trimmed.is_empty()
            && trimmed.chars().all(|c| c.is_ascii_digit())
            && trimmed.parse::<u32>().is_ok();
        if !digits_only {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                "Geçersiz stash referansı (yalnızca sayı).",
                true,
            ));
        }
        Ok(format!("stash@{{{}}}", trimmed))
    }

    /// `git stash list --format` çıktısını ayrıştırır. Saf fonksiyon — testli.
    pub fn parse_list(raw: &str) -> Vec<StashEntry> {
        raw.lines()
            .filter_map(|line| {
                let mut parts = line.split('\u{0}');
                let id = parts.next()?.trim();
                let subject = parts.next()?.trim();
                let date = parts.next().unwrap_or("").trim();
                let index = id.strip_prefix("stash@{")?.trim_end_matches('}');
                // `WIP on main: abc123 message` / `On main: message` önekini soy.
                let message = subject
                    .strip_prefix("WIP on ")
                    .or_else(|| subject.strip_prefix("On "))
                    .unwrap_or(subject)
                    .to_string();
                Some(StashEntry {
                    index: index.to_string(),
                    message,
                    date: date.to_string(),
                })
            })
            .collect()
    }

    /// Kenara alınacak içerik var mı? (staged + unstaged [+ untracked])
    fn has_changeable_content(status: &GitStatus, include_untracked: bool) -> bool {
        !status.staged_files.is_empty()
            || !status.unstaged_files.is_empty()
            || (include_untracked && !status.untracked_files.is_empty())
    }

    pub fn push(
        repo_dir: &Path,
        message: &str,
        include_untracked: bool,
    ) -> Result<GitStatus, CommandError> {
        let canonical_repo = repo_dir
            .canonicalize()
            .map_err(|e| CommandError::io_error(format!("Geçersiz depo dizini: {}", e)))?;

        let status = GitStatusParser::get_status(&canonical_repo)?;
        if !Self::has_changeable_content(&status, include_untracked) {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                "Kenara alınacak değişiklik bulunmuyor.",
                true,
            ));
        }

        let message = message.trim();
        let mut args: Vec<&str> = vec!["stash", "push"];
        if include_untracked {
            args.push("-u");
        }
        if !message.is_empty() {
            args.push("-m");
            args.push(message);
        }

        let output = GitAdapter::execute_with_timeout(&canonical_repo, &args, STASH_TIMEOUT)?;
        Self::check_success(&output, "Stash alınırken hata oluştu.")?;
        GitStatusParser::get_status(&canonical_repo)
    }

    pub fn list(repo_dir: &Path) -> Result<Vec<StashEntry>, CommandError> {
        let canonical_repo = repo_dir
            .canonicalize()
            .map_err(|e| CommandError::io_error(format!("Geçersiz depo dizini: {}", e)))?;
        let output = GitAdapter::execute_with_timeout(
            &canonical_repo,
            &["stash", "list", "--format=%gd%x00%gs%x00%ci"],
            STASH_TIMEOUT,
        )?;
        Self::check_success(&output, "Stash listesi alınamadı.")?;
        Ok(Self::parse_list(&String::from_utf8_lossy(&output.stdout)))
    }

    /// `action`: `"apply"` veya `"pop"`. Pop yalnız çakışmasız başarılı olur;
    /// çakışmada stash korunur ve CONFLICTS_PRESENT döner.
    pub fn apply_or_pop(
        repo_dir: &Path,
        id: &str,
        action: &str,
    ) -> Result<GitStatus, CommandError> {
        let canonical_repo = repo_dir
            .canonicalize()
            .map_err(|e| CommandError::io_error(format!("Geçersiz depo dizini: {}", e)))?;
        let stash_ref = Self::parse_ref(id)?;

        let argv: Vec<&str> = match action {
            "pop" => vec!["stash", "pop", stash_ref.as_str()],
            "apply" => vec!["stash", "apply", stash_ref.as_str()],
            _ => {
                return Err(CommandError::new(
                    "VALIDATION_ERROR",
                    "Geçersiz stash eylemi (apply veya pop olmalı).",
                    true,
                ));
            }
        };
        let output = GitAdapter::execute_with_timeout(&canonical_repo, &argv, STASH_TIMEOUT)?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            // git stash pop çakışmada CONFLICT satırlarını STDOUT'a yazar
            // ("The stash entry is kept..." de orada) — iki akışı da incele.
            if stderr.contains("CONFLICT")
                || stdout.contains("CONFLICT")
                || stderr.contains("error: could not restore")
            {
                return Err(CommandError::new(
                    "CONFLICTS_PRESENT",
                    format!(
                        "Stash geri yüklenirken çakışma oluştu. '{}' stash'i SİLİNMEDİ — \
                         mevcut değişiklikleri commit'leyip tekrar deneyin veya stash'i \
                         Geçmiş/Dallar üzerinden yönetin.",
                        stash_ref
                    ),
                    true,
                ));
            }
            return Err(CommandError::new(
                "GIT_COMMAND_FAILED",
                format!("Stash geri yüklenemedi: {}", stderr.trim()),
                true,
            ));
        }
        GitStatusParser::get_status(&canonical_repo)
    }

    pub fn drop(repo_dir: &Path, id: &str) -> Result<Vec<StashEntry>, CommandError> {
        let canonical_repo = repo_dir
            .canonicalize()
            .map_err(|e| CommandError::io_error(format!("Geçersiz depo dizini: {}", e)))?;
        let stash_ref = Self::parse_ref(id)?;
        let output = GitAdapter::execute_with_timeout(
            &canonical_repo,
            &["stash", "drop", &stash_ref],
            STASH_TIMEOUT,
        )?;
        Self::check_success(&output, "Stash silinemedi.")?;
        Self::list(&canonical_repo)
    }

    fn check_success(output: &std::process::Output, context: &str) -> Result<(), CommandError> {
        if output.status.success() {
            return Ok(());
        }
        Err(CommandError::new(
            "GIT_COMMAND_FAILED",
            format!(
                "{} {}",
                context,
                String::from_utf8_lossy(&output.stderr).trim()
            ),
            true,
        ))
    }
}

#[cfg(test)]
mod stash_tests {
    use super::GitStashManager;

    #[test]
    fn ref_parsing_accepts_only_indices() {
        assert_eq!(
            GitStashManager::parse_ref("0").unwrap(),
            "stash@{0}".to_string()
        );
        assert_eq!(
            GitStashManager::parse_ref(" 12 ").unwrap(),
            "stash@{12}".to_string()
        );
        for bad in ["", "abc", "0; rm -rf /", "stash@{0}", "-1", "{0}"] {
            assert!(
                GitStashManager::parse_ref(bad).is_err(),
                "kabul edilmemeliydi: {bad:?}"
            );
        }
    }

    #[test]
    fn list_output_is_parsed_and_subject_stripped() {
        let raw = "stash@{0}\u{0}WIP on main: 1a2b3c4 init message\u{0}2026-11-07 01:00:00 +0300\n\
                   stash@{1}\u{0}On main: wip başlığı\u{0}2026-11-06 22:00:00 +0300\n";
        let entries = GitStashManager::parse_list(raw);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].index, "0");
        assert_eq!(entries[0].message, "main: 1a2b3c4 init message");
        assert_eq!(entries[1].index, "1");
        assert_eq!(entries[1].message, "main: wip başlığı");
        assert!(entries[0].date.starts_with("2026-11-07"));
    }

    #[test]
    fn empty_list_yields_no_entries() {
        assert!(GitStashManager::parse_list("").is_empty());
        assert!(GitStashManager::parse_list("\n").is_empty());
    }
}
