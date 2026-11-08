import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BranchesView } from "./BranchesView";
import * as tauriCommands from "../../lib/tauriCommands";
import type { BranchInfo, GitStatus } from "../../types/ipc";

vi.mock("../../lib/tauriCommands", () => ({
  repositoryGetBranches: vi.fn(),
  repositoryGetStatus: vi.fn(),
  repositoryCreateBranch: vi.fn(),
  repositoryCheckoutBranch: vi.fn(),
  repositoryDeleteBranch: vi.fn(),
  repositoryMergeBranch: vi.fn(),
  repositoryContinueOperation: vi.fn(),
  repositoryAbortOperation: vi.fn(),
}));

const mockBranches: BranchInfo[] = [
  {
    name: "main",
    is_current: true,
    is_remote: false,
    upstream: "origin/main",
    last_commit_hash: "a1b2c3d",
    last_commit_message: "chore: init",
  },
  {
    name: "feature/login",
    is_current: false,
    is_remote: false,
    upstream: null,
    last_commit_hash: "e4f5a6b",
    last_commit_message: "feat: add login",
  },
  {
    name: "origin/main",
    is_current: false,
    is_remote: true,
    upstream: null,
    last_commit_hash: "a1b2c3d",
    last_commit_message: "chore: init",
  },
];

const mockStatus: GitStatus = {
  repository_path: "/test/repo",
  branch: "main",
  is_detached_head: false,
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  staged_files: [],
  unstaged_files: [],
  untracked_files: [],
  conflicted_files: [],
  operation_state: "normal",
};

describe("BranchesView (Faz 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tauriCommands.repositoryGetBranches).mockResolvedValue(mockBranches);
    vi.mocked(tauriCommands.repositoryGetStatus).mockResolvedValue(mockStatus);
  });

  it("geç dönen eski depo yanıtı yeni listeyi ezmez (CB-04 regresyon)", async () => {
    const trunkOnly: BranchInfo[] = [
      {
        name: "trunk",
        is_current: true,
        is_remote: false,
        upstream: null,
        last_commit_hash: "9999abc",
        last_commit_message: "only in repo-2",
      },
    ];
    let resolveSlow!: (v: BranchInfo[]) => void;
    const slow = new Promise<BranchInfo[]>((r) => {
      resolveSlow = r;
    });
    vi.mocked(tauriCommands.repositoryGetBranches).mockImplementation((repoId) =>
      repoId === "repo-1" ? slow : Promise.resolve(trunkOnly)
    );

    const { rerender } = render(<BranchesView repoId="repo-1" />);
    // Ertelenmiş (setTimeout 0) yüklemenin başlamasını bekle — repo-1 isteği
    // gerçekten uçakta olmalı ki bayat yanıt sınaması anlamlı olsun.
    await new Promise((r) => setTimeout(r, 5));
    rerender(<BranchesView repoId="repo-2" />); // hızlı geçiş

    // repo-2 (hızlı) önce çözülür ve listeyi kurar
    await waitFor(() => expect(screen.getByText("trunk")).toBeInTheDocument());

    // repo-1'in BAYAT yanıtı sonra döner — listeyi bozmamalı
    resolveSlow(mockBranches);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("feature/login")).not.toBeInTheDocument();
    expect(screen.getByText("trunk")).toBeInTheDocument();
  });

  it("renders branch list separating local and remote branches", async () => {
    render(<BranchesView repoId="repo-123" />);

    await waitFor(() => {
      expect(screen.getByText("main")).toBeInTheDocument();
      expect(screen.getByText("feature/login")).toBeInTheDocument();
      expect(screen.getByText("origin/main")).toBeInTheDocument();
    });

    expect(screen.getByText("Mevcut Dal")).toBeInTheDocument();
    // Checkout is offered for every non-current branch, including remote ones
    // (git checkout DWIM creates a local tracking branch automatically).
    expect(screen.getAllByRole("button", { name: "Checkout" })).toHaveLength(2);

    // Filter local
    fireEvent.click(screen.getByRole("button", { name: /Yerel \(/i }));
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.queryByText("origin/main")).not.toBeInTheDocument();

    // Filter remote
    fireEvent.click(screen.getByRole("button", { name: /Uzak \(/i }));
    expect(screen.queryByText("feature/login")).not.toBeInTheDocument();
    expect(screen.getByText("origin/main")).toBeInTheDocument();
  });

  it("displays detached HEAD banner when in detached HEAD state (AC-6)", async () => {
    vi.mocked(tauriCommands.repositoryGetStatus).mockResolvedValue({
      ...mockStatus,
      is_detached_head: true,
      branch: "HEAD (1234567)",
    });

    render(<BranchesView repoId="repo-123" />);

    await waitFor(() => {
      expect(screen.getByText("Detached HEAD Durumu Algılandı")).toBeInTheDocument();
    });
  });

  it("creates a new branch with validation and checkout option (AC-7)", async () => {
    const newBranch: BranchInfo = {
      name: "feature/new",
      is_current: true,
      is_remote: false,
      upstream: null,
      last_commit_hash: "1234567",
      last_commit_message: "new",
    };
    vi.mocked(tauriCommands.repositoryCreateBranch).mockResolvedValue(newBranch);

    render(<BranchesView repoId="repo-123" />);

    await waitFor(() => expect(screen.getByText("main")).toBeInTheDocument());

    // Open create branch modal
    fireEvent.click(screen.getByRole("button", { name: /Yeni Dal Oluştur/i }));
    expect(screen.getByLabelText("Dal Adı")).toBeInTheDocument();

    // Try submitting empty
    const input = screen.getByLabelText("Dal Adı");
    fireEvent.change(input, { target: { value: "feature/new" } });

    // Submit
    fireEvent.click(screen.getByRole("button", { name: "Oluştur" }));

    await waitFor(() => {
      expect(tauriCommands.repositoryCreateBranch).toHaveBeenCalledWith(
        "repo-123",
        "feature/new",
        null,
        true
      );
    });
  });

  it("handles dirty worktree checkout conflict safely (AC-2)", async () => {
    vi.mocked(tauriCommands.repositoryCheckoutBranch).mockRejectedValue({
      code: "DIRTY_WORKTREE",
      message: "Yerel değişiklikleriniz çakışıyor.",
      recoverable: true,
    });

    render(<BranchesView repoId="repo-123" />);

    await waitFor(() => expect(screen.getByText("feature/login")).toBeInTheDocument());

    const checkoutBtn = screen.getAllByRole("button", { name: "Checkout" })[0];
    fireEvent.click(checkoutBtn);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", {
          name: /Checkout Engellendi \(Veri Kaybı Koruması\)/i,
        })
      ).toBeInTheDocument();
      expect(screen.getByText("Yerel değişiklikleriniz çakışıyor.")).toBeInTheDocument();
    });
  });

  it("allows safe branch deletion with force toggle (AC-3, AC-8)", async () => {
    vi.mocked(tauriCommands.repositoryDeleteBranch).mockResolvedValue(true);

    render(<BranchesView repoId="repo-123" />);

    await waitFor(() => expect(screen.getByText("feature/login")).toBeInTheDocument());

    // Active branch 'main' must NOT have a delete button
    expect(screen.queryByLabelText("Branch Sil: main")).not.toBeInTheDocument();

    // Non-active branch 'feature/login' has delete button
    const deleteBtn = screen.getByLabelText("Branch Sil: feature/login");
    fireEvent.click(deleteBtn);

    // Modal opens
    expect(screen.getByRole("heading", { name: "Dalı Sil" })).toBeInTheDocument();

    // Toggle force delete
    const forceCheckbox = screen.getByLabelText(/zorla sil \(-D\)/i);
    fireEvent.click(forceCheckbox);

    // Confirm delete
    const confirmDeleteBtn = screen.getByRole("button", { name: "Dalı Sil" });
    fireEvent.click(confirmDeleteBtn);

    await waitFor(() => {
      expect(tauriCommands.repositoryDeleteBranch).toHaveBeenCalledWith(
        "repo-123",
        "feature/login",
        true
      );
    });
  });
});
