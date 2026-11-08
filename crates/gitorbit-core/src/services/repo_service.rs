use crate::db::Database;
use crate::db::repositories::RepositoryDao;
use crate::errors::CommandError;
use crate::git::{
    GitAdapter, GitBranchManager, GitCloneManager, GitCommitManager, GitDiffParser,
    GitHistoryManager, GitMergeManager, GitOperationStateManager, GitRemoteManager,
    GitStatusParser,
};
use crate::models::{
    BranchComparison, BranchInfo, CloneResult, CommitDetails, CommitResult, DiffOutput,
    GitIdentity, GitStatus, HistoryOutput, RemoteInfo, RepositoryDetails, RepositoryOperationState,
    RepositoryRecord,
};
use chrono::Utc;
use std::path::{Component, Path};

pub struct RepositoryService;

impl RepositoryService {
    // -----------------------------------------------------------------
    // Core repository CRUD (Faz 2)
    // -----------------------------------------------------------------

    /// Validates directory, canonicalizes Git root, prevents duplicates, and saves to database.
    pub fn add_repository(db: &Database, raw_path: &str) -> Result<RepositoryRecord, CommandError> {
        let trimmed = raw_path.trim();
        if trimmed.is_empty() {
            return Err(CommandError::invalid_path("Repository yolu bos olamaz"));
        }

        let input_path = Path::new(trimmed);

        // 1. Resolve canonical Git root
        let canonical_root = GitAdapter::get_repository_root(input_path)?;
        let canonical_str = canonical_root.to_string_lossy().to_string();

        // 2. Check for duplicate in DB
        let existing =
            db.with_conn(|conn| RepositoryDao::get_by_canonical_path(conn, &canonical_str))?;

        if let Some(existing_repo) = existing {
            return Err(CommandError::repo_already_exists(format!(
                "\"{}\" yolu zaten kayitli (ID: {})",
                canonical_str, existing_repo.id
            )));
        }

        // 3. Extract display name from folder name
        let display_name = canonical_root
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "repository".to_string());

        // 4. Read initial branch (best-effort)
        let initial_status = GitStatusParser::get_status(&canonical_root).ok();
        let current_branch = initial_status.and_then(|s| s.branch);

        let now = Utc::now().to_rfc3339();
        let id = format!("repo_{}", Utc::now().timestamp_nanos_opt().unwrap_or(0));

        let record = RepositoryRecord {
            id,
            canonical_path: canonical_str,
            display_name,
            current_branch,
            last_opened_at: Some(now.clone()),
            created_at: now.clone(),
            updated_at: now,
            missing: false,
            pinned: false,
        };

        // 5. Save to database
        db.with_conn(|conn| RepositoryDao::insert(conn, &record))?;

        Ok(record)
    }

    /// Initializes a NEW Git repository in an existing plain directory
    /// (`git init`, honoring the user's `init.defaultBranch`), then registers
    /// it like `add_repository`. Used when the user adds a folder that is not
    /// yet a Git repository.
    pub fn init_repository(
        db: &Database,
        raw_path: &str,
    ) -> Result<RepositoryRecord, CommandError> {
        let trimmed = raw_path.trim();
        if trimmed.is_empty() {
            return Err(CommandError::invalid_path("Repository yolu bos olamaz"));
        }

        let input_path = Path::new(trimmed);
        if !input_path.exists() {
            return Err(CommandError::invalid_path(format!(
                "Belirtilen yol mevcut değil: {}",
                input_path.display()
            )));
        }
        if !input_path.is_dir() {
            return Err(CommandError::invalid_path(format!(
                "Belirtilen yol bir dizin değil: {}",
                input_path.display()
            )));
        }

        // Refuse if the folder (or a parent) is already a Git repository —
        // `git init` there would be a no-op or silently nest repositories.
        if GitAdapter::get_repository_root(input_path).is_ok() {
            return Err(CommandError::new(
                "ALREADY_A_GIT_REPOSITORY",
                "Bu klasör (veya bir üst klasörü) zaten bir Git deposu.",
                false,
            ));
        }

        let canonical_input = input_path.canonicalize().map_err(|e| {
            CommandError::invalid_path(format!("Yol çözümlenemedi (canonicalize): {}", e))
        })?;

        GitAdapter::execute(&canonical_input, &["init"])
            .map_err(|e| CommandError::io_error(format!("git init basarisiz: {}", e.message)))?;

        Self::add_repository(db, &canonical_input.to_string_lossy())
    }

    /// Lists all registered repositories from the database.
    ///
    /// `missing` is computed by checking the filesystem so the UI can offer
    /// re-link/remove actions instead of failing with a generic error.
    pub fn list_repositories(db: &Database) -> Result<Vec<RepositoryRecord>, CommandError> {
        let mut repos = db.with_conn(RepositoryDao::list)?;
        for repo in &mut repos {
            repo.missing = !Path::new(&repo.canonical_path).is_dir();
        }
        Ok(repos)
    }

    /// Retrieves repository record by ID.
    pub fn get_repository(db: &Database, id: &str) -> Result<RepositoryRecord, CommandError> {
        let repo = db.with_conn(|conn| RepositoryDao::get_by_id(conn, id))?;
        repo.ok_or_else(|| CommandError::repo_not_found(format!("Repository bulunamadi: {}", id)))
    }

    /// Removes repository registration from database without touching disk files.
    pub fn remove_repository(db: &Database, id: &str) -> Result<bool, CommandError> {
        db.with_conn(|conn| RepositoryDao::remove(conn, id))
    }

    /// v0.2 madde 10 — sabitleme bayrağını günceller ve güncel kaydı döner.
    pub fn set_pinned(db: &Database, id: &str, pinned: bool) -> Result<RepositoryRecord, CommandError> {
        let repo = Self::get_repository(db, id)?;
        db.with_conn(|conn| RepositoryDao::set_pinned(conn, &repo.id, pinned))?;
        Self::get_repository(db, id)
    }

    /// Reads real Git status using canonical path stored in the database.
    pub fn get_repository_status(db: &Database, id: &str) -> Result<GitStatus, CommandError> {
        let repo = Self::get_repository(db, id)?;
        let path = Path::new(&repo.canonical_path);

        if !path.exists() {
            return Err(CommandError::repo_not_found(format!(
                "Repository diskte bulunamadi (silinmis veya tasinmis olabilir): {}",
                repo.canonical_path
            )));
        }

        let status = GitStatusParser::get_status(path)?;

        // GO-09c: last_opened_at her status okumasında YAZILIYORDU — auto-fetch
        // + senkron turlarıyla birleşince boş WAL/IO gürültüsü ve listelerin
        // kullanıcı altında sürekli yeniden sıralanması oluşuyordu. 10 dakikadan
        // tazaysa yazma atlanır (sıra hissi korunur, yazma amortismanı düşer).
        const REFRESH_MINUTES: i64 = 10;
        let stale = repo
            .last_opened_at
            .as_deref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|t| (Utc::now() - t.with_timezone(&Utc)).num_minutes() >= REFRESH_MINUTES)
            .unwrap_or(true);
        if stale {
            let now = Utc::now().to_rfc3339();
            let _ = db.with_conn(|conn| RepositoryDao::update_last_opened(conn, id, &now));
        }

        Ok(status)
    }

    // -----------------------------------------------------------------
    // Stage / Unstage (Faz 3)
    // -----------------------------------------------------------------

    /// Stages the given relative file paths inside a repository.
    ///
    /// Each path is validated to ensure it does not escape the repository root
    /// (path traversal protection). Uses `git add -- <paths>`.
    pub fn stage_files(
        db: &Database,
        repo_id: &str,
        paths: &[String],
    ) -> Result<GitStatus, CommandError> {
        let repo = Self::get_repository(db, repo_id)?;
        let root = Path::new(&repo.canonical_path);
        Self::validate_paths(root, paths)?;

        // git add -- <paths>
        let mut args = vec!["add", "--"];
        let path_strs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        args.extend_from_slice(&path_strs);

        let output = GitAdapter::execute(root, &args)?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(CommandError::new(
                "GIT_ADD_FAILED",
                format!("git add basarisiz: {}", stderr.trim()),
                true,
            ));
        }

        // Re-read and return fresh status
        GitStatusParser::get_status(root)
    }

    /// Unstages the given relative file paths inside a repository.
    ///
    /// Uses `git restore --staged -- <paths>`. For repos with no commits yet,
    /// falls back to `git rm --cached -- <paths>` (new file added to index).
    pub fn unstage_files(
        db: &Database,
        repo_id: &str,
        paths: &[String],
    ) -> Result<GitStatus, CommandError> {
        let repo = Self::get_repository(db, repo_id)?;
        let root = Path::new(&repo.canonical_path);
        Self::validate_paths(root, paths)?;

        let path_strs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();

        // Try git restore --staged first (Git >= 2.23)
        let mut args = vec!["restore", "--staged", "--"];
        args.extend_from_slice(&path_strs);

        let output = GitAdapter::execute(root, &args)?;
        if !output.status.success() {
            // Fallback: git rm --cached (for files newly added in empty repos)
            let mut fb_args = vec!["rm", "--cached", "--"];
            fb_args.extend_from_slice(&path_strs);
            let fb = GitAdapter::execute(root, &fb_args)?;
            if !fb.status.success() {
                let stderr = String::from_utf8_lossy(&fb.stderr);
                return Err(CommandError::new(
                    "GIT_UNSTAGE_FAILED",
                    format!("git restore/rm --cached basarisiz: {}", stderr.trim()),
                    true,
                ));
            }
        }

        GitStatusParser::get_status(root)
    }

    // -----------------------------------------------------------------
    // Diff (Faz 3)
    // -----------------------------------------------------------------

    /// Returns the diff for a single file in the repository.
    ///
    /// - `staged = true`  -> `git diff --cached -- <path>`
    /// - `staged = false` -> `git diff -- <path>`
    pub fn get_file_diff(
        db: &Database,
        repo_id: &str,
        file_path: &str,
        staged: bool,
    ) -> Result<DiffOutput, CommandError> {
        let repo = Self::get_repository(db, repo_id)?;
        let root = Path::new(&repo.canonical_path);
        Self::validate_paths(root, &[file_path.to_string()])?;

        GitDiffParser::get_file_diff(root, file_path, staged)
    }

    // -----------------------------------------------------------------
    // Discard (Faz 3) — high-risk, two-step safety
    // -----------------------------------------------------------------

    /// Discards unstaged changes for a single file (or removes an untracked file).
    ///
    /// Safety contract:
    /// 1. Re-reads current Git status.
    /// 2. Computes a status hash from the file list and compares with `expected_status_hash`.
    ///    If different, the file list changed between when the user previewed and confirmed —
    ///    the operation is aborted and the caller must restart the flow.
    /// 3. Only operates on files within the repository root (path traversal guard).
    /// 4. Uses `git restore -- <path>` (NOT `git clean -fd`).
    ///    For untracked files, removes via `std::fs::remove_file` (not rm -rf).
    ///
    /// Returns the fresh `GitStatus` after the operation.
    pub fn discard_changes(
        db: &Database,
        repo_id: &str,
        file_path: &str,
        expected_status_hash: &str,
    ) -> Result<GitStatus, CommandError> {
        let repo = Self::get_repository(db, repo_id)?;
        let root = Path::new(&repo.canonical_path);
        Self::validate_paths(root, &[file_path.to_string()])?;

        // Step 1: Re-read current status
        let current_status = GitStatusParser::get_status(root)?;

        // Step 2: Compute status hash and compare
        let computed_hash = Self::compute_status_hash(&current_status);
        if computed_hash != expected_status_hash {
            return Err(CommandError::new(
                "STATUS_CHANGED",
                "Dosya durumu onay oncesinde degisti. Islem iptal edildi; lutfen tekrar onayin.",
                true,
            ));
        }

        // Step 3: Determine what kind of file this is
        let is_untracked = current_status
            .untracked_files
            .iter()
            .any(|f| f.path == file_path);

        if is_untracked {
            // Remove untracked file from disk (with full path safety check)
            let abs_target = root.join(file_path);
            // For existing files we can canonicalize for the symlink/traversal check
            let canonical_target = abs_target.canonicalize().map_err(|e| {
                CommandError::invalid_path(format!("Hedef dosya bulunamadi veya erisilemez: {}", e))
            })?;

            // Final safety: ensure target is inside the repository root
            let canonical_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
            if !canonical_target.starts_with(&canonical_root) {
                return Err(CommandError::invalid_path(
                    "Hedef dosya repository koku disinda -- islem reddedildi.",
                ));
            }

            std::fs::remove_file(&canonical_target)
                .map_err(|e| CommandError::io_error(format!("Dosya silinemedi: {}", e)))?;
        } else {
            // git restore -- <path>  (discards unstaged modifications)
            let output = GitAdapter::execute(root, &["restore", "--", file_path])?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(CommandError::new(
                    "GIT_RESTORE_FAILED",
                    format!("git restore basarisiz: {}", stderr.trim()),
                    true,
                ));
            }
        }

        // Step 4: Return refreshed status
        GitStatusParser::get_status(root)
    }

    /// Computes a simple, deterministic status hash from the sorted file list.
    ///
    /// This is NOT a cryptographic hash — it is a consistency check token to prevent
    /// the discard operation from running against a stale file list.
    pub fn compute_status_hash(status: &GitStatus) -> String {
        let mut entries: Vec<String> = status
            .staged_files
            .iter()
            .map(|f| format!("S:{}", f.path))
            .chain(
                status
                    .unstaged_files
                    .iter()
                    .map(|f| format!("U:{}", f.path)),
            )
            .chain(
                status
                    .untracked_files
                    .iter()
                    .map(|f| format!("T:{}", f.path)),
            )
            .collect();
        entries.sort();

        // Simple DJB2-inspired fold — intentionally not a crypto primitive
        let mut hash: u64 = 5381;
        for entry in &entries {
            for &b in entry.as_bytes() {
                hash = hash.wrapping_mul(33).wrapping_add(b as u64);
            }
        }
        format!("{:016x}", hash)
    }

    // -----------------------------------------------------------------
    // Branch management (Faz 4)
    // -----------------------------------------------------------------

    /// Lists all local and remote branches in the repository.
    pub fn get_branches(db: &Database, repo_id: &str) -> Result<Vec<BranchInfo>, CommandError> {
        let repo = Self::get_repository(db, repo_id)?;
        let path = Path::new(&repo.canonical_path);
        GitBranchManager::list_branches(path)
    }

    /// Creates a branch.
    pub fn create_branch(
        db: &Database,
        repo_id: &str,
        name: &str,
        base_ref: Option<&str>,
        checkout: bool,
    ) -> Result<BranchInfo, CommandError> {
        let repo = Self::get_repository(db, repo_id)?;
        let path = Path::new(&repo.canonical_path);
        let branch = GitBranchManager::create_branch(path, name, base_ref, checkout)?;
        if checkout {
            let _ = db
                .with_conn(|conn| RepositoryDao::update_current_branch(conn, repo_id, Some(name)));
        }
        Ok(branch)
    }

    /// Checks out a branch safely.
    pub fn checkout_branch(
        db: &Database,
        repo_id: &str,
        branch: &str,
    ) -> Result<GitStatus, CommandError> {
        let repo = Self::get_repository(db, repo_id)?;
        let path = Path::new(&repo.canonical_path);
        let status = GitBranchManager::checkout_branch(path, branch)?;
        let _ = db.with_conn(|conn| {
            RepositoryDao::update_current_branch(conn, repo_id, status.branch.as_deref())
        });
        Ok(status)
    }

    /// Deletes a branch safely (cannot delete active branch).
    pub fn delete_branch(
        db: &Database,
        repo_id: &str,
        branch: &str,
        force: bool,
    ) -> Result<bool, CommandError> {
        let repo = Self::get_repository(db, repo_id)?;
        let path = Path::new(&repo.canonical_path);
        GitBranchManager::delete_branch(path, branch, force)
    }

    // -----------------------------------------------------------------
    // Commit & Identity (Faz 4)
    // -----------------------------------------------------------------

    /// Reads effective Git user identity (user.name and user.email).
    pub fn get_git_identity(db: &Database, repo_id: &str) -> Result<GitIdentity, CommandError> {
        let repo = Self::get_repository(db, repo_id)?;
        let path = Path::new(&repo.canonical_path);
        GitCommitManager::get_identity(path)
    }

    /// Sets repository-local Git identity (user.name and user.email).
    pub fn set_git_identity(
        db: &Database,
        repo_id: &str,
        name: &str,
        email: &str,
    ) -> Result<GitIdentity, CommandError> {
        let repo = Self::get_repository(db, repo_id)?;
        let path = Path::new(&repo.canonical_path);
        GitCommitManager::set_identity(path, name, email)
    }

    /// Creates a commit with the given message.
    pub fn commit(
        db: &Database,
        repo_id: &str,
        message: &str,
        amend: bool,
    ) -> Result<CommitResult, CommandError> {
        let repo = Self::get_repository(db, repo_id)?;
        let path = Path::new(&repo.canonical_path);
        let result = GitCommitManager::commit(path, message, amend)?;
        let _ = db.with_conn(|conn| {
            RepositoryDao::update_current_branch(conn, repo_id, result.status.branch.as_deref())
        });
        Ok(result)
    }

    // -----------------------------------------------------------------
    // History (Faz 4)
    // -----------------------------------------------------------------

    /// Reads commit history with pagination.
    pub fn get_history(
        db: &Database,
        repo_id: &str,
        ref_name: Option<&str>,
        limit: usize,
        offset: usize,
    ) -> Result<HistoryOutput, CommandError> {
        let repo = Self::get_repository(db, repo_id)?;
        let path = Path::new(&repo.canonical_path);
        GitHistoryManager::get_history(path, ref_name, limit, offset)
    }

    // -----------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------

    /// Validates that all paths are relative, do not contain `..`, and do not
    /// escape the repository root when joined.
    ///
    /// This does NOT require the files to exist (they may be untracked/new).
    fn validate_paths(repo_root: &Path, paths: &[String]) -> Result<(), CommandError> {
        for raw in paths {
            if raw.trim().is_empty() {
                return Err(CommandError::invalid_path("Bos dosya yolu gecersiz."));
            }

            let p = Path::new(raw);

            // Reject absolute paths
            if p.is_absolute() {
                return Err(CommandError::invalid_path(format!(
                    "Mutlak yol kabul edilmez: {}",
                    raw
                )));
            }

            // Reject any `..` component (path traversal)
            for component in p.components() {
                if component == Component::ParentDir {
                    return Err(CommandError::invalid_path(format!(
                        "Path traversal tespit edildi: {}",
                        raw
                    )));
                }
            }

            // If the file already exists, canonicalize to catch symlink escapes
            let joined = repo_root.join(p);
            if joined.exists()
                && let Ok(canonical_joined) = joined.canonicalize()
            {
                let canonical_root = repo_root
                    .canonicalize()
                    .unwrap_or_else(|_| repo_root.to_path_buf());
                if !canonical_joined.starts_with(&canonical_root) {
                    return Err(CommandError::invalid_path(format!(
                        "Dosya yolu repository koku disinda: {}",
                        raw
                    )));
                }
            }
        }
        Ok(())
    }

    // -----------------------------------------------------------------
    // Remote & Operation State (Faz 5)
    // -----------------------------------------------------------------

    /// Fetches changes from a remote without altering working tree files.
    /// GO-04: `access_token` bağlı hesaptan çözülür ve yalnızca HTTPS
    /// remote'larda geçici credential helper olarak kullanılır.
    pub fn fetch(
        db: &Database,
        repo_id: &str,
        remote: Option<&str>,
        access_token: Option<&str>,
    ) -> Result<GitStatus, CommandError> {
        let repo = Self::get_repository(db, repo_id)?;
        let path = Path::new(&repo.canonical_path);
        let status = GitRemoteManager::fetch(path, remote, access_token)?;
        if let Some(ref branch) = status.branch {
            let _ = db.with_conn(|conn| {
                RepositoryDao::update_current_branch(conn, repo_id, Some(branch.as_str()))
            });
        }
        Ok(status)
    }

    /// Pulls changes from upstream or specified remote/branch into the current branch.
    /// GO-04: `access_token` yalnızca HTTPS remote'larda geçici helper'dır.
    pub fn pull(
        db: &Database,
        repo_id: &str,
        remote: Option<&str>,
        branch: Option<&str>,
        strategy: Option<&str>,
        access_token: Option<&str>,
    ) -> Result<GitStatus, CommandError> {
        let repo = Self::get_repository(db, repo_id)?;
        let path = Path::new(&repo.canonical_path);
        let status = GitRemoteManager::pull(path, remote, branch, strategy, access_token)?;
        if let Some(ref b) = status.branch {
            let _ = db.with_conn(|conn| {
                RepositoryDao::update_current_branch(conn, repo_id, Some(b.as_str()))
            });
        }
        Ok(status)
    }

    /// Pushes changes of the current branch to the remote repository.
    pub fn push(
        db: &Database,
        repo_id: &str,
        remote: Option<&str>,
        branch: Option<&str>,
        force: bool,
        set_upstream: bool,
        access_token: Option<&str>,
    ) -> Result<GitStatus, CommandError> {
        let repo = Self::get_repository(db, repo_id)?;
        let path = Path::new(&repo.canonical_path);
        let status = GitRemoteManager::push(path, remote, branch, force, set_upstream, access_token)?;
        if let Some(ref b) = status.branch {
            let _ = db.with_conn(|conn| {
                RepositoryDao::update_current_branch(conn, repo_id, Some(b.as_str()))
            });
        }
        Ok(status)
    }

    /// Lists remotes configured for the repository.
    pub fn list_remotes(db: &Database, repo_id: &str) -> Result<Vec<RemoteInfo>, CommandError> {
        let repo = Self::get_repository(db, repo_id)?;
        let path = Path::new(&repo.canonical_path);
        GitRemoteManager::list_remotes(path)
    }

    // -----------------------------------------------------------------
    // Ignore & Stash (v0.2 konfor paketi)
    // -----------------------------------------------------------------

    /// Untracked bir öğeyi yoksayma dosyasına ekler (`scope`: "repo"|"local").
    pub fn ignore_file(
        db: &Database,
        repo_id: &str,
        path: &str,
        scope: &str,
    ) -> Result<crate::models::IgnoredFile, CommandError> {
        let record = Self::get_repository(db, repo_id)?;
        crate::git::GitIgnoreManager::ignore(Path::new(&record.canonical_path), path, scope)
    }

    /// Çalışma ağacındaki değişiklikleri stash'ler; güncel durumu döner.
    pub fn stash_push(
        db: &Database,
        repo_id: &str,
        message: &str,
        include_untracked: bool,
    ) -> Result<GitStatus, CommandError> {
        let record = Self::get_repository(db, repo_id)?;
        crate::git::GitStashManager::push(
            Path::new(&record.canonical_path),
            message,
            include_untracked,
        )
    }

    pub fn stash_list(db: &Database, repo_id: &str) -> Result<Vec<crate::models::StashEntry>, CommandError> {
        let record = Self::get_repository(db, repo_id)?;
        crate::git::GitStashManager::list(Path::new(&record.canonical_path))
    }

    pub fn stash_apply(
        db: &Database,
        repo_id: &str,
        id: &str,
    ) -> Result<GitStatus, CommandError> {
        let record = Self::get_repository(db, repo_id)?;
        crate::git::GitStashManager::apply_or_pop(Path::new(&record.canonical_path), id, "apply")
    }

    pub fn stash_pop(db: &Database, repo_id: &str, id: &str) -> Result<GitStatus, CommandError> {
        let record = Self::get_repository(db, repo_id)?;
        crate::git::GitStashManager::apply_or_pop(Path::new(&record.canonical_path), id, "pop")
    }

    pub fn stash_drop(
        db: &Database,
        repo_id: &str,
        id: &str,
    ) -> Result<Vec<crate::models::StashEntry>, CommandError> {
        let record = Self::get_repository(db, repo_id)?;
        crate::git::GitStashManager::drop(Path::new(&record.canonical_path), id)
    }

    /// Son commit'in yalnızca mesajını yeniden yazar (push edilmemişse).
    pub fn amend_message(
        db: &Database,
        repo_id: &str,
        new_message: &str,
    ) -> Result<CommitResult, CommandError> {
        let record = Self::get_repository(db, repo_id)?;
        GitCommitManager::amend_message(Path::new(&record.canonical_path), new_message)
    }

    /// Detects current operation state (Normal, MergeInProgress, RebaseInProgress, etc.).
    pub fn get_operation_state(
        db: &Database,
        repo_id: &str,
    ) -> Result<RepositoryOperationState, CommandError> {
        let repo = Self::get_repository(db, repo_id)?;
        let path = Path::new(&repo.canonical_path);
        Ok(GitOperationStateManager::detect_state(path))
    }

    // -----------------------------------------------------------------
    // Faz 7 — details, re-link, clone, merge, commit details, compare
    // -----------------------------------------------------------------

    /// Returns repository metadata together with best-effort status/remotes.
    pub fn get_repository_details(
        db: &Database,
        repo_id: &str,
    ) -> Result<RepositoryDetails, CommandError> {
        let mut repo = Self::get_repository(db, repo_id)?;
        let path = Path::new(&repo.canonical_path);
        repo.missing = !path.is_dir();

        if repo.missing {
            return Ok(RepositoryDetails {
                repository: repo,
                status: None,
                remotes: Vec::new(),
                is_missing: true,
            });
        }

        let status = GitStatusParser::get_status(path).ok();
        let remotes = GitRemoteManager::list_remotes(path).unwrap_or_default();
        Ok(RepositoryDetails {
            repository: repo,
            status,
            remotes,
            is_missing: false,
        })
    }

    /// Re-links a repository record to a new (moved) directory.
    pub fn relink_repository(
        db: &Database,
        repo_id: &str,
        new_path: &str,
    ) -> Result<RepositoryRecord, CommandError> {
        let existing = Self::get_repository(db, repo_id)?;
        let canonical_root = GitAdapter::get_repository_root(Path::new(new_path.trim()))?;
        let canonical_str = canonical_root.to_string_lossy().to_string();

        let duplicate =
            db.with_conn(|conn| RepositoryDao::get_by_canonical_path(conn, &canonical_str))?;
        if let Some(dup) = duplicate
            && dup.id != repo_id
        {
            return Err(CommandError::repo_already_exists(format!(
                "Bu yol zaten başka bir kayda bağlı (ID: {})",
                dup.id
            )));
        }

        let display_name = canonical_root
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| existing.display_name.clone());
        let branch = GitStatusParser::get_status(&canonical_root)
            .ok()
            .and_then(|s| s.branch);

        db.with_conn(|conn| {
            RepositoryDao::update_path(
                conn,
                repo_id,
                &canonical_str,
                &display_name,
                branch.as_deref(),
            )
        })?;

        let mut updated = Self::get_repository(db, repo_id)?;
        updated.missing = false;
        Ok(updated)
    }

    /// Clones a remote repository into an empty directory and registers it.
    pub fn clone_repository(
        db: &Database,
        url: &str,
        destination: &str,
    ) -> Result<CloneResult, CommandError> {
        let cloned_path = GitCloneManager::clone_repository(url, destination)?;
        let path_str = cloned_path.to_string_lossy().to_string();
        let repository = Self::add_repository(db, &path_str)?;
        let status = GitStatusParser::get_status(&cloned_path)?;
        Ok(CloneResult { repository, status })
    }

    /// Safely merges a branch into the active branch.
    pub fn merge_branch(
        db: &Database,
        repo_id: &str,
        branch: &str,
    ) -> Result<GitStatus, CommandError> {
        let repo = Self::get_repository(db, repo_id)?;
        let path = Path::new(&repo.canonical_path);
        let status = GitMergeManager::merge_branch(path, branch)?;
        if let Some(ref b) = status.branch {
            let _ = db.with_conn(|conn| {
                RepositoryDao::update_current_branch(conn, repo_id, Some(b.as_str()))
            });
        }
        Ok(status)
    }

    /// Continues an in-progress merge/rebase/cherry-pick/revert operation.
    pub fn continue_operation(db: &Database, repo_id: &str) -> Result<GitStatus, CommandError> {
        let repo = Self::get_repository(db, repo_id)?;
        let path = Path::new(&repo.canonical_path);
        let status = GitMergeManager::continue_operation(path)?;
        if let Some(ref b) = status.branch {
            let _ = db.with_conn(|conn| {
                RepositoryDao::update_current_branch(conn, repo_id, Some(b.as_str()))
            });
        }
        Ok(status)
    }

    /// Aborts an in-progress operation. Callers MUST have obtained explicit
    /// user confirmation (the UI is responsible for that modal).
    pub fn abort_operation(db: &Database, repo_id: &str) -> Result<GitStatus, CommandError> {
        let repo = Self::get_repository(db, repo_id)?;
        let path = Path::new(&repo.canonical_path);
        let status = GitMergeManager::abort_operation(path)?;
        if let Some(ref b) = status.branch {
            let _ = db.with_conn(|conn| {
                RepositoryDao::update_current_branch(conn, repo_id, Some(b.as_str()))
            });
        }
        Ok(status)
    }

    /// Çakışmalı bir dosyayı seçilen tarafla çözer ve stage'ler.
    /// Yalnızca devam eden merge/rebase varasında ve dosya gerçekten
    /// çakışmalıysa çalışır (doğrulama GitMergeManager içinde).
    pub fn resolve_conflict(
        db: &Database,
        repo_id: &str,
        path: &str,
        ours: bool,
    ) -> Result<GitStatus, CommandError> {
        let repo = Self::get_repository(db, repo_id)?;
        GitMergeManager::resolve_with_side(Path::new(&repo.canonical_path), path, ours)
    }

    /// Reads full details for a commit.
    pub fn get_commit_details(
        db: &Database,
        repo_id: &str,
        sha: &str,
    ) -> Result<CommitDetails, CommandError> {
        let repo = Self::get_repository(db, repo_id)?;
        GitHistoryManager::get_commit_details(Path::new(&repo.canonical_path), sha)
    }

    /// Reads the unified diff of a commit.
    pub fn get_commit_diff(
        db: &Database,
        repo_id: &str,
        sha: &str,
    ) -> Result<DiffOutput, CommandError> {
        let repo = Self::get_repository(db, repo_id)?;
        GitHistoryManager::get_commit_diff(Path::new(&repo.canonical_path), sha)
    }

    /// Compares two branches (ahead/behind and commits unique to head).
    pub fn compare_branches(
        db: &Database,
        repo_id: &str,
        base: &str,
        head: &str,
    ) -> Result<BranchComparison, CommandError> {
        let repo = Self::get_repository(db, repo_id)?;
        GitHistoryManager::compare_branches(Path::new(&repo.canonical_path), base, head)
    }
}
