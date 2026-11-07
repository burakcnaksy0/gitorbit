import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HistoryView } from "./HistoryView";
import * as tauriCommands from "../../lib/tauriCommands";
import type { HistoryOutput } from "../../types/ipc";

vi.mock("../../lib/tauriCommands", () => ({
  repositoryGetHistory: vi.fn(),
  repositoryGetCommitDetails: vi.fn(),
  repositoryGetCommitDiff: vi.fn(),
}));

const mockHistory: HistoryOutput = {
  commits: [
    {
      sha: "c1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0",
      short_sha: "c1a2b3c",
      message:
        "feat: add user authentication\n\nImplemented JWT verification middleware.",
      author_name: "Developer One",
      author_email: "dev@gitorbit.dev",
      authored_at: "2026-10-29T10:00:00Z",
      parents: ["b0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9"],
    refs: [],
    },
    {
      sha: "b0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9",
      short_sha: "b0a1b2c",
      message: "chore: initial commit",
      author_name: "Maintainer",
      author_email: "admin@gitorbit.dev",
      authored_at: "2026-10-28T09:00:00Z",
      parents: [],
    refs: [],
    },
  ],
  graph: [],
  has_more: true,
  next_offset: 2,
};

describe("HistoryView (Faz 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tauriCommands.repositoryGetHistory).mockResolvedValue(mockHistory);
  });

  it("renders commit history list and details pane (AC-1)", async () => {
    render(<HistoryView repoId="repo-123" />);

    await waitFor(() => {
      expect(screen.getAllByText("feat: add user authentication").length).toBeGreaterThan(
        0
      );
      expect(screen.getAllByText("chore: initial commit").length).toBeGreaterThan(0);
    });

    // Details pane defaults to first commit
    expect(
      screen.getByText("Implemented JWT verification middleware.")
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Developer One/).length).toBeGreaterThan(0);
    expect(screen.getByText(/dev@gitorbit.dev/)).toBeInTheDocument();
    expect(
      screen.getByText("Tam Commit SHA: c1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0")
    ).toBeInTheDocument();
  });

  it("switches commit details on click", async () => {
    render(<HistoryView repoId="repo-123" />);

    await waitFor(() => {
      expect(screen.getAllByText("chore: initial commit").length).toBeGreaterThan(0);
    });

    // Click second commit in list
    const commitItems = screen.getAllByText("chore: initial commit");
    fireEvent.click(commitItems[0]);

    expect(screen.getAllByText(/Maintainer/).length).toBeGreaterThan(0);
    expect(screen.getByText(/admin@gitorbit.dev/)).toBeInTheDocument();
  });

  it("handles empty repository gracefully without crashing (AC-9)", async () => {
    vi.mocked(tauriCommands.repositoryGetHistory).mockResolvedValue({
      commits: [],
      graph: [],
      has_more: false,
      next_offset: 0,
    });

    render(<HistoryView repoId="repo-123" />);

    await waitFor(() => {
      expect(screen.getByText("Bu depoda henüz commit bulunmuyor.")).toBeInTheDocument();
    });
  });

  it("loads more commits on pagination button click", async () => {
    render(<HistoryView repoId="repo-123" />);

    await waitFor(() => {
      expect(screen.getByText("Daha Fazla Commit Yükle")).toBeInTheDocument();
    });

    const moreCommits: HistoryOutput = {
      commits: [
        {
          sha: "a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0",
          short_sha: "a9b8c7d",
          message: "docs: update readme",
          author_name: "Writer",
          author_email: "writer@gitorbit.dev",
          authored_at: "2026-10-27T08:00:00Z",
          parents: [],
        refs: [],
        },
      ],
      graph: [],
      has_more: false,
      next_offset: 3,
    };
    vi.mocked(tauriCommands.repositoryGetHistory).mockResolvedValue(moreCommits);

    fireEvent.click(screen.getByText("Daha Fazla Commit Yükle"));

    await waitFor(() => {
      expect(tauriCommands.repositoryGetHistory).toHaveBeenCalledWith(
        "repo-123",
        null,
        30,
        2
      );
    });
  });
});
