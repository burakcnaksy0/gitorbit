use crate::errors::CommandError;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};

/// Per-repository mutation lock registry.
///
/// Engineering Specification §3.4 / §9 (GT-017): mutations on the same
/// repository must not overlap. Different repositories may proceed in
/// parallel, so a single global lock is deliberately NOT used.
///
/// The registry is non-blocking: a second mutation receives
/// `REPOSITORY_BUSY` instead of hanging the UI.
#[derive(Clone, Default)]
pub struct RepoLockRegistry {
    inner: Arc<Mutex<HashSet<String>>>,
}

impl RepoLockRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Attempts to acquire the lock for `repo_id`.
    ///
    /// The returned guard releases the lock when dropped.
    pub fn try_acquire(&self, repo_id: &str) -> Result<RepoLockGuard, CommandError> {
        let mut locked = self.inner.lock().map_err(|_| {
            CommandError::new(
                "INTERNAL_ERROR",
                "Repository kilit defteri kullanılamıyor.",
                false,
            )
        })?;

        if !locked.insert(repo_id.to_string()) {
            return Err(CommandError::repository_busy(format!(
                "\"{}\" deposunda başka bir işlem devam ediyor.",
                repo_id
            )));
        }

        Ok(RepoLockGuard {
            registry: self.inner.clone(),
            repo_id: repo_id.to_string(),
        })
    }

    pub fn is_locked(&self, repo_id: &str) -> bool {
        self.inner
            .lock()
            .map(|locked| locked.contains(repo_id))
            .unwrap_or(false)
    }
}

#[derive(Debug)]
pub struct RepoLockGuard {
    registry: Arc<Mutex<HashSet<String>>>,
    repo_id: String,
}

impl Drop for RepoLockGuard {
    fn drop(&mut self) {
        if let Ok(mut locked) = self.registry.lock() {
            locked.remove(&self.repo_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_concurrent_mutation_for_same_repository() {
        let registry = RepoLockRegistry::new();
        let guard = registry.try_acquire("repo-1").expect("first lock");
        let err = registry.try_acquire("repo-1").unwrap_err();
        assert_eq!(err.code, "REPOSITORY_BUSY");
        drop(guard);
        assert!(registry.try_acquire("repo-1").is_ok());
    }

    #[test]
    fn allows_parallel_mutations_for_different_repositories() {
        let registry = RepoLockRegistry::new();
        let _a = registry.try_acquire("repo-a").expect("lock a");
        let _b = registry.try_acquire("repo-b").expect("lock b");
        assert!(registry.is_locked("repo-a"));
        assert!(registry.is_locked("repo-b"));
    }
}
