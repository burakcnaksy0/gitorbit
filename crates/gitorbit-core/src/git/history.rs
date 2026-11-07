use crate::errors::CommandError;
use crate::git::adapter::GitAdapter;
use crate::models::{CommitInfo, HistoryOutput};
use std::path::Path;
pub struct GitHistoryManager;

impl GitHistoryManager {
    /// Reads commit history with pagination, supporting empty repositories gracefully.
    pub fn get_history(
        repo_dir: &Path,
        ref_name: Option<&str>,
        limit: usize,
        offset: usize,
    ) -> Result<HistoryOutput, CommandError> {
        let canonical_repo = repo_dir
            .canonicalize()
            .map_err(|e| CommandError::io_error(format!("Geçersiz depo dizini: {}", e)))?;

        let target_ref = ref_name.unwrap_or("HEAD").trim();
        if target_ref.is_empty() || target_ref.starts_with('-') {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                "Geçersiz history referansı.",
                true,
            ));
        }
        let page_limit = if limit == 0 { 50 } else { limit.min(200) };

        // Verify if the target reference exists (empty repository check)
        let verify = GitAdapter::execute(
            &canonical_repo,
            &["rev-parse", "--verify", "--quiet", target_ref],
        )?;

        if !verify.status.success() {
            // No commits yet on this reference
            return Ok(HistoryOutput {
                commits: Vec::new(),
                graph: Vec::new(),
                has_more: false,
                next_offset: 0,
            });
        }

        // Fetch limit + 1 to check if there is a next page
        let fetch_count = (page_limit + 1).to_string();
        let skip_arg = format!("--skip={}", offset);
        let n_arg = format!("-n{}", fetch_count);

        let output = GitAdapter::execute(
            &canonical_repo,
            &[
                "log",
                target_ref,
                &skip_arg,
                &n_arg,
                "--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%P%x00%D%x00%B%x1e",
            ],
        )?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(CommandError::new(
                "GIT_COMMAND_FAILED",
                format!("Commit geçmişi okunamadı: {}", stderr.trim()),
                true,
            ));
        }

        let raw_output = String::from_utf8_lossy(&output.stdout);
        let records: Vec<&str> = raw_output.split('\x1e').collect();
        let mut commits = Vec::new();

        for record in records {
            let trimmed = record.trim_matches('\n');
            if trimmed.is_empty() {
                continue;
            }

            let parts: Vec<&str> = trimmed.split('\0').collect();
            if parts.len() < 8 {
                continue;
            }

            let sha = parts[0].trim().to_string();
            let short_sha = parts[1].trim().to_string();
            let author_name = parts[2].trim().to_string();
            let author_email = parts[3].trim().to_string();
            let authored_at = parts[4].trim().to_string();
            let parents_str = parts[5].trim();
            let refs = Self::parse_ref_decorations(parts[6]);
            let message = parts[7].trim().to_string();

            let parents = if parents_str.is_empty() {
                Vec::new()
            } else {
                parents_str
                    .split_whitespace()
                    .map(|s| s.to_string())
                    .collect()
            };

            commits.push(CommitInfo {
                sha,
                short_sha,
                message,
                author_name,
                author_email,
                authored_at,
                parents,
                refs,
            });
        }

        let has_more = commits.len() > page_limit;
        if has_more {
            commits.truncate(page_limit);
        }

        // Grafik yalnizca yuklenen sayfa icin cizilir (bilincli sinir).
        let graph = crate::git::graph::compute_lanes(
            &commits
                .iter()
                .map(|c| (c.sha.clone(), c.parents.clone()))
                .collect::<Vec<_>>(),
        );

        let next_offset = offset + commits.len();

        Ok(HistoryOutput {
            commits,
            graph,
            has_more,
            next_offset,
        })
    }

    /// `%D` dekorasyonlarini temizler: "HEAD -> main, origin/main, tag: v1" →
    /// ["main", "origin/main", "tag:v1"]. (HEAD -> hedef dal adini birakir.)
    fn parse_ref_decorations(raw: &str) -> Vec<String> {
        let raw = raw.trim();
        let raw = raw.strip_prefix('(').unwrap_or(raw);
        let raw = raw.strip_suffix(')').unwrap_or(raw);
        if raw.is_empty() {
            return Vec::new();
        }
        raw.split(", ")
            .map(|entry| {
                let entry = entry.trim();
                if let Some(rest) = entry.strip_prefix("HEAD -> ") {
                    rest.to_string()
                } else if entry == "HEAD" {
                    "HEAD".to_string()
                } else if let Some(tag) = entry.strip_prefix("tag: ") {
                    format!("tag:{}", tag)
                } else {
                    entry.to_string()
                }
            })
            .filter(|s| !s.is_empty() && s != "grafted" && s != "tag")
            .collect()
    }

    /// Reads full details for a single commit (metadata + changed files + stats).
    pub fn get_commit_details(
        repo_dir: &Path,
        sha: &str,
    ) -> Result<crate::models::CommitDetails, CommandError> {
        Self::validate_revision(sha)?;
        let canonical_repo = repo_dir
            .canonicalize()
            .map_err(|e| CommandError::io_error(format!("Geçersiz depo dizini: {}", e)))?;

        let output = GitAdapter::execute(
            &canonical_repo,
            &[
                "show",
                "-s",
                "--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%P%x00%B%x1e",
                sha,
            ],
        )?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(CommandError::new(
                "COMMIT_NOT_FOUND",
                format!("Commit bulunamadı: {}", stderr.trim()),
                true,
            ));
        }

        let raw = String::from_utf8_lossy(&output.stdout);
        let record = raw.split('\x1e').next().unwrap_or("").trim_matches('\n');
        let parts: Vec<&str> = record.split('\0').collect();
        if parts.len() < 7 {
            return Err(CommandError::new(
                "GIT_COMMAND_FAILED",
                "Commit bilgisi ayrıştırılamadı.",
                true,
            ));
        }

        let parents = if parts[5].trim().is_empty() {
            Vec::new()
        } else {
            parts[5].split_whitespace().map(|s| s.to_string()).collect()
        };

        let commit = CommitInfo {
            sha: parts[0].trim().to_string(),
            short_sha: parts[1].trim().to_string(),
            author_name: parts[2].trim().to_string(),
            author_email: parts[3].trim().to_string(),
            authored_at: parts[4].trim().to_string(),
            parents,
            message: parts[6].trim().to_string(),
            refs: Vec::new(),
        };

        let files = Self::commit_changed_files(&canonical_repo, sha)?;
        let (additions, deletions) = Self::commit_stats(&canonical_repo, sha)?;

        Ok(crate::models::CommitDetails {
            commit,
            files,
            additions,
            deletions,
        })
    }

    /// Returns the unified diff of a commit as structured lines.
    pub fn get_commit_diff(
        repo_dir: &Path,
        sha: &str,
    ) -> Result<crate::models::DiffOutput, CommandError> {
        Self::validate_revision(sha)?;
        let canonical_repo = repo_dir
            .canonicalize()
            .map_err(|e| CommandError::io_error(format!("Geçersiz depo dizini: {}", e)))?;

        let output = GitAdapter::execute(
            &canonical_repo,
            &[
                "show",
                "--format=",
                "--patch",
                "--no-color",
                "--no-ext-diff",
                sha,
            ],
        )?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(CommandError::new(
                "GIT_DIFF_FAILED",
                format!("Commit diff'i alınamadı: {}", stderr.trim()),
                true,
            ));
        }

        let raw_size = output.stdout.len();
        let preview = String::from_utf8_lossy(&output.stdout[..raw_size.min(256)]);
        if preview.contains("Binary files") {
            return Ok(crate::models::DiffOutput {
                path: sha.to_string(),
                truncated: false,
                binary: true,
                lines: Vec::new(),
                raw_size,
            });
        }
        if raw_size > crate::git::diff::MAX_DIFF_BYTES {
            return Ok(crate::models::DiffOutput {
                path: sha.to_string(),
                truncated: true,
                binary: false,
                lines: Vec::new(),
                raw_size,
            });
        }

        let text = String::from_utf8_lossy(&output.stdout);
        Ok(crate::models::DiffOutput {
            path: sha.to_string(),
            truncated: false,
            binary: false,
            lines: crate::git::GitDiffParser::parse_diff_text(&text),
            raw_size,
        })
    }

    /// Compares two branches: ahead/behind counts plus commits unique to head.
    pub fn compare_branches(
        repo_dir: &Path,
        base: &str,
        head: &str,
    ) -> Result<crate::models::BranchComparison, CommandError> {
        Self::validate_revision(base)?;
        Self::validate_revision(head)?;
        let canonical_repo = repo_dir
            .canonicalize()
            .map_err(|e| CommandError::io_error(format!("Geçersiz depo dizini: {}", e)))?;

        let range = format!("{}...{}", base, head);
        let count_output = GitAdapter::execute(
            &canonical_repo,
            &["rev-list", "--left-right", "--count", &range],
        )?;
        if !count_output.status.success() {
            let stderr = String::from_utf8_lossy(&count_output.stderr);
            return Err(CommandError::new(
                "BRANCH_NOT_FOUND",
                format!("Branch karşılaştırılamadı: {}", stderr.trim()),
                true,
            ));
        }
        let counts = String::from_utf8_lossy(&count_output.stdout);
        let mut nums = counts
            .split_whitespace()
            .filter_map(|s| s.parse::<u32>().ok());
        let behind = nums.next().unwrap_or(0);
        let ahead = nums.next().unwrap_or(0);

        let log_output = GitAdapter::execute(
            &canonical_repo,
            &[
                "log",
                &format!("{}..{}", base, head),
                "-n100",
                "--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%P%x00%B%x1e",
            ],
        )?;

        let mut commits = Vec::new();
        if log_output.status.success() {
            let raw = String::from_utf8_lossy(&log_output.stdout);
            for record in raw.split('\x1e') {
                let trimmed = record.trim_matches('\n');
                if trimmed.is_empty() {
                    continue;
                }
                let parts: Vec<&str> = trimmed.split('\0').collect();
                if parts.len() < 7 {
                    continue;
                }
                commits.push(CommitInfo {
                    sha: parts[0].trim().to_string(),
                    short_sha: parts[1].trim().to_string(),
                    author_name: parts[2].trim().to_string(),
                    author_email: parts[3].trim().to_string(),
                    authored_at: parts[4].trim().to_string(),
                    parents: if parts[5].trim().is_empty() {
                        Vec::new()
                    } else {
                        parts[5].split_whitespace().map(|s| s.to_string()).collect()
                    },
                    message: parts[6].trim().to_string(),
                    refs: Vec::new(),
                });
            }
        }

        Ok(crate::models::BranchComparison {
            base: base.to_string(),
            head: head.to_string(),
            ahead,
            behind,
            commits,
        })
    }

    fn validate_revision(revision: &str) -> Result<(), CommandError> {
        let trimmed = revision.trim();
        if trimmed.is_empty() {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                "Commit veya branch referansı boş olamaz.",
                true,
            ));
        }
        if trimmed.starts_with('-') || trimmed.chars().any(|c| c.is_control()) {
            return Err(CommandError::new(
                "VALIDATION_ERROR",
                "Geçersiz commit veya branch referansı.",
                true,
            ));
        }
        Ok(())
    }

    fn commit_changed_files(
        repo: &Path,
        sha: &str,
    ) -> Result<Vec<crate::models::ChangedFile>, CommandError> {
        use crate::models::{ChangedFile, ChangedFileStatus};

        let output = GitAdapter::execute(
            repo,
            &[
                "diff-tree",
                "--root",
                "--no-commit-id",
                "--name-status",
                "-r",
                "-M",
                sha,
            ],
        )?;
        if !output.status.success() {
            return Ok(Vec::new());
        }

        let raw = String::from_utf8_lossy(&output.stdout);
        let mut files = Vec::new();
        for line in raw.lines() {
            let mut parts = line.split('\t');
            let Some(code) = parts.next() else { continue };
            let status_char = code.chars().next().unwrap_or('M');
            let (status, path, old_path) = match status_char {
                'A' => (ChangedFileStatus::Added, parts.next(), None),
                'D' => (ChangedFileStatus::Deleted, parts.next(), None),
                'R' | 'C' => {
                    let old = parts.next();
                    let new = parts.next();
                    (ChangedFileStatus::Renamed, new, old)
                }
                _ => (ChangedFileStatus::Modified, parts.next(), None),
            };
            let Some(path) = path else { continue };
            files.push(ChangedFile {
                path: path.to_string(),
                old_path: old_path.map(|s| s.to_string()),
                status,
                staged: false,
            });
        }
        Ok(files)
    }

    fn commit_stats(repo: &Path, sha: &str) -> Result<(u32, u32), CommandError> {
        let output = GitAdapter::execute(repo, &["show", "--numstat", "--format=", sha])?;
        if !output.status.success() {
            return Ok((0, 0));
        }
        let raw = String::from_utf8_lossy(&output.stdout);
        let mut additions = 0u32;
        let mut deletions = 0u32;
        for line in raw.lines() {
            let mut parts = line.split('\t');
            let add = parts.next().unwrap_or("0");
            let del = parts.next().unwrap_or("0");
            additions += add.parse::<u32>().unwrap_or(0);
            deletions += del.parse::<u32>().unwrap_or(0);
        }
        Ok((additions, deletions))
    }
}
