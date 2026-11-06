import type {
  AppInfo,
  AppSettings,
  GitEnvironment,
  GitStatus,
  RepositoryRecord,
} from "../types/ipc";

export const mockEnvironment: GitEnvironment = {
  installed: true,
  version: "2.43.0",
  executable_path: "/usr/bin/git",
  minimum_version: "2.23.0",
  meets_minimum: true,
};

export const mockAppInfo: AppInfo = {
  name: "GitOrbit",
  version: "0.1.0",
  os: "linux",
  arch: "x86_64",
};

export const mockSettings: AppSettings = {
  theme: "dark",
  default_clone_dir: null,
  diff_context_lines: 3,
  log_level: "info",
  confirm_destructive: true,
  active_github_account_id: null,
};

export const mockRepository: RepositoryRecord = {
  id: "repo-1",
  canonical_path: "/home/dev/project",
  display_name: "project",
  current_branch: "main",
  last_opened_at: "2026-11-01T12:00:00Z",
  created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-01T12:00:00Z",
  missing: false,
};

export const mockStatus: GitStatus = {
  repository_path: "/home/dev/project",
  branch: "main",
  is_detached_head: false,
  upstream: "origin/main",
  ahead: 1,
  behind: 0,
  staged_files: [
    { path: "src/main.rs", status: "modified", old_path: null, staged: true },
  ],
  unstaged_files: [
    { path: "README.md", status: "modified", old_path: null, staged: false },
  ],
  untracked_files: [],
  conflicted_files: [],
  operation_state: "normal",
};
