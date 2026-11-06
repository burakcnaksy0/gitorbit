use crate::git::adapter::GitAdapter;
use crate::models::RepositoryOperationState;
use std::path::{Path, PathBuf};

pub struct GitOperationStateManager;

impl GitOperationStateManager {
    /// Detects current Git operation state by inspecting git directory metadata.
    /// Adheres to spec 4.13: relies on Git directory metadata, not raw stderr guessing.
    pub fn detect_state(repo_dir: &Path) -> RepositoryOperationState {
        let git_dir = Self::resolve_git_dir(repo_dir);

        // 1. Rebase in progress (rebase-merge or rebase-apply directory)
        if git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists() {
            return RepositoryOperationState::RebaseInProgress;
        }

        // 2. Merge in progress (MERGE_HEAD file exists)
        if git_dir.join("MERGE_HEAD").exists() {
            return RepositoryOperationState::MergeInProgress;
        }

        // 3. Cherry-pick in progress (CHERRY_PICK_HEAD file exists)
        if git_dir.join("CHERRY_PICK_HEAD").exists() {
            return RepositoryOperationState::CherryPickInProgress;
        }

        // 4. Revert in progress (REVERT_HEAD file exists)
        if git_dir.join("REVERT_HEAD").exists() {
            return RepositoryOperationState::RevertInProgress;
        }

        // 5. Bisect in progress (BISECT_LOG or BISECT_START file exists)
        if git_dir.join("BISECT_LOG").exists() || git_dir.join("BISECT_START").exists() {
            return RepositoryOperationState::BisectInProgress;
        }

        RepositoryOperationState::Normal
    }

    /// Resolves the effective `.git` directory for a repository (handles regular repos, worktrees, and submodules).
    pub fn resolve_git_dir(repo_dir: &Path) -> PathBuf {
        if let Ok(output) = GitAdapter::execute(repo_dir, &["rev-parse", "--git-dir"])
            && output.status.success()
        {
            let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let p = PathBuf::from(raw);
            if p.is_absolute() {
                return p;
            } else {
                return repo_dir.join(p);
            }
        }
        repo_dir.join(".git")
    }
}
