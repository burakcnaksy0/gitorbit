/**
 * View models used by the presentation layer.
 *
 * These are *derived* from the IPC types (`RepositoryRecord`, `GitStatus`, ...)
 * by `Shell.tsx`. They never contain fabricated data: a field that the backend
 * cannot provide stays empty/null and the UI renders the corresponding
 * loading / empty / error state instead.
 */

export type NavigationTab =
  "welcome" | "repositories" | "changes" | "history" | "branches" | "github" | "settings";

export interface RepositorySummary {
  id: string;
  name: string;
  path: string;
  /** Null when the repository has no checked-out branch (detached/uninitialised). */
  currentBranch: string | null;
  ahead: number;
  behind: number;
  stagedCount: number;
  unstagedCount: number;
  lastCommitMessage: string | null;
  lastCommitDate: string | null;
  upstream?: string | null;
  operationState?:
    | "normal"
    | "merge_in_progress"
    | "rebase_in_progress"
    | "cherry_pick_in_progress"
    | "revert_in_progress"
    | "bisect_in_progress";
  conflictedCount?: number;
  /** True when the registered path is gone from disk. */
  missing?: boolean;
}

export interface ChangeFileSummary {
  id: string;
  path: string;
  status: "modified" | "added" | "deleted" | "untracked";
  staged: boolean;
  additions: number;
  deletions: number;
}

export interface CommitSummary {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: string;
  message: string;
}

export interface BranchSummary {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream?: string;
  lastCommitHash: string;
}

// Backwards-compatible aliases. New code should use the names above.
/** @deprecated Use `RepositorySummary`. */
export type MockRepository = RepositorySummary;
/** @deprecated Use `ChangeFileSummary`. */
export type MockChangeFile = ChangeFileSummary;
/** @deprecated Use `CommitSummary`. */
export type MockCommit = CommitSummary;
/** @deprecated Use `BranchSummary`. */
export type MockBranch = BranchSummary;
