import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChangesView } from "./ChangesView";
import * as tauriCommands from "../../lib/tauriCommands";
import type { GitStatus, CommitResult, GitIdentity } from "../../types/ipc";

vi.mock("../../lib/tauriCommands", () => ({
  repositoryGetStatus: vi.fn(),
  repositoryGetDiff: vi.fn(),
  repositoryStageFiles: vi.fn(),
  repositoryUnstageFiles: vi.fn(),
  repositoryDiscardChanges: vi.fn(),
  repositoryGetStatusHash: vi.fn(),
  repositoryCommit: vi.fn(),
  repositoryGetIdentity: vi.fn(),
  repositorySetIdentity: vi.fn(),
}));

const mockStatusWithStaged: GitStatus = {
  repository_path: "/test/repo",
  branch: "main",
  is_detached_head: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  staged_files: [
    {
      path: "src/main.ts",
      old_path: null,
      status: "modified",
      staged: true,
    },
  ],
  unstaged_files: [],
  untracked_files: [],
  conflicted_files: [],
  operation_state: "normal",
};

describe("ChangesView Commit & Identity Guard (Faz 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tauriCommands.repositoryGetStatus).mockResolvedValue(mockStatusWithStaged);
    vi.mocked(tauriCommands.repositoryGetDiff).mockResolvedValue({
      path: "src/main.ts",
      truncated: false,
      binary: false,
      lines: [],
      raw_size: 10,
    });
  });

  it("disables commit button when there are no staged files (AC-4)", async () => {
    vi.mocked(tauriCommands.repositoryGetStatus).mockResolvedValue({
      ...mockStatusWithStaged,
      staged_files: [],
    });

    render(<ChangesView repoId="repo-123" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Commit \(0\)/i })).toBeDisabled();
    });

    const textarea = screen.getByPlaceholderText(/Commit mesajı yazın/i);
    fireEvent.change(textarea, { target: { value: "feat: nothing staged" } });
    expect(screen.getByRole("button", { name: /Commit \(0\)/i })).toBeDisabled();
  });

  it("disables commit button when commit message is empty (AC-4)", async () => {
    render(<ChangesView repoId="repo-123" />);

    await waitFor(() => {
      // File path appears both in the file row and the auto-opened diff header.
      expect(screen.getAllByText("src/main.ts")[0]).toBeInTheDocument();
    });

    const commitBtn = screen.getByRole("button", { name: /Commit \(1\)/i });
    expect(commitBtn).toBeDisabled();

    // Type a message
    const textarea = screen.getByPlaceholderText(/Commit mesajı yazın/i);
    fireEvent.change(textarea, { target: { value: "feat: add main function" } });

    expect(commitBtn).not.toBeDisabled();
  });

  it("successfully creates a commit and shows new SHA (AC-1)", async () => {
    const commitResult: CommitResult = {
      commit_sha: "9876543210abcdef9876543210abcdef98765432",
      status: {
        ...mockStatusWithStaged,
        staged_files: [],
      },
    };
    vi.mocked(tauriCommands.repositoryCommit).mockResolvedValue(commitResult);

    render(<ChangesView repoId="repo-123" />);

    await waitFor(() => {
      // File path appears both in the file row and the auto-opened diff header.
      expect(screen.getAllByText("src/main.ts")[0]).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/Commit mesajı yazın/i);
    fireEvent.change(textarea, { target: { value: "feat: add main function" } });

    const commitBtn = screen.getByRole("button", { name: /Commit \(1\)/i });
    fireEvent.click(commitBtn);

    await waitFor(() => {
      expect(tauriCommands.repositoryCommit).toHaveBeenCalledWith(
        "repo-123",
        "feat: add main function",
        false
      );
      expect(screen.getByText(/Commit: 9876543/)).toBeInTheDocument();
      expect(textarea).toHaveValue("");
    });
  });

  it("triggers Git Identity Guard modal when identity is missing (AC-5)", async () => {
    vi.mocked(tauriCommands.repositoryCommit).mockRejectedValue({
      code: "IDENTITY_MISSING",
      message: "Git kimliği eksik.",
      recoverable: true,
    });
    const emptyId: GitIdentity = { name: null, email: null };
    vi.mocked(tauriCommands.repositoryGetIdentity).mockResolvedValue(emptyId);
    vi.mocked(tauriCommands.repositorySetIdentity).mockResolvedValue({
      name: "Alice Engineer",
      email: "alice@company.com",
    });

    render(<ChangesView repoId="repo-123" />);

    await waitFor(() => {
      // File path appears both in the file row and the auto-opened diff header.
      expect(screen.getAllByText("src/main.ts")[0]).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/Commit mesajı yazın/i);
    fireEvent.change(textarea, { target: { value: "feat: test missing identity" } });

    const commitBtn = screen.getByRole("button", { name: /Commit \(1\)/i });
    fireEvent.click(commitBtn);

    // Identity modal should pop up
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /Git Kimliği Gerekli \(Identity Guard\)/i })
      ).toBeInTheDocument();
    });

    // Enter name & email
    const nameInput = screen.getByLabelText(/Ad Soyad/i);
    const emailInput = screen.getByLabelText(/E-posta/i);
    fireEvent.change(nameInput, { target: { value: "Alice Engineer" } });
    fireEvent.change(emailInput, { target: { value: "alice@company.com" } });

    // Submit identity
    const saveBtn = screen.getByRole("button", { name: "Kimliği Kaydet" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(tauriCommands.repositorySetIdentity).toHaveBeenCalledWith(
        "repo-123",
        "Alice Engineer",
        "alice@company.com"
      );
    });
  });
});
