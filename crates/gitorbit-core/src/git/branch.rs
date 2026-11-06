use crate::errors::CommandError;
use crate::git::adapter::GitAdapter;
use crate::models::{BranchInfo, GitStatus};
use std::path::Path;

pub struct GitBranchManager;

impl GitBranchManager {
    /// Lists all local and remote branches in the repository.
    pub fn list_branches(repo_dir: &Path) -> Result<Vec<BranchInfo>, CommandError> {
        let canonical_repo = repo_dir
            .canonicalize()
            .map_err(|e| CommandError::io_error(format!("Geçersiz depo dizini: {}", e)))?;

        // Format: %(refname)%00%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(subject)%00%(HEAD)
        let output = GitAdapter::execute(
            &canonical_repo,
            &[
                "for-each-ref",
                "--format=%(refname)%00%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(subject)%00%(HEAD)",
                "refs/heads",
                "refs/remotes",
            ],
        )?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(CommandError::new(
                "GIT_COMMAND_FAILED",
                format!("Branch listesi alınamadı: {}", stderr.trim()),
                true,
            ));
        }

        let raw = String::from_utf8_lossy(&output.stdout);
        let mut branches = Vec::new();

        for line in raw.lines() {
            let parts: Vec<&str> = line.split('\0').collect();
            if parts.len() < 6 {
                continue;
            }

            let full_ref = parts[0];
            let short_ref = parts[1];
            let short_sha = parts[2];
            let upstream = parts[3];
            let subject = parts[4];
            let head_indicator = parts[5];

            // Ignore symbolic HEAD pointers like origin/HEAD
            if full_ref.ends_with("/HEAD") {
                continue;
            }

            let is_remote = full_ref.starts_with("refs/remotes/");
            let is_current = head_indicator.trim() == "*";

            branches.push(BranchInfo {
                name: short_ref.to_string(),
                is_current,
                is_remote,
                upstream: if upstream.is_empty() {
                    None
                } else {
                    Some(upstream.to_string())
                },
                last_commit_hash: if short_sha.is_empty() {
                    None
                } else {
                    Some(short_sha.to_string())
                },
                last_commit_message: if subject.is_empty() {
                    None
                } else {
                    Some(subject.to_string())
                },
            });
        }

        // Fallback for empty repository with no commits yet (unborn branch)
        if branches.is_empty() {
            let sym_output =
                GitAdapter::execute(&canonical_repo, &["symbolic-ref", "--short", "HEAD"]);
            if let Ok(out) = sym_output
                && out.status.success()
            {
                let branch_name = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !branch_name.is_empty() {
                    branches.push(BranchInfo {
                        name: branch_name,
                        is_current: true,
                        is_remote: false,
                        upstream: None,
                        last_commit_hash: None,
                        last_commit_message: None,
                    });
                }
            }
        }

        Ok(branches)
    }

    /// Creates a new branch from a base reference (defaults to HEAD).
    pub fn create_branch(
        repo_dir: &Path,
        name: &str,
        base_ref: Option<&str>,
        checkout: bool,
    ) -> Result<BranchInfo, CommandError> {
        let canonical_repo = repo_dir
            .canonicalize()
            .map_err(|e| CommandError::io_error(format!("Geçersiz depo dizini: {}", e)))?;

        let trimmed_name = name.trim();
        if trimmed_name.is_empty() {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                "Branch adı boş olamaz.",
                true,
            ));
        }

        // Validate branch name against Git ref format rules
        let check_output = GitAdapter::execute(
            &canonical_repo,
            &["check-ref-format", "--branch", trimmed_name],
        )?;

        if !check_output.status.success() {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                format!(
                    "Geçersiz branch adı: '{}'. Boşluk, '..', '~', '^', ':', '?', '*', '[' veya '-' ile başlama gibi geçersiz karakterler kullanılamaz.",
                    trimmed_name
                ),
                true,
            ));
        }

        // Check if branch already exists
        let exists_check = GitAdapter::execute(
            &canonical_repo,
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("refs/heads/{}", trimmed_name),
            ],
        )?;

        if exists_check.status.success() {
            return Err(CommandError::new(
                "BRANCH_ALREADY_EXISTS",
                format!("'{}' adında bir branch zaten mevcut.", trimmed_name),
                true,
            ));
        }

        let base = base_ref.unwrap_or("HEAD").trim();
        if base.is_empty() || base.starts_with('-') {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                "Geçersiz base referansı.",
                true,
            ));
        }

        if checkout {
            // git checkout -b <name> <base>
            let output =
                GitAdapter::execute(&canonical_repo, &["checkout", "-b", trimmed_name, base])?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(CommandError::new(
                    "GIT_COMMAND_FAILED",
                    format!("Branch oluşturulup checkout yapılamadı: {}", stderr.trim()),
                    true,
                ));
            }
        } else {
            // git branch <name> <base>
            let output = GitAdapter::execute(&canonical_repo, &["branch", trimmed_name, base])?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(CommandError::new(
                    "GIT_COMMAND_FAILED",
                    format!("Branch oluşturulamadı: {}", stderr.trim()),
                    true,
                ));
            }
        }

        // Retrieve created branch info
        let branches = Self::list_branches(&canonical_repo)?;
        branches
            .into_iter()
            .find(|b| b.name == trimmed_name)
            .ok_or_else(|| {
                CommandError::new(
                    "BRANCH_NOT_FOUND",
                    format!("Oluşturulan branch okunamadı: {}", trimmed_name),
                    true,
                )
            })
    }

    /// Checks out a branch safely.
    ///
    /// If uncommitted local changes would be overwritten, Git rejects checkout and
    /// we return a `DIRTY_WORKTREE` error without losing or stashing user changes.
    pub fn checkout_branch(repo_dir: &Path, branch: &str) -> Result<GitStatus, CommandError> {
        let canonical_repo = repo_dir
            .canonicalize()
            .map_err(|e| CommandError::io_error(format!("Geçersiz depo dizini: {}", e)))?;

        let trimmed_branch = branch.trim();
        if trimmed_branch.is_empty() || trimmed_branch.starts_with('-') {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                "Hedef branch adı boş olamaz veya '-' ile başlayamaz.",
                true,
            ));
        }

        let local_ref = format!("refs/heads/{}", trimmed_branch);
        let local_exists = GitAdapter::execute(
            &canonical_repo,
            &["show-ref", "--verify", "--quiet", &local_ref],
        )?;
        if !local_exists.status.success() {
            let remote_ref = format!("refs/remotes/{}", trimmed_branch);
            let remote_exists = GitAdapter::execute(
                &canonical_repo,
                &["show-ref", "--verify", "--quiet", &remote_ref],
            )?;
            if remote_exists.status.success() {
                return Err(CommandError::new(
                    "VALIDATION_ERROR",
                    format!(
                        "'{}' bir uzak izleme dalıdır. Doğrudan checkout detached HEAD oluşturur; önce yerel bir dal oluşturun.",
                        trimmed_branch
                    ),
                    true,
                ));
            }
            return Err(CommandError::new(
                "BRANCH_NOT_FOUND",
                format!("Hedef branch bulunamadı: {}", trimmed_branch),
                true,
            ));
        }

        // Never pass -f / --force. Names starting with '-' are rejected above so
        // `checkout` cannot be confused with an option. Do NOT use `checkout -- <name>`:
        // that form restores pathspecs instead of switching branches.
        let output = GitAdapter::execute(&canonical_repo, &["checkout", trimmed_branch])?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stderr_str = stderr.trim();

            if stderr_str.contains("Your local changes to the following files would be overwritten")
                || stderr_str.contains("would be overwritten by checkout")
            {
                return Err(CommandError::new(
                    "DIRTY_WORKTREE",
                    format!(
                        "Çalışma alanındaki kaydedilmemiş değişiklikler '{}' branch'i ile çakışıyor: {}",
                        trimmed_branch, stderr_str
                    ),
                    true,
                ));
            }

            if stderr_str.contains("did not match any file(s) known to git")
                || stderr_str.contains("pathspec")
            {
                return Err(CommandError::new(
                    "BRANCH_NOT_FOUND",
                    format!("Hedef branch bulunamadı: {}", trimmed_branch),
                    true,
                ));
            }

            return Err(CommandError::new(
                "GIT_COMMAND_FAILED",
                format!("Branch checkout başarısız: {}", stderr_str),
                true,
            ));
        }

        // Return fresh Git status
        crate::git::GitStatusParser::get_status(&canonical_repo)
    }

    /// Deletes a local branch safely.
    ///
    /// - Active branch can NEVER be deleted.
    /// - Safe delete (`-d`) is used by default.
    /// - Force delete (`-D`) is only used when `force = true`.
    pub fn delete_branch(repo_dir: &Path, branch: &str, force: bool) -> Result<bool, CommandError> {
        let canonical_repo = repo_dir
            .canonicalize()
            .map_err(|e| CommandError::io_error(format!("Geçersiz depo dizini: {}", e)))?;

        let trimmed_branch = branch.trim();
        if trimmed_branch.is_empty() || trimmed_branch.starts_with('-') {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                "Silinecek branch adı boş olamaz veya '-' ile başlayamaz.",
                true,
            ));
        }

        // 1. Guard against deleting the active branch
        let status = crate::git::GitStatusParser::get_status(&canonical_repo)?;
        if let Some(ref current) = status.branch
            && (current == trimmed_branch || current.starts_with(&format!("{} (", trimmed_branch)))
        {
            return Err(CommandError::new(
                "CANNOT_DELETE_ACTIVE_BRANCH",
                format!(
                    "Aktif branch ('{}') silinemez. Lütfen önce başka bir branch'e geçin.",
                    trimmed_branch
                ),
                true,
            ));
        }

        // 2. Perform delete (-d or -D)
        let delete_flag = if force { "-D" } else { "-d" };
        let output = GitAdapter::execute(
            &canonical_repo,
            &["branch", delete_flag, "--", trimmed_branch],
        )?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stderr_str = stderr.trim();

            if stderr_str.contains("not found") {
                return Err(CommandError::new(
                    "BRANCH_NOT_FOUND",
                    format!("Branch bulunamadı: {}", trimmed_branch),
                    true,
                ));
            }

            if stderr_str.contains("is not fully merged") {
                return Err(CommandError::new(
                    "BRANCH_NOT_MERGED",
                    "Branch henüz tamamen birleştirilmemiş (unmerged). Değişiklikleri kaybetmeyi göze alıyorsanız 'Zorla Sil' seçeneğini kullanın.".to_string(),
                    true,
                ));
            }

            return Err(CommandError::new(
                "GIT_COMMAND_FAILED",
                format!("Branch silinemedi: {}", stderr_str),
                true,
            ));
        }

        Ok(true)
    }
}
