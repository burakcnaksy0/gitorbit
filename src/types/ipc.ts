/**
 * GitOrbit — Tauri IPC type definitions (Phase 2 & 3)
 *
 * These types mirror the Rust structs in gitorbit-core/src/models.rs
 * and the AppError in src-tauri/src/lib.rs.
 */

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export type AppErrorCode =
  | "VALIDATION_ERROR"
  | "GIT_NOT_INSTALLED"
  | "NOT_A_GIT_REPOSITORY"
  | "NOT_A_REPOSITORY"
  | "REPOSITORY_NOT_FOUND"
  | "REPO_NOT_FOUND"
  | "REPO_ALREADY_EXISTS"
  | "REPOSITORY_BUSY"
  | "DIRTY_WORKTREE"
  | "MERGE_IN_PROGRESS"
  | "REBASE_IN_PROGRESS"
  | "CONFLICTS_PRESENT"
  | "BRANCH_NOT_FOUND"
  | "BRANCH_ALREADY_EXISTS"
  | "BRANCH_NOT_MERGED"
  | "CANNOT_DELETE_ACTIVE_BRANCH"
  | "IDENTITY_MISSING"
  | "NO_UPSTREAM"
  | "AUTH_REQUIRED"
  | "AUTH_EXPIRED"
  | "PERMISSION_DENIED"
  | "NETWORK_ERROR"
  | "RATE_LIMITED"
  | "REMOTE_REJECTED"
  | "GIT_COMMAND_FAILED"
  | "GIT_ADD_FAILED"
  | "GIT_UNSTAGE_FAILED"
  | "GIT_RESTORE_FAILED"
  | "GIT_DIFF_FAILED"
  | "GIT_STATUS_FAILED"
  | "STATUS_CHANGED"
  | "INVALID_PATH"
  | "IO_ERROR"
  | "CREDENTIAL_STORE_UNAVAILABLE"
  | "DATABASE_ERROR"
  | "CANCELLED"
  | "TIMEOUT"
  | "INTERNAL_ERROR"
  // Phase 6 — GitHub
  | "OAUTH_STATE_MISMATCH"
  | "DEVICE_FLOW_EXPIRED"
  | "DEVICE_FLOW_PENDING"
  | "DEVICE_FLOW_ERROR"
  | "NO_ACTIVE_LOGIN"
  | "ACCOUNT_NOT_FOUND"
  | "NOT_FOUND"
  | "SERVER_ERROR"
  | "GITHUB_API_ERROR"
  | "NO_CREDENTIAL"
  | string; // allow forward-compat

export interface AppError {
  code: AppErrorCode;
  message: string;
  recoverable: boolean;
  /** Redacted technical details safe to show in the UI's expandable area. */
  safe_details?: string | null;
  /** Actionable hint, e.g. "Configure a Git identity first". */
  recovery_hint?: string | null;
  /** True when retrying the same command may succeed. */
  retryable?: boolean;
  /** Non-sensitive id to correlate a UI report with developer logs. */
  correlation_id?: string;
}

// ---------------------------------------------------------------------------
// Application metadata & settings
// ---------------------------------------------------------------------------

export interface AppInfo {
  name: string;
  version: string;
  os: string;
  arch: string;
}

export interface AppSettings {
  theme: string;
  default_clone_dir: string | null;
  diff_context_lines: number;
  log_level: string;
  confirm_destructive: boolean;
  active_github_account_id: string | null;
  auto_fetch: boolean;
  auto_fetch_minutes: number;
}

export interface AppSettingsUpdate {
  theme?: string;
  default_clone_dir?: string | null;
  diff_context_lines?: number;
  log_level?: string;
  confirm_destructive?: boolean;
  active_github_account_id?: string | null;
  auto_fetch?: boolean;
  auto_fetch_minutes?: number;
}

// ---------------------------------------------------------------------------
// Git environment
// ---------------------------------------------------------------------------

export interface GitEnvironment {
  installed: boolean;
  version: string | null;
  executable_path: string | null;
  /** Minimum supported Git version (documented in README). */
  minimum_version: string | null;
  /** True when Git is installed and satisfies `minimum_version`. */
  meets_minimum: boolean;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export interface RepositoryRecord {
  id: string;
  canonical_path: string;
  display_name: string;
  current_branch: string | null;
  last_opened_at: string | null;
  created_at: string;
  updated_at: string;
  /** True when the registered path no longer exists on disk. */
  missing: boolean;
}

// ---------------------------------------------------------------------------
// Git status
// ---------------------------------------------------------------------------

export type ChangedFileStatus =
  "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";

export interface ChangedFile {
  path: string;
  old_path: string | null;
  status: ChangedFileStatus;
  staged: boolean;
}

export type RepositoryOperationState =
  | "normal"
  | "merge_in_progress"
  | "rebase_in_progress"
  | "cherry_pick_in_progress"
  | "revert_in_progress"
  | "bisect_in_progress";

export interface GitStatus {
  repository_path: string;
  branch: string | null;
  is_detached_head: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged_files: ChangedFile[];
  unstaged_files: ChangedFile[];
  untracked_files: ChangedFile[];
  conflicted_files: string[];
  operation_state: RepositoryOperationState;
}

// ---------------------------------------------------------------------------
// Diff (Phase 3)
// ---------------------------------------------------------------------------

export type DiffLineKind = "header" | "hunk" | "added" | "removed" | "context";

export interface FileDiffLine {
  kind: DiffLineKind;
  content: string;
  /** 1-indexed old file line number; null for added/header/hunk lines */
  old_line_no: number | null;
  /** 1-indexed new file line number; null for removed/header/hunk lines */
  new_line_no: number | null;
}

export interface DiffOutput {
  path: string;
  /** True if the diff exceeded the 512 KB size limit and was not parsed */
  truncated: boolean;
  /** True if git reported this as a binary file */
  binary: boolean;
  /** Parsed diff lines; empty for binary or truncated files */
  lines: FileDiffLine[];
  /** Raw byte size of the diff output */
  raw_size: number;
}

// ---------------------------------------------------------------------------
// Phase 4 — Branch, Commit, History, Identity
// ---------------------------------------------------------------------------

export interface BranchInfo {
  name: string;
  is_current: boolean;
  is_remote: boolean;
  upstream: string | null;
  last_commit_hash: string | null;
  last_commit_message: string | null;
}

export interface CommitInfo {
  sha: string;
  short_sha: string;
  message: string;
  author_name: string;
  author_email: string;
  authored_at: string;
  parents: string[];
}

export interface HistoryOutput {
  commits: CommitInfo[];
  has_more: boolean;
  next_offset: number;
}

export interface ChangedFileDetails {
  path: string;
  old_path: string | null;
  status: ChangedFileStatus;
  staged: boolean;
}

export interface CommitDetails {
  commit: CommitInfo;
  files: ChangedFileDetails[];
  additions: number;
  deletions: number;
}

export interface BranchComparison {
  base: string;
  head: string;
  /** Commits that exist on `head` but not on `base`. */
  ahead: number;
  /** Commits that exist on `base` but not on `head`. */
  behind: number;
  commits: CommitInfo[];
}

export interface GitIdentity {
  name: string | null;
  email: string | null;
}

/** Sonucu of "yoksay" akışının (repository_ignore_file). */
export interface IgnoredFile {
  path: string;
  pattern: string;
  scope: "repo" | "local";
  already_present: boolean;
}

/** Tek bir stash girdisi. */
export interface StashEntry {
  index: string;
  message: string;
  date: string;
}

export interface CommitResult {
  commit_sha: string;
  status: GitStatus;
}

// ---------------------------------------------------------------------------
// Phase 5 — Remote & Operation State
// ---------------------------------------------------------------------------

export interface RemoteInfo {
  name: string;
  fetch_url: string | null;
  push_url: string | null;
}

export interface RepositoryDetails {
  repository: RepositoryRecord;
  status: GitStatus | null;
  remotes: RemoteInfo[];
  is_missing: boolean;
}

export interface CloneResult {
  repository: RepositoryRecord;
  status: GitStatus;
}

// ---------------------------------------------------------------------------
// Phase 6 — GitHub accounts & repository API
// ---------------------------------------------------------------------------

export type GitHubConnectionStatus = "connected" | "auth_required" | "auth_expired";

/**
 * Non-sensitive GitHub account metadata.
 * Token is NEVER included — it lives only in the OS credential store.
 */
export interface GitHubAccount {
  id: string;
  provider: string;
  provider_user_id: string;
  login: string;
  display_name: string | null;
  avatar_url: string | null;
  /** Opaque key referencing the OS keyring entry — NOT the token itself. */
  credential_ref: string;
  connection_status: GitHubConnectionStatus;
  created_at: string;
  last_used_at: string | null;
}

/**
 * Live public profile/overview data for a connected account (GET /user).
 * Public GitHub metadata only — never token material.
 */
export interface GitHubProfile {
  login: string;
  name: string | null;
  avatar_url: string | null;
  bio: string | null;
  html_url: string;
  company: string | null;
  location: string | null;
  public_repos: number;
  followers: number;
  following: number;
  created_at: string | null;
}

/** Outcome of publishing a local repository to GitHub. */
export interface GitHubPublishResult {
  html_url: string;
  clone_url: string;
  /** False when HEAD was unborn or git-level push failed (remote repo still created). */
  pushed: boolean;
  warning: string | null;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  clone_url: string;
  ssh_url: string;
  html_url: string;
  private: boolean;
  fork: boolean;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  visibility: string;
  owner_login: string;
}

export interface GitHubRepoPage {
  repos: GitHubRepo[];
  page: number;
  per_page: number;
  has_more: boolean;
}

/**
 * Returned by `githubBeginLogin`.
 * Contains data safe to show in the UI; device_code is kept server-side only.
 */
export interface DeviceFlowSession {
  /** Opaque session ID — pass this to `githubPollLogin`. */
  session_token: string;
  /** Short code the user types at `verification_uri`. */
  user_code: string;
  /** URL to open in the browser. */
  verification_uri: string;
  /** Seconds until the device code expires. */
  expires_in: number;
  /** Recommended polling interval in seconds. */
  interval: number;
}

/** Tagged union returned by `githubPollLogin`. */
export type PollResult =
  { status: "pending" } | { status: "success"; account: GitHubAccount };
