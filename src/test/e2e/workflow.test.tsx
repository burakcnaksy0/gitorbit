import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "../../App";
import * as tauriCommands from "../../lib/tauriCommands";
import {
  mockAppInfo,
  mockEnvironment,
  mockRepository,
  mockSettings,
  mockStatus,
} from "../fixtures";
import type {
  BranchInfo,
  CommitResult,
  DiffOutput,
  GitHubAccount,
  GitIdentity,
} from "../../types/ipc";

vi.mock("../../lib/tauriCommands", () => import("../mockTauriCommands"));

const mockIdentity: GitIdentity = {
  name: "Developer",
  email: "dev@gybe.dev",
};

const mockBranches: BranchInfo[] = [
  {
    name: "main",
    is_current: true,
    is_remote: false,
    upstream: "origin/main",
    last_commit_hash: "a1b2c3d",
    last_commit_message: "feat: core domain",
  },
  {
    name: "feature/auth",
    is_current: false,
    is_remote: false,
    upstream: null,
    last_commit_hash: "f4e5d6c",
    last_commit_message: "feat: add oauth",
  },
];

const mockHistory = {
  commits: [
    {
      sha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      short_sha: "a1b2c3d",
      message: "feat: core domain",
      author_name: "Developer",
      author_email: "dev@gybe.dev",
      authored_at: "2026-11-01T12:00:00Z",
      parents: [],
      refs: [],
    },
  ],
  graph: [],
  has_more: false,
  next_offset: 1,
};

const mockDiff: DiffOutput = {
  path: "src/main.rs",
  truncated: false,
  binary: false,
  lines: [{ kind: "context", content: "fn main() {", old_line_no: 1, new_line_no: 1 }],
  raw_size: 50,
};

const mockAccounts: GitHubAccount[] = [
  {
    id: "acc-uuid-1",
    provider: "github",
    provider_user_id: "123456",
    login: "orbituser",
    display_name: "Orbit Developer",
    avatar_url: null,
    credential_ref: "cred-uuid-1",
    connection_status: "connected",
    created_at: "2026-11-01T10:00:00Z",
    last_used_at: "2026-11-02T10:00:00Z",
  },
];

describe("Gybe — End-to-End User Journey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tauriCommands.appGetEnvironment).mockResolvedValue(mockEnvironment);
    vi.mocked(tauriCommands.appGetInfo).mockResolvedValue(mockAppInfo);
    vi.mocked(tauriCommands.settingsGet).mockResolvedValue(mockSettings);
    vi.mocked(tauriCommands.repositoryList).mockResolvedValue([mockRepository]);
    vi.mocked(tauriCommands.repositoryGetStatus).mockResolvedValue(mockStatus);
    vi.mocked(tauriCommands.repositoryGetIdentity).mockResolvedValue(mockIdentity);
    vi.mocked(tauriCommands.repositoryGetBranches).mockResolvedValue(mockBranches);
    vi.mocked(tauriCommands.repositoryGetHistory).mockResolvedValue(mockHistory);
    vi.mocked(tauriCommands.repositoryGetDiff).mockResolvedValue(mockDiff);
    vi.mocked(tauriCommands.repositoryGetCommitDetails).mockResolvedValue({
      commit: mockHistory.commits[0],
      files: [
        {
          path: "src/main.rs",
          old_path: null,
          status: "modified",
          staged: false,
        },
      ],
      additions: 10,
      deletions: 2,
    });
    vi.mocked(tauriCommands.repositoryGetCommitDiff).mockResolvedValue(mockDiff);
    vi.mocked(tauriCommands.repositoryGetStatusHash).mockResolvedValue("hash-1");
    vi.mocked(tauriCommands.repositoryListRemotes).mockResolvedValue([
      {
        name: "origin",
        fetch_url: "https://github.com/org/repo.git",
        push_url: "https://github.com/org/repo.git",
      },
    ]);
    vi.mocked(tauriCommands.repositoryGetOperationState).mockResolvedValue("normal");
    vi.mocked(tauriCommands.repositoryFetch).mockResolvedValue(mockStatus);
    vi.mocked(tauriCommands.githubListAccounts).mockResolvedValue(mockAccounts);
  });

  it("completes the daily workflow: explore → commit → history → branches → github → sync", async () => {
    render(<App />);
    const nav = screen.getByRole("navigation");

    expect(screen.getAllByText("Gybe")[0]).toBeInTheDocument();
    expect(screen.getByText("Gybe'e Hoş Geldiniz")).toBeInTheDocument();

    // Repositories view
    fireEvent.click(within(nav).getByRole("button", { name: /Depolar/i }));
    expect(screen.getByRole("heading", { name: "Depolar" })).toBeInTheDocument();
    // The repository list is loaded asynchronously by the shell on mount.
    await waitFor(() => {
      expect(screen.getByText("/home/dev/project")).toBeInTheDocument();
    });

    // Changes view
    fireEvent.click(within(nav).getByRole("button", { name: /Değişiklikler/i }));
    await waitFor(() => {
      expect(screen.getByText(/Tümünü Stage Et/i)).toBeInTheDocument();
    });

    const commitInput = screen.getByPlaceholderText(/Commit mesajı yazın/i);
    fireEvent.change(commitInput, { target: { value: "feat: e2e verified commit" } });
    expect(commitInput).toHaveValue("feat: e2e verified commit");

    const commitRes: CommitResult = {
      commit_sha: "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
      status: { ...mockStatus, staged_files: [] },
    };
    vi.mocked(tauriCommands.repositoryCommit).mockResolvedValue(commitRes);

    const commitBtn = screen.getByRole("button", { name: /Commit \(/i });
    expect(commitBtn).not.toBeDisabled();
    fireEvent.click(commitBtn);

    await waitFor(() => {
      expect(tauriCommands.repositoryCommit).toHaveBeenCalledWith(
        "repo-1",
        "feat: e2e verified commit",
        false
      );
    });

    // History
    fireEvent.click(within(nav).getByRole("button", { name: /Geçmiş/i }));
    await waitFor(() => {
      expect(screen.getByText("Commit Geçmişi")).toBeInTheDocument();
      expect(screen.getAllByText("feat: core domain").length).toBeGreaterThan(0);
    });

    // Branches
    fireEvent.click(within(nav).getByRole("button", { name: /Dallar/i }));
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /Dallar \(Branches\)/i })
      ).toBeInTheDocument();
      expect(screen.getByText("feature/auth")).toBeInTheDocument();
    });

    // GitHub
    fireEvent.click(within(nav).getByRole("button", { name: /GitHub/i }));
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /GitHub Hesapları/i })
      ).toBeInTheDocument();
      expect(screen.getByText("Orbit Developer")).toBeInTheDocument();
      expect(screen.getByText("@orbituser")).toBeInTheDocument();
      expect(screen.getByText("Bağlı")).toBeInTheDocument();
    });

    // Sync
    const syncBtn = screen.getByTitle(/Remote durumunu yenile/i);
    fireEvent.click(syncBtn);
    await waitFor(() => {
      expect(tauriCommands.repositoryFetch).toHaveBeenCalledWith("repo-1");
    });
  });

  it("surfaces backend failures from the sync action instead of fake success", async () => {
    vi.mocked(tauriCommands.repositoryFetch).mockRejectedValue({
      code: "REMOTE_REJECTED",
      message: "Uzak depo güncellemeyi reddetti.",
      recoverable: true,
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Git 2.43.0")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle(/Remote durumunu yenile/i));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "İşlem Başarısız" })
      ).toBeInTheDocument();
      expect(screen.getByText(/REMOTE_REJECTED/)).toBeInTheDocument();
    });
  });
});
