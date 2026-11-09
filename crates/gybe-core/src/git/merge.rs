use crate::errors::CommandError;
use crate::git::adapter::GitAdapter;
use crate::git::remote::GitRemoteManager;
use crate::git::status::GitStatusParser;
use crate::models::{GitStatus, RepositoryOperationState};
use std::path::Path;
use std::time::Duration;

const MERGE_TIMEOUT: Duration = Duration::from_secs(90);

pub struct GitMergeManager;

impl GitMergeManager {
    fn state_error(state: RepositoryOperationState) -> CommandError {
        let code = match state {
            RepositoryOperationState::MergeInProgress => "MERGE_IN_PROGRESS",
            RepositoryOperationState::RebaseInProgress => "REBASE_IN_PROGRESS",
            RepositoryOperationState::CherryPickInProgress => "CHERRY_PICK_IN_PROGRESS",
            RepositoryOperationState::RevertInProgress => "REVERT_IN_PROGRESS",
            RepositoryOperationState::BisectInProgress => "BISECT_IN_PROGRESS",
            RepositoryOperationState::Normal => "VALIDATION_ERROR",
        };
        CommandError::new(
            code,
            "Depoda devam eden bir Git işlemi var. Önce onu tamamlayın veya iptal edin.",
            true,
        )
        .with_recovery_hint(
            "Devam eden işlemi bitirmek için Continue, iptal etmek için Abort kullanın.",
        )
    }

    /// Merges `branch` into the active branch.
    ///
    /// Safety invariants:
    /// - Never runs `reset --hard` or `clean`.
    /// - Refuses to start when another operation is in progress.
    /// - On conflict returns `CONFLICTS_PRESENT` and leaves the repository in
    ///   `merge_in_progress` so the user can resolve files and continue/abort.
    pub fn merge_branch(repo_dir: &Path, branch: &str) -> Result<GitStatus, CommandError> {
        GitRemoteManager::validate_name(branch, "Branch adı")?;

        let state = crate::git::GitOperationStateManager::detect_state(repo_dir);
        if state != RepositoryOperationState::Normal {
            return Err(Self::state_error(state));
        }

        let output = GitAdapter::execute_with_env_and_timeout(
            repo_dir,
            &["merge", "--no-edit", "--", branch],
            &[("GIT_TERMINAL_PROMPT", "0"), ("GIT_EDITOR", "true")],
            Some(MERGE_TIMEOUT),
        )?;

        let status = GitStatusParser::get_status(repo_dir)?;

        if !output.status.success() {
            if status.operation_state == RepositoryOperationState::MergeInProgress
                || !status.conflicted_files.is_empty()
            {
                return Err(CommandError::new(
                    "CONFLICTS_PRESENT",
                    "Merge sırasında çakışma oluştu. Çakışan dosyaları çözdükten sonra Continue kullanın.",
                    true,
                )
                .with_safe_details(format!(
                    "Çakışan dosyalar: {}",
                    status.conflicted_files.join(", ")
                ))
                .with_recovery_hint(
                    "Dosyaları harici editörde çözüp stage edin, sonra Continue ile merge'i tamamlayın.",
                ));
            }

            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(CommandError::new(
                "GIT_COMMAND_FAILED",
                format!("Merge başarısız oldu: {}", stderr.trim()),
                true,
            ));
        }

        Ok(status)
    }

    /// Continues the in-progress merge/rebase/cherry-pick/revert operation.
    pub fn continue_operation(repo_dir: &Path) -> Result<GitStatus, CommandError> {
        let state = crate::git::GitOperationStateManager::detect_state(repo_dir);

        let args: Vec<&str> = match state {
            RepositoryOperationState::MergeInProgress => {
                let status = GitStatusParser::get_status(repo_dir)?;
                if !status.conflicted_files.is_empty() {
                    return Err(CommandError::new(
                        "CONFLICTS_PRESENT",
                        "Çözülmemiş çakışan dosyalar var. Önce tüm çakışmaları çözüp stage edin.",
                        true,
                    )
                    .with_safe_details(format!(
                        "Çakışan dosyalar: {}",
                        status.conflicted_files.join(", ")
                    )));
                }
                vec!["commit", "--no-edit"]
            }
            RepositoryOperationState::RebaseInProgress => vec!["rebase", "--continue"],
            RepositoryOperationState::CherryPickInProgress => vec!["cherry-pick", "--continue"],
            RepositoryOperationState::RevertInProgress => vec!["revert", "--continue"],
            RepositoryOperationState::BisectInProgress => {
                return Err(CommandError::new(
                    "OPERATION_NOT_SUPPORTED",
                    "Bisect işlemi Gybe içinden sürdürülemez.",
                    false,
                ));
            }
            RepositoryOperationState::Normal => {
                return Err(CommandError::new(
                    "INVALID_STATE",
                    "Devam eden bir Git işlemi yok.",
                    true,
                ));
            }
        };

        let output = GitAdapter::execute_with_env_and_timeout(
            repo_dir,
            &args,
            &[
                ("GIT_TERMINAL_PROMPT", "0"),
                ("GIT_EDITOR", "true"),
                ("GIT_SEQUENCE_EDITOR", "true"),
            ],
            Some(MERGE_TIMEOUT),
        )?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let status = GitStatusParser::get_status(repo_dir).ok();
            if let Some(status) = &status
                && !status.conflicted_files.is_empty()
            {
                return Err(CommandError::new(
                    "CONFLICTS_PRESENT",
                    "İşlem hâlâ çakışan dosyalar içeriyor. Çakışmaları çözüp tekrar deneyin.",
                    true,
                )
                .with_safe_details(format!(
                    "Çakışan dosyalar: {}",
                    status.conflicted_files.join(", ")
                )));
            }
            return Err(CommandError::new(
                "GIT_COMMAND_FAILED",
                format!("İşlem sürdürülemedi: {}", stderr.trim()),
                true,
            ));
        }

        GitStatusParser::get_status(repo_dir)
    }

    /// Aborts the in-progress operation.
    ///
    /// CRITICAL: this is destructive for uncommitted conflict resolutions.
    /// The UI MUST show an explicit confirmation before calling it.
    pub fn abort_operation(repo_dir: &Path) -> Result<GitStatus, CommandError> {
        let state = crate::git::GitOperationStateManager::detect_state(repo_dir);

        let args: Vec<&str> = match state {
            RepositoryOperationState::MergeInProgress => vec!["merge", "--abort"],
            RepositoryOperationState::RebaseInProgress => vec!["rebase", "--abort"],
            RepositoryOperationState::CherryPickInProgress => vec!["cherry-pick", "--abort"],
            RepositoryOperationState::RevertInProgress => vec!["revert", "--abort"],
            RepositoryOperationState::BisectInProgress => vec!["bisect", "reset"],
            RepositoryOperationState::Normal => {
                return Err(CommandError::new(
                    "INVALID_STATE",
                    "İptal edilecek bir Git işlemi yok.",
                    true,
                ));
            }
        };

        let output = GitAdapter::execute_with_env_and_timeout(
            repo_dir,
            &args,
            &[("GIT_TERMINAL_PROMPT", "0")],
            Some(MERGE_TIMEOUT),
        )?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(CommandError::new(
                "GIT_COMMAND_FAILED",
                format!("İşlem iptal edilemedi: {}", stderr.trim()),
                true,
            ));
        }

        GitStatusParser::get_status(repo_dir)
    }

    /// Çakışan tek bir dosyayı taraf seçerek çözer:
    /// `git checkout --ours|--theirs -- <path>` + `git add -- <path>`.
    ///
    /// Güvenlik kuralları:
    /// - Yalnızca devam eden bir işlem VARSA (`operation_state != normal`) çalışır —
    ///   normal durumda sessiz stage/dosya yazımı yapılmaz.
    /// - Yalnızca status'un çakışmalı bildirdiği yollar kabul edilir.
    /// - Yol doğrulaması: boş, mutlak, `..` içeren veya `-` ile başlayan girdiler
    ///   reddedilir (bayrak enjeksiyonu koruması).
    /// - "Karma içerik" çözümü bilinçli olarak burada YOK — o iş editöre devredilir
    ///   (Dosyayı Aç + Çözüldü işaretle akışı).
    pub fn resolve_with_side(
        repo_dir: &Path,
        path: &str,
        ours: bool,
    ) -> Result<GitStatus, CommandError> {
        let canonical_repo = repo_dir
            .canonicalize()
            .map_err(|e| CommandError::io_error(format!("Geçersiz depo dizini: {}", e)))?;
        let path = path.trim();

        if path.is_empty() || path.starts_with('-') || path.starts_with('/') || path.contains("..")
        {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                "Geçersiz dosya yolu.",
                true,
            ));
        }

        let state = crate::git::GitOperationStateManager::detect_state(&canonical_repo);
        if state == RepositoryOperationState::Normal {
            return Err(CommandError::new(
                "INVALID_STATE",
                "Devam eden bir çakışma işlemi yok; taraf seçimi yapılamaz.",
                true,
            ));
        }

        let status = GitStatusParser::get_status(&canonical_repo)?;
        if !status.conflicted_files.iter().any(|f| f == path) {
            return Err(CommandError::new(
                "NOT_CONFLICTED",
                format!("{} çakışmalı dosyalar arasında değil.", path),
                true,
            ));
        }

        let side = if ours { "ours" } else { "theirs" };
        let checkout = GitAdapter::execute_with_env_and_timeout(
            &canonical_repo,
            &["checkout", format!("--{}", side).as_str(), "--", path],
            &[("GIT_TERMINAL_PROMPT", "0")],
            Some(MERGE_TIMEOUT),
        )?;
        if !checkout.status.success() {
            let stderr = String::from_utf8_lossy(&checkout.stderr);
            return Err(CommandError::new(
                "GIT_COMMAND_FAILED",
                format!(
                    "Dosya {} tarafıyla çözülemedi: {}",
                    if ours { "bizim" } else { "onların" },
                    stderr.trim()
                ),
                true,
            ));
        }

        let add = GitAdapter::execute_with_env_and_timeout(
            &canonical_repo,
            &["add", "--", path],
            &[("GIT_TERMINAL_PROMPT", "0")],
            Some(MERGE_TIMEOUT),
        )?;
        if !add.status.success() {
            let stderr = String::from_utf8_lossy(&add.stderr);
            return Err(CommandError::new(
                "GIT_COMMAND_FAILED",
                format!("Dosya stage edilemedi: {}", stderr.trim()),
                true,
            ));
        }

        GitStatusParser::get_status(&canonical_repo)
    }
}
