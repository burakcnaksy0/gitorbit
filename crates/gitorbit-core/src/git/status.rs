use crate::errors::CommandError;
use crate::git::adapter::GitAdapter;
use crate::models::{ChangedFile, ChangedFileStatus, GitStatus};
use std::path::Path;

pub struct GitStatusParser;

impl GitStatusParser {
    /// Reads and parses current Git repository status using porcelain -z.
    pub fn get_status(repo_dir: &Path) -> Result<GitStatus, CommandError> {
        let canonical_repo = repo_dir
            .canonicalize()
            .map_err(|e| CommandError::io_error(format!("Geçersiz depo dizini: {}", e)))?;

        // 1. Run git status --porcelain=v1 -z --untracked-files=all
        let status_output = GitAdapter::execute(
            &canonical_repo,
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        )?;

        if !status_output.status.success() {
            let stderr = String::from_utf8_lossy(&status_output.stderr);
            return Err(CommandError::new(
                "GIT_STATUS_FAILED",
                format!("Git status alınamadı: {}", stderr.trim()),
                true,
            ));
        }

        let (staged_files, unstaged_files, untracked_files, conflicted_files) =
            Self::parse_porcelain_z(&status_output.stdout);

        // 2. Read branch and detached HEAD
        let (branch, is_detached_head) = Self::get_branch_info(&canonical_repo)?;

        // 3. Read upstream and ahead/behind
        let (upstream, ahead, behind) = Self::get_upstream_info(&canonical_repo);

        // 4. Detect operation state (e.g. merge in progress, rebase in progress)
        let operation_state =
            crate::git::operation_state::GitOperationStateManager::detect_state(&canonical_repo);

        Ok(GitStatus {
            repository_path: canonical_repo.to_string_lossy().to_string(),
            branch,
            is_detached_head,
            upstream,
            ahead,
            behind,
            staged_files,
            unstaged_files,
            untracked_files,
            conflicted_files,
            operation_state,
        })
    }

    /// Parses raw NUL-delimited output from `git status --porcelain=v1 -z`
    pub fn parse_porcelain_z(
        raw_bytes: &[u8],
    ) -> (
        Vec<ChangedFile>,
        Vec<ChangedFile>,
        Vec<ChangedFile>,
        Vec<String>,
    ) {
        let mut staged = Vec::new();
        let mut unstaged = Vec::new();
        let mut untracked = Vec::new();
        let mut conflicted = Vec::new();

        let entries: Vec<&[u8]> = raw_bytes
            .split(|&b| b == 0)
            .filter(|chunk| !chunk.is_empty())
            .collect();

        let mut i = 0;
        while i < entries.len() {
            let chunk = entries[i];
            if chunk.len() < 3 {
                i += 1;
                continue;
            }

            let x = chunk[0] as char;
            let y = chunk[1] as char;
            // Byte 2 is space, rest is path
            let path_bytes = &chunk[3..];
            let path = String::from_utf8_lossy(path_bytes).to_string();

            // Check if renamed or copied (requires reading the next NUL-delimited chunk for old_path)
            let mut old_path = None;
            if (x == 'R' || x == 'C' || y == 'R' || y == 'C') && (i + 1 < entries.len()) {
                i += 1;
                old_path = Some(String::from_utf8_lossy(entries[i]).to_string());
            }

            // Untracked files
            if x == '?' && y == '?' {
                untracked.push(ChangedFile {
                    path,
                    old_path: None,
                    status: ChangedFileStatus::Untracked,
                    staged: false,
                });
                i += 1;
                continue;
            }

            // Conflicted files (unmerged)
            let is_conflict = matches!(
                (x, y),
                ('D', 'D')
                    | ('A', 'U')
                    | ('U', 'D')
                    | ('U', 'A')
                    | ('D', 'U')
                    | ('A', 'A')
                    | ('U', 'U')
            );

            if is_conflict {
                conflicted.push(path.clone());
                unstaged.push(ChangedFile {
                    path,
                    old_path,
                    status: ChangedFileStatus::Conflicted,
                    staged: false,
                });
                i += 1;
                continue;
            }

            // Staged part (X)
            if x != ' ' && x != '?' {
                let status = match x {
                    'A' => ChangedFileStatus::Added,
                    'M' => ChangedFileStatus::Modified,
                    'D' => ChangedFileStatus::Deleted,
                    'R' => ChangedFileStatus::Renamed,
                    _ => ChangedFileStatus::Modified,
                };

                staged.push(ChangedFile {
                    path: path.clone(),
                    old_path: old_path.clone(),
                    status,
                    staged: true,
                });
            }

            // Unstaged part (Y)
            if y != ' ' && y != '?' {
                let status = match y {
                    'M' => ChangedFileStatus::Modified,
                    'D' => ChangedFileStatus::Deleted,
                    'A' => ChangedFileStatus::Added,
                    'R' => ChangedFileStatus::Renamed,
                    _ => ChangedFileStatus::Modified,
                };

                unstaged.push(ChangedFile {
                    path,
                    old_path,
                    status,
                    staged: false,
                });
            }

            i += 1;
        }

        (staged, unstaged, untracked, conflicted)
    }

    fn get_branch_info(repo_dir: &Path) -> Result<(Option<String>, bool), CommandError> {
        let output = GitAdapter::execute(repo_dir, &["rev-parse", "--abbrev-ref", "HEAD"])?;

        if output.status.success() {
            let ref_name = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if ref_name == "HEAD" {
                // Detached HEAD state — read the short SHA
                let sha_output = GitAdapter::execute(repo_dir, &["rev-parse", "--short", "HEAD"])?;
                let short_sha = String::from_utf8_lossy(&sha_output.stdout)
                    .trim()
                    .to_string();
                return Ok((Some(format!("HEAD ({})", short_sha)), true));
            } else if !ref_name.is_empty() {
                return Ok((Some(ref_name), false));
            }
        }

        // Fallback: empty repo (no commits yet) — read branch from symbolic-ref.
        // `git symbolic-ref --short HEAD` works even before the first commit.
        let sym_output = GitAdapter::execute(repo_dir, &["symbolic-ref", "--short", "HEAD"]);

        match sym_output {
            Ok(out) if out.status.success() => {
                let branch = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if branch.is_empty() {
                    Ok((None, false))
                } else {
                    Ok((Some(branch), false))
                }
            }
            _ => Ok((None, false)),
        }
    }

    fn get_upstream_info(repo_dir: &Path) -> (Option<String>, u32, u32) {
        let upstream_output = GitAdapter::execute(repo_dir, &["rev-parse", "--abbrev-ref", "@{u}"]);

        let upstream = match upstream_output {
            Ok(out) if out.status.success() => {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if s.is_empty() { None } else { Some(s) }
            }
            _ => None,
        };

        let mut ahead = 0;
        let mut behind = 0;

        if upstream.is_some()
            && let Ok(count_output) = GitAdapter::execute(
                repo_dir,
                &["rev-list", "--left-right", "--count", "HEAD...@{u}"],
            )
            && count_output.status.success()
        {
            let text = String::from_utf8_lossy(&count_output.stdout);
            let parts: Vec<&str> = text.split_whitespace().collect();
            if parts.len() >= 2 {
                ahead = parts[0].parse::<u32>().unwrap_or(0);
                behind = parts[1].parse::<u32>().unwrap_or(0);
            }
        }

        (upstream, ahead, behind)
    }
}
