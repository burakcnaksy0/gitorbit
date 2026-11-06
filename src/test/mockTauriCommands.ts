/**
 * Complete `vi.fn()` surface for `src/lib/tauriCommands`.
 *
 * Tests use this with
 * `vi.mock("../lib/tauriCommands", () => import("../test/mockTauriCommands"))`
 * so that the module always exposes every command the UI imports. Individual
 * tests then set return values with `vi.mocked(...).mockResolvedValue(...)`.
 */
import { vi } from "vitest";

export const appGetEnvironment = vi.fn();
export const appGetInfo = vi.fn();
export const settingsGet = vi.fn();
export const settingsUpdate = vi.fn();

export const repositoryAdd = vi.fn();
export const repositoryList = vi.fn();
export const repositoryRemove = vi.fn();
export const repositoryGetStatus = vi.fn();
export const repositoryGetDetails = vi.fn();
export const repositoryRelink = vi.fn();
export const repositoryClone = vi.fn();
export const openPathInFileManager = vi.fn();

export const repositoryStageFiles = vi.fn();
export const repositoryUnstageFiles = vi.fn();
export const repositoryGetDiff = vi.fn();
export const repositoryGetStatusHash = vi.fn();
export const repositoryDiscardChanges = vi.fn();

export const repositoryGetBranches = vi.fn();
export const repositoryCreateBranch = vi.fn();
export const repositoryCheckoutBranch = vi.fn();
export const repositoryDeleteBranch = vi.fn();
export const repositoryGetIdentity = vi.fn();
export const repositorySetIdentity = vi.fn();
export const repositoryCommit = vi.fn();
export const repositoryGetHistory = vi.fn();
export const repositoryGetCommitDetails = vi.fn();
export const repositoryGetCommitDiff = vi.fn();
export const repositoryCompareBranches = vi.fn();

export const repositoryFetch = vi.fn();
export const repositoryPull = vi.fn();
export const repositoryPush = vi.fn();
export const repositoryListRemotes = vi.fn();
export const repositoryGetOperationState = vi.fn();
export const repositoryMergeBranch = vi.fn();
export const repositoryContinueOperation = vi.fn();
export const repositoryAbortOperation = vi.fn();

export const githubBeginLogin = vi.fn();
export const githubPollLogin = vi.fn();
export const githubListAccounts = vi.fn();
export const githubDisconnectAccount = vi.fn();
export const githubListRepos = vi.fn();
