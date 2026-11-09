use crate::errors::CommandError;
use crate::git::adapter::GitAdapter;
use std::path::Path;
use std::time::Duration;

/// Git commit identity (`user.name` / `user.email`) operations.
///
/// Accounts get GitHub's noreply commit address so commits are attributed to
/// the right GitHub profile without leaking a personal e-mail — and without
/// touching the machine's global git configuration.
pub struct GitConfigManager;

impl GitConfigManager {
    /// GitHub noreply commit e-mail for an account (`{id}+{login}@users.noreply.github.com`).
    /// GitHub links this address to the account automatically; the legacy
    /// `{login}@users.noreply.github.com` form is used when no numeric id is known.
    pub fn noreply_email(provider_user_id: &str, login: &str) -> String {
        let id = provider_user_id.trim();
        if !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) {
            format!("{id}+{login}@users.noreply.github.com")
        } else {
            format!("{login}@users.noreply.github.com")
        }
    }

    /// True when HEAD resolves to a commit (repo has history). Rewriting an
    /// unborn repository is meaningless and git would only error out.
    pub fn has_commits(repo_dir: &Path) -> bool {
        GitAdapter::execute_with_env_and_timeout(
            repo_dir,
            &["rev-parse", "--verify", "-q", "HEAD"],
            &[],
            Some(Duration::from_secs(10)),
        )
        .map(|o| o.status.success())
        .unwrap_or(false)
    }

    /// `user.email` from the repository-LOCAL config only (ignores global).
    /// Used to detect an identity the user set by hand, which must be
    /// respected instead of being overwritten on every push.
    pub fn local_email(repo_dir: &Path) -> Option<String> {
        let out = GitAdapter::execute_with_env_and_timeout(
            repo_dir,
            &["config", "--local", "--get", "user.email"],
            &[],
            Some(Duration::from_secs(10)),
        )
        .ok()?;
        if !out.status.success() {
            return None;
        }
        let email = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (!email.is_empty()).then_some(email)
    }

    /// True when the working tree has staged/unstaged/untracked changes.
    /// `git filter-branch` refuses to rewrite history in that state, so the
    /// caller can produce a friendlier message than git's raw error.
    pub fn has_pending_changes(repo_dir: &Path) -> bool {
        GitAdapter::execute_with_env_and_timeout(
            repo_dir,
            &["status", "--porcelain"],
            &[],
            Some(Duration::from_secs(10)),
        )
        .map(|o| !String::from_utf8_lossy(&o.stdout).trim().is_empty())
        .unwrap_or(false)
    }

    /// Rewrites commits whose author/committer e-mail equals `from_email` to
    /// `name <email>` — the fix for commits that were silently attributed to
    /// the machine's default identity in a multi-account setup. Commits by
    /// other authors are left untouched.
    ///
    /// Implemented with `git filter-branch --env-filter`: the filter script
    /// is a fixed literal and every user-derived value is passed through the
    /// environment only (no string interpolation into a shell script —
    /// injection guard). The old history remains recoverable under
    /// `refs/original/` as git always does here.
    pub fn rewrite_authorship(
        repo_dir: &Path,
        from_email: &str,
        name: &str,
        email: &str,
    ) -> Result<(), CommandError> {
        const FILTER: &str = concat!(
            "if [ \"$GIT_AUTHOR_EMAIL\" = \"$GYBE_FROM_EMAIL\" ]; then ",
            "GIT_AUTHOR_NAME=\"$GYBE_NAME\"; GIT_AUTHOR_EMAIL=\"$GYBE_EMAIL\"; ",
            "export GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL; fi; ",
            "if [ \"$GIT_COMMITTER_EMAIL\" = \"$GYBE_FROM_EMAIL\" ]; then ",
            "GIT_COMMITTER_NAME=\"$GYBE_NAME\"; GIT_COMMITTER_EMAIL=\"$GYBE_EMAIL\"; ",
            "export GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL; fi"
        );
        GitAdapter::execute_with_env_and_timeout(
            repo_dir,
            &["filter-branch", "-f", "--env-filter", FILTER, "--", "--all"],
            &[
                ("FILTER_BRANCH_SQUELCH_WARNING", "1"),
                ("GYBE_FROM_EMAIL", from_email),
                ("GYBE_NAME", name),
                ("GYBE_EMAIL", email),
            ],
            Some(Duration::from_secs(120)),
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod identity_tests {
    use super::GitConfigManager;

    #[test]
    fn noreply_email_prefers_numeric_id_form() {
        assert_eq!(
            GitConfigManager::noreply_email("12345678", "acme"),
            "12345678+acme@users.noreply.github.com"
        );
        // Missing / non-numeric ids fall back to the legacy form.
        assert_eq!(
            GitConfigManager::noreply_email("", "acme"),
            "acme@users.noreply.github.com"
        );
        assert_eq!(
            GitConfigManager::noreply_email("abc", "acme"),
            "acme@users.noreply.github.com"
        );
    }
}
