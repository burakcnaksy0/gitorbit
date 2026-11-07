/**
 * GitOrbit — Tauri command wrappers (Phase 2 & 3)
 *
 * All Tauri IPC calls go through this module. The frontend never calls
 * `invoke()` directly — it always uses these typed wrappers.
 *
 * Error handling: every function throws an `AppError` on failure.
 * Callers should catch errors and display them via the error state of
 * their component (never swallow silently).
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  AppError,
  AppInfo,
  AppSettings,
  AppSettingsUpdate,
  BranchComparison,
  BranchInfo,
  CloneResult,
  CommitDetails,
  CommitResult,
  DeviceFlowSession,
  DiffOutput,
  GitEnvironment,
  GitHubAccount,
  GitHubProfile,
  GitHubPublishResult,
  GitHubRepoPage,
  GitIdentity,
  IgnoredFile,
  StashEntry,
  RepoSyncOutcome,
  GitStatus,
  HistoryOutput,
  PollResult,
  RemoteInfo,
  RepositoryDetails,
  RepositoryOperationState,
  RepositoryRecord,
} from "../types/ipc";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Calls a Tauri command and re-throws backend errors as typed `AppError`.
 */
async function tauriCall<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    // Tauri serialises Rust Err(AppError) as the thrown value directly.
    // We re-throw it typed for caller convenience.
    throw raw as AppError;
  }
}

// ---------------------------------------------------------------------------
// Faz 2 — environment & repository management
// ---------------------------------------------------------------------------

/** Returns Git installation status, version, and executable path. */
export async function appGetEnvironment(): Promise<GitEnvironment> {
  return tauriCall<GitEnvironment>("app_get_environment");
}

/** Returns static application metadata (name, version, OS, architecture). */
export async function appGetInfo(): Promise<AppInfo> {
  return tauriCall<AppInfo>("app_get_info");
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Reads persisted application settings. */
export async function settingsGet(): Promise<AppSettings> {
  return tauriCall<AppSettings>("settings_get");
}

/** Validates and persists application settings. */
export async function settingsUpdate(update: AppSettingsUpdate): Promise<AppSettings> {
  return tauriCall<AppSettings>("settings_update", { update });
}

/** Adds a repository by path. Returns the created record. */
export async function repositoryAdd(path: string): Promise<RepositoryRecord> {
  return tauriCall<RepositoryRecord>("repository_add", { path });
}

/**
 * Initializes `git init` in a plain (non-Git) directory and registers it.
 * Throws `ALREADY_A_GIT_REPOSITORY` if the folder already is a repository.
 */
export async function repositoryInit(path: string): Promise<RepositoryRecord> {
  return tauriCall<RepositoryRecord>("repository_init", { path });
}

/** Lists all registered repositories. */
export async function repositoryList(): Promise<RepositoryRecord[]> {
  return tauriCall<RepositoryRecord[]>("repository_list");
}

/** Removes a repository from the DB. Does NOT delete files on disk. */
export async function repositoryRemove(repoId: string): Promise<boolean> {
  return tauriCall<boolean>("repository_remove", { repoId });
}

/** Sabitleme bayrağını günceller (v0.2, madde 10). Güncel kaydı döner. */
export async function repositorySetPinned(
  repoId: string,
  pinned: boolean
): Promise<RepositoryRecord> {
  return tauriCall<RepositoryRecord>("repository_set_pinned", { repoId, pinned });
}

/** Returns the current Git status for a repository. */
export async function repositoryGetStatus(repoId: string): Promise<GitStatus> {
  return tauriCall<GitStatus>("repository_get_status", { repoId });
}

/** Returns repository metadata plus best-effort status and remotes. */
export async function repositoryGetDetails(repoId: string): Promise<RepositoryDetails> {
  return tauriCall<RepositoryDetails>("repository_get_details", { repoId });
}

/** Re-links an existing record to a moved repository directory. */
export async function repositoryRelink(
  repoId: string,
  newPath: string
): Promise<RepositoryRecord> {
  return tauriCall<RepositoryRecord>("repository_relink", { repoId, newPath });
}

/** Clones a remote URL into an empty destination and registers the result. */
export async function repositoryClone(
  url: string,
  destination: string
): Promise<CloneResult> {
  return tauriCall<CloneResult>("repository_clone", { url, destination });
}

/** Reveals a path in the OS file manager. */
export async function openPathInFileManager(path: string): Promise<void> {
  return tauriCall<void>("open_path_in_file_manager", { path });
}

// ---------------------------------------------------------------------------
// Faz 3 — stage / unstage / diff / discard
// ---------------------------------------------------------------------------

/**
 * Stages the given file paths (relative to repository root).
 * Returns the refreshed Git status.
 * Throws `INVALID_PATH` if a path traversal or absolute path is detected.
 */
export async function repositoryStageFiles(
  repoId: string,
  paths: string[]
): Promise<GitStatus> {
  return tauriCall<GitStatus>("repository_stage_files", { repoId, paths });
}

/**
 * Unstages the given file paths.
 * Returns the refreshed Git status.
 */
export async function repositoryUnstageFiles(
  repoId: string,
  paths: string[]
): Promise<GitStatus> {
  return tauriCall<GitStatus>("repository_unstage_files", { repoId, paths });
}

/**
 * Returns the diff for a single file.
 *
 * @param staged - `true` for staged diff, `false` for unstaged diff
 *
 * Check `result.binary` before rendering lines.
 * Check `result.truncated` to show a "diff too large" warning.
 */
export async function repositoryGetDiff(
  repoId: string,
  filePath: string,
  staged: boolean
): Promise<DiffOutput> {
  return tauriCall<DiffOutput>("repository_get_diff", {
    repoId,
    filePath,
    staged,
  });
}

/**
 * Returns the current status hash for a repository.
 *
 * This token must be obtained immediately before showing the discard
 * confirmation dialog and passed as `expectedStatusHash` to `repositoryDiscardChanges`.
 * If the status changes between obtaining the hash and confirming, the backend
 * will reject the operation with `STATUS_CHANGED`.
 */
export async function repositoryGetStatusHash(repoId: string): Promise<string> {
  return tauriCall<string>("repository_get_status_hash", { repoId });
}

/**
 * Discards changes for a single file.
 *
 * HIGH RISK: for unstaged files this runs `git restore -- <path>`.
 *            For untracked files this DELETES the file from disk.
 *
 * Safety protocol:
 * 1. Call `repositoryGetStatusHash()` to obtain the current status token.
 * 2. Display the confirmation dialog showing EXACTLY which file will be affected.
 * 3. On user confirmation, call this function with the token.
 * 4. If the backend returns `STATUS_CHANGED`, inform the user and restart the flow.
 *
 * @param expectedStatusHash - Token from `repositoryGetStatusHash()`.
 */
export async function repositoryDiscardChanges(
  repoId: string,
  filePath: string,
  expectedStatusHash: string
): Promise<GitStatus> {
  return tauriCall<GitStatus>("repository_discard_changes", {
    repoId,
    filePath,
    expectedStatusHash,
  });
}

// ---------------------------------------------------------------------------
// Faz 4 — branch, commit, identity & history
// ---------------------------------------------------------------------------

/** Lists all branches for a repository. */
export async function repositoryGetBranches(repoId: string): Promise<BranchInfo[]> {
  return tauriCall<BranchInfo[]>("repository_get_branches", { repoId });
}

/** Creates a branch with optional base reference and optional checkout. */
export async function repositoryCreateBranch(
  repoId: string,
  name: string,
  baseRef?: string | null,
  checkout = false
): Promise<BranchInfo> {
  return tauriCall<BranchInfo>("repository_create_branch", {
    repoId,
    name,
    baseRef: baseRef ?? null,
    checkout,
  });
}

/** Safely checks out a branch. Fails with DIRTY_WORKTREE if changes would be overwritten. */
export async function repositoryCheckoutBranch(
  repoId: string,
  branch: string
): Promise<GitStatus> {
  return tauriCall<GitStatus>("repository_checkout_branch", { repoId, branch });
}

/** Safely deletes a branch (never the active branch). */
export async function repositoryDeleteBranch(
  repoId: string,
  branch: string,
  force = false
): Promise<boolean> {
  return tauriCall<boolean>("repository_delete_branch", { repoId, branch, force });
}

/** Reads effective Git identity (user.name and user.email). */
export async function repositoryGetIdentity(repoId: string): Promise<GitIdentity> {
  return tauriCall<GitIdentity>("repository_get_identity", { repoId });
}

/** Sets repository-local Git identity (user.name and user.email). */
export async function repositorySetIdentity(
  repoId: string,
  name: string,
  email: string
): Promise<GitIdentity> {
  return tauriCall<GitIdentity>("repository_set_identity", { repoId, name, email });
}

/** Creates a commit with the provided message. Enforces identity guard and staged checks. */
export async function repositoryCommit(
  repoId: string,
  message: string,
  amend = false
): Promise<CommitResult> {
  return tauriCall<CommitResult>("repository_commit", { repoId, message, amend });
}

/** Son commit'in yalnızca mesajını düzenler; push edilmişse AMEND_PUSHED döner (v0.2). */
export async function repositoryAmendMessage(
  repoId: string,
  message: string
): Promise<CommitResult> {
  return tauriCall<CommitResult>("repository_amend_message", { repoId, message });
}

/** Çakışmalı dosyayı seçilen tarafla çözer ve stage'ler (v0.2, madde 7). */
export async function repositoryResolveConflict(
  repoId: string,
  path: string,
  side: "ours" | "theirs"
): Promise<GitStatus> {
  return tauriCall<GitStatus>("repository_resolve_conflict", { repoId, path, side });
}

/** Tüm depoları sırayla çeker (v0.2, madde 8). Depo başına sonuç listesi döner. */
export async function syncPullAll(): Promise<RepoSyncOutcome[]> {
  return tauriCall<RepoSyncOutcome[]>("sync_pull_all", {});
}

/** Tüm depoları sırayla iter (v0.2, madde 8). */
export async function syncPushAll(): Promise<RepoSyncOutcome[]> {
  return tauriCall<RepoSyncOutcome[]>("sync_push_all", {});
}

/** Devam eden toplu senkron turunu bir sonraki depoda durdurur. */
export async function syncCancelAll(): Promise<boolean> {
  return tauriCall<boolean>("sync_cancel_all", {});
}

/** Untracked bir öğeyi yoksayma dosyasına ekler (v0.2). */
export async function repositoryIgnoreFile(
  repoId: string,
  path: string,
  scope: "repo" | "local"
): Promise<IgnoredFile> {
  return tauriCall<IgnoredFile>("repository_ignore_file", { repoId, path, scope });
}

/** Çalışma ağacını stash'ler; güncel durumu döner (v0.2). */
export async function repositoryStashPush(
  repoId: string,
  message?: string,
  includeUntracked?: boolean
): Promise<GitStatus> {
  return tauriCall<GitStatus>("repository_stash_push", {
    repoId,
    message: message ?? null,
    includeUntracked: includeUntracked ?? null,
  });
}

export async function repositoryStashList(repoId: string): Promise<StashEntry[]> {
  return tauriCall<StashEntry[]>("repository_stash_list", { repoId });
}

/** Stash'i uygular; stash listede kalır (v0.2). */
export async function repositoryStashApply(
  repoId: string,
  id: string
): Promise<GitStatus> {
  return tauriCall<GitStatus>("repository_stash_apply", { repoId, id });
}

/** Stash'i uygular ve listeden düşürür (v0.2). */
export async function repositoryStashPop(repoId: string, id: string): Promise<GitStatus> {
  return tauriCall<GitStatus>("repository_stash_pop", { repoId, id });
}

export async function repositoryStashDrop(
  repoId: string,
  id: string
): Promise<StashEntry[]> {
  return tauriCall<StashEntry[]>("repository_stash_drop", { repoId, id });
}

/** Reads commit history with pagination. */
export async function repositoryGetHistory(
  repoId: string,
  refName?: string | null,
  limit = 50,
  offset = 0
): Promise<HistoryOutput> {
  return tauriCall<HistoryOutput>("repository_get_history", {
    repoId,
    refName: refName ?? null,
    limit,
    offset,
  });
}

/** Reads full details (files and line stats) for a commit. */
export async function repositoryGetCommitDetails(
  repoId: string,
  sha: string
): Promise<CommitDetails> {
  return tauriCall<CommitDetails>("repository_get_commit_details", { repoId, sha });
}

/** Reads the unified diff of a commit. */
export async function repositoryGetCommitDiff(
  repoId: string,
  sha: string
): Promise<DiffOutput> {
  return tauriCall<DiffOutput>("repository_get_commit_diff", { repoId, sha });
}

/** Compares two branches (ahead/behind and commits unique to `head`). */
export async function repositoryCompareBranches(
  repoId: string,
  base: string,
  head: string
): Promise<BranchComparison> {
  return tauriCall<BranchComparison>("repository_compare_branches", {
    repoId,
    base,
    head,
  });
}

// ---------------------------------------------------------------------------
// Faz 5 — remote operations & operation state
// ---------------------------------------------------------------------------

/**
 * Fetches changes from a remote without altering working tree files.
 * Refreshes remote tracking branches and upstream ahead/behind counts.
 */
export async function repositoryFetch(
  repoId: string,
  remote?: string | null
): Promise<GitStatus> {
  return tauriCall<GitStatus>("repository_fetch", {
    repoId,
    remote: remote ?? null,
  });
}

/**
 * Pulls changes from upstream or specified remote/branch into the active branch.
 * Throws NO_UPSTREAM if no upstream is configured.
 * Throws CONFLICTS_PRESENT without destructive reset if conflicts occur.
 * Throws DIRTY_WORKTREE if uncommitted changes would be overwritten.
 */
export async function repositoryPull(
  repoId: string,
  remote?: string | null,
  branch?: string | null,
  strategy?: "merge" | "rebase" | null
): Promise<GitStatus> {
  return tauriCall<GitStatus>("repository_pull", {
    repoId,
    remote: remote ?? null,
    branch: branch ?? null,
    strategy: strategy ?? null,
  });
}

/**
 * Pushes commits of the active branch to remote.
 * Rejects non-fast-forward updates with REMOTE_REJECTED (never auto-forces).
 * Force push (when explicitly requested) uses --force-with-lease.
 */
export async function repositoryPush(
  repoId: string,
  remote?: string | null,
  branch?: string | null,
  force = false,
  setUpstream = false
): Promise<GitStatus> {
  return tauriCall<GitStatus>("repository_push", {
    repoId,
    remote: remote ?? null,
    branch: branch ?? null,
    force,
    setUpstream,
  });
}

/** Lists all remotes configured for the repository. */
export async function repositoryListRemotes(repoId: string): Promise<RemoteInfo[]> {
  return tauriCall<RemoteInfo[]>("repository_list_remotes", { repoId });
}

/** Returns the current repository operation state (normal, merge_in_progress, etc.). */
export async function repositoryGetOperationState(
  repoId: string
): Promise<RepositoryOperationState> {
  return tauriCall<RepositoryOperationState>("repository_get_operation_state", {
    repoId,
  });
}

/**
 * Safely merges `branch` into the active branch.
 *
 * Conflicting merges are never resolved destructively: the backend reports
 * `CONFLICTS_PRESENT` and leaves the operation in progress so the user can
 * continue or abort explicitly.
 */
export async function repositoryMergeBranch(
  repoId: string,
  branch: string
): Promise<GitStatus> {
  return tauriCall<GitStatus>("repository_merge_branch", { repoId, branch });
}

/** Continues an in-progress merge/rebase/cherry-pick/revert. */
export async function repositoryContinueOperation(repoId: string): Promise<GitStatus> {
  return tauriCall<GitStatus>("repository_continue_operation", { repoId });
}

/**
 * Aborts an in-progress operation.
 *
 * DESTRUCTIVE: the caller MUST have obtained explicit user confirmation.
 */
export async function repositoryAbortOperation(repoId: string): Promise<GitStatus> {
  return tauriCall<GitStatus>("repository_abort_operation", { repoId });
}

// ---------------------------------------------------------------------------
// Faz 6 — GitHub accounts & repository API
// ---------------------------------------------------------------------------

/**
 * Starts a GitHub Device-Flow login session.
 *
 * The returned `DeviceFlowSession` contains display data only (user_code,
 * verification_uri). The `device_code` stays in Rust memory and is NEVER
 * sent to the frontend.
 *
 * Usage:
 * 1. Call this function and show `user_code` to the user.
 * 2. Open `verification_uri` in the browser.
 * 3. Poll `githubPollLogin` every `interval` seconds until success or error.
 */
export async function githubBeginLogin(): Promise<DeviceFlowSession> {
  return tauriCall<DeviceFlowSession>("github_begin_login");
}

/**
 * Polls the active device-flow session once.
 *
 * - Returns `{ status: "pending" }` while waiting for the user to authorise.
 * - Returns `{ status: "success", account: GitHubAccount }` when done.
 * - Throws `OAUTH_STATE_MISMATCH` if `sessionToken` is wrong.
 * - Throws `DEVICE_FLOW_EXPIRED` if the code has expired (call `githubBeginLogin` again).
 * - Throws `AUTH_REQUIRED` if the user denied access.
 *
 * @param sessionToken - The `session_token` from the `DeviceFlowSession` returned by `githubBeginLogin`.
 */
export async function githubPollLogin(sessionToken: string): Promise<PollResult> {
  return tauriCall<PollResult>("github_poll_login", { sessionToken });
}

/** Returns all connected GitHub accounts. Token is NEVER included. */
export async function githubListAccounts(): Promise<GitHubAccount[]> {
  return tauriCall<GitHubAccount[]>("github_list_accounts");
}

/**
 * Disconnects a GitHub account.
 *
 * Deletes the token from the OS credential store and removes the account metadata
 * from the local database. Git credential helpers are NOT modified.
 *
 * @param accountId - The UUID of the account to disconnect.
 */
export async function githubDisconnectAccount(accountId: string): Promise<void> {
  return tauriCall<void>("github_disconnect_account", { accountId });
}

/**
 * Lists repositories for the given GitHub account with pagination.
 *
 * - `page` is 1-indexed (default: 1).
 * - `perPage` is clamped server-side to 1–100 (default: 30).
 * - Check `result.has_more` to determine if more pages are available.
 * - Throws `AUTH_EXPIRED` if the stored token is missing or invalid.
 * - Throws `RATE_LIMITED` with reset time if the GitHub API rate limit is hit.
 */
export async function githubListRepos(
  accountId: string,
  page = 1,
  perPage = 30
): Promise<GitHubRepoPage> {
  return tauriCall<GitHubRepoPage>("github_list_repos", {
    accountId,
    page,
    perPage,
  });
}

/**
 * Fetches the live public profile/overview for a connected GitHub account
 * (avatar, bio, company, location, repo/follower counts).
 *
 * - Throws `ACCOUNT_NOT_FOUND` if the account is unknown or disconnected.
 * - Throws `AUTH_EXPIRED` if the stored token is missing.
 */
export async function githubGetAccountProfile(accountId: string): Promise<GitHubProfile> {
  return tauriCall<GitHubProfile>("github_get_account_profile", {
    accountId,
  });
}

/**
 * Publishes a local repository to GitHub: creates the remote repo under the
 * chosen account, configures `origin`, and best-effort pushes the current
 * branch. Check `result.pushed` / `result.warning` for the outcome details.
 *
 * - Throws `REMOTE_EXISTS` if the repo already has an `origin`.
 * - Throws `REPO_NAME_INVALID` for invalid repository names.
 */
export async function githubPublishRepository(
  accountId: string,
  repoId: string,
  name: string,
  description?: string | null,
  isPrivate = false
): Promise<GitHubPublishResult> {
  return tauriCall<GitHubPublishResult>("github_publish_repository", {
    accountId,
    repoId,
    name,
    description: description ?? null,
    private: isPrivate,
  });
}
