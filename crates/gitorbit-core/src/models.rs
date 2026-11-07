use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitEnvironment {
    pub installed: bool,
    pub version: Option<String>,
    pub executable_path: Option<String>,
    /// Minimum Git version supported by GitOrbit (documented in README).
    pub minimum_version: Option<String>,
    /// True when Git is installed and its version is at least `minimum_version`.
    pub meets_minimum: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub os: String,
    pub arch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RepositoryRecord {
    pub id: String,
    pub canonical_path: String,
    pub display_name: String,
    pub current_branch: Option<String>,
    pub last_opened_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// True when the registered path no longer exists on disk.
    #[serde(default)]
    pub missing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChangedFileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChangedFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: ChangedFileStatus,
    pub staged: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum RepositoryOperationState {
    #[default]
    Normal,
    MergeInProgress,
    RebaseInProgress,
    CherryPickInProgress,
    RevertInProgress,
    BisectInProgress,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct GitStatus {
    pub repository_path: String,
    pub branch: Option<String>,
    pub is_detached_head: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub staged_files: Vec<ChangedFile>,
    pub unstaged_files: Vec<ChangedFile>,
    pub untracked_files: Vec<ChangedFile>,
    pub conflicted_files: Vec<String>,
    pub operation_state: RepositoryOperationState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RemoteInfo {
    pub name: String,
    pub fetch_url: Option<String>,
    pub push_url: Option<String>,
}

/// A single line in a unified diff output.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DiffLineKind {
    Header,
    Hunk,
    Added,
    Removed,
    Context,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileDiffLine {
    pub kind: DiffLineKind,
    pub content: String,
    /// 1-indexed old file line number (None for added/header/hunk lines)
    pub old_line_no: Option<u32>,
    /// 1-indexed new file line number (None for removed/header/hunk lines)
    pub new_line_no: Option<u32>,
}

/// Diff output for a single file or the whole repository.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DiffOutput {
    /// The file path being diffed
    pub path: String,
    /// Whether the diff was truncated due to size limits
    pub truncated: bool,
    /// Whether the file is binary (diff not shown)
    pub binary: bool,
    /// Parsed diff lines; empty for binary files
    pub lines: Vec<FileDiffLine>,
    /// Raw byte count of the diff (useful even when truncated)
    pub raw_size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
    pub last_commit_hash: Option<String>,
    pub last_commit_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommitInfo {
    pub sha: String,
    pub short_sha: String,
    pub message: String,
    pub author_name: String,
    pub author_email: String,
    pub authored_at: String,
    pub parents: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryOutput {
    pub commits: Vec<CommitInfo>,
    pub has_more: bool,
    pub next_offset: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitIdentity {
    pub name: Option<String>,
    pub email: Option<String>,
}

/// Sonucu of "yoksay" (gitignore) akışının. Public metadata only.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IgnoredFile {
    /// Depo-yolundaki öğe (girdi).
    pub path: String,
    /// Yazılan gitignore deseni (kökene sabitli, dizinler `/` ile biter).
    pub pattern: String,
    /// "repo" (.gitignore) | "local" (.git/info/exclude)
    pub scope: String,
    /// Desen zaten mevcutsa true — dosyaya tekrar yazılmaz.
    pub already_present: bool,
}

/// Tek bir `git stash` girdisi (public metadata — içerik taşımaz).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StashEntry {
    /// Sıra numarası (`stash@{N}` içindeki N).
    pub index: String,
    /// `WIP on branch: sha msg` / `On branch: msg` öneki soyulmuş özet.
    pub message: String,
    /// `git stash list --format %ci` tarihi.
    pub date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommitResult {
    pub commit_sha: String,
    pub status: GitStatus,
}

// ---------------------------------------------------------------------------
// Phase 6 — GitHub accounts & repository API
// SECURITY: GitHubAccount and GitHubRepo MUST NOT contain token/secret fields.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GitHubConnectionStatus {
    #[default]
    Connected,
    AuthRequired,
    AuthExpired,
}

/// Non-sensitive GitHub account metadata stored in SQLite.
/// Token is NEVER included — it lives only in the OS credential store.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitHubAccount {
    pub id: String,
    pub provider: String,
    pub provider_user_id: String,
    pub login: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    /// Key used to look up the token in the OS credential store.
    /// This is NOT the token itself.
    pub credential_ref: String,
    pub connection_status: GitHubConnectionStatus,
    pub created_at: String,
    pub last_used_at: Option<String>,
}

/// Public profile/overview data for a connected GitHub account, fetched live
/// from the GitHub REST API (`GET /user`). Contains only data GitHub already
/// serves publicly to the authenticated user; never any token material.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitHubProfile {
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub bio: Option<String>,
    /// Canonical github.com profile URL (safe to open in a browser).
    pub html_url: String,
    pub company: Option<String>,
    pub location: Option<String>,
    pub public_repos: i64,
    pub followers: i64,
    pub following: i64,
    /// Account creation date as reported by GitHub (ISO-8601).
    pub created_at: Option<String>,
}

/// Result of creating a repository on GitHub via `POST /user/repos`.
/// Public metadata only — never token material.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitHubCreatedRepo {
    pub full_name: String,
    pub html_url: String,
    pub clone_url: String,
    pub private: bool,
    /// Hesap için `ssh_hosts.toml` eşlemesi varsa tercih edilecek SSH remote
    /// adresi (host alias'lı, örn. `git@github-alt:owner/repo.git`).
    pub ssh_remote: Option<String>,
}

/// Outcome of the "publish local repository to GitHub" flow:
/// the remote repo is created and `origin` is configured; `pushed` reports
/// whether commits were actually transferred (false when HEAD is unborn or
/// git-level push failed — the created remote repo remains usable).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitHubPublishResult {
    pub html_url: String,
    pub clone_url: String,
    pub pushed: bool,
    pub warning: Option<String>,
}

/// A single GitHub repository item returned from the API.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitHubRepo {
    pub id: i64,
    pub name: String,
    pub full_name: String,
    pub description: Option<String>,
    pub clone_url: String,
    pub ssh_url: String,
    pub html_url: String,
    pub private: bool,
    pub fork: bool,
    pub default_branch: String,
    pub language: Option<String>,
    pub stargazers_count: i64,
    pub visibility: String,
    pub owner_login: String,
}

/// Paginated repository listing result.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitHubRepoPage {
    pub repos: Vec<GitHubRepo>,
    pub page: u32,
    pub per_page: u32,
    pub has_more: bool,
}

/// Data returned to the frontend when the device-flow session is started.
/// The `device_code` is intentionally omitted — it stays in Rust memory only.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceFlowSession {
    /// Opaque session identifier. Frontend passes this to `github_poll_login`.
    pub session_token: String,
    /// Short user code to type at `verification_uri`.
    pub user_code: String,
    /// URL to open in the browser for the user to authenticate.
    pub verification_uri: String,
    /// Seconds until the device code expires.
    pub expires_in: u64,
    /// Recommended polling interval in seconds.
    pub interval: u64,
}

/// Result of a single device-flow poll attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PollResult {
    /// User has not yet authorised; caller should try again after `interval` seconds.
    Pending,
    /// User authorised; account is now connected and recorded.
    Success { account: Box<GitHubAccount> },
}

// ---------------------------------------------------------------------------
// Phase 7 — settings, cloning, commit details, merge and branch comparison
// ---------------------------------------------------------------------------

/// Non-sensitive application preferences persisted in SQLite.
/// Tokens, passwords and Git credentials MUST NOT be stored here.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppSettings {
    pub theme: String,
    pub default_clone_dir: Option<String>,
    pub diff_context_lines: u32,
    pub log_level: String,
    pub confirm_destructive: bool,
    #[serde(default)]
    pub active_github_account_id: Option<String>,
    /// v0.2: arka plan fetch'i (uzak değişiklik rozetleri) açık mı?
    #[serde(default = "default_true")]
    pub auto_fetch: bool,
    /// v0.2: arka plan fetch aralığı (dakika, min 1).
    #[serde(default = "default_fetch_minutes")]
    pub auto_fetch_minutes: u32,
}

fn default_true() -> bool {
    true
}
fn default_fetch_minutes() -> u32 {
    3
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            default_clone_dir: None,
            diff_context_lines: 3,
            log_level: "info".to_string(),
            confirm_destructive: true,
            active_github_account_id: None,
            auto_fetch: true,
            auto_fetch_minutes: 3,
        }
    }
}

/// Partial update payload for `settings_update`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppSettingsUpdate {
    pub theme: Option<String>,
    pub default_clone_dir: Option<String>,
    pub diff_context_lines: Option<u32>,
    pub log_level: Option<String>,
    pub confirm_destructive: Option<bool>,
    pub active_github_account_id: Option<String>,
    #[serde(default)]
    pub auto_fetch: Option<bool>,
    #[serde(default)]
    pub auto_fetch_minutes: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CloneResult {
    pub repository: RepositoryRecord,
    pub status: GitStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RepositoryDetails {
    pub repository: RepositoryRecord,
    pub status: Option<GitStatus>,
    pub remotes: Vec<RemoteInfo>,
    pub is_missing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommitDetails {
    pub commit: CommitInfo,
    pub files: Vec<ChangedFile>,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BranchComparison {
    pub base: String,
    pub head: String,
    /// Commits that exist on `head` but not on `base`.
    pub ahead: u32,
    /// Commits that exist on `base` but not on `head`.
    pub behind: u32,
    pub commits: Vec<CommitInfo>,
}
