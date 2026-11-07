/**
 * v0.2 madde 3 — HistoryView "Mesajı düzenle" görünürlük kuralı ve amend akışı.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HistoryView } from "./HistoryView";
import * as tauriCommands from "../../lib/tauriCommands";
import type { CommitInfo, CommitDetails, HistoryOutput } from "../../types/ipc";
import type { RepositorySummary } from "../../types/navigation";

vi.mock("../../lib/tauriCommands", () => ({
  repositoryGetHistory: vi.fn(),
  repositoryGetCommitDetails: vi.fn(),
  repositoryGetCommitDiff: vi.fn(),
  repositoryAmendMessage: vi.fn(),
}));

const headCommit: CommitInfo = {
  sha: "a".repeat(40),
  short_sha: "aaaaaaa",
  message: "eski başlık\n\ngövde satırı",
  author_name: "Burak",
  author_email: "b@example.com",
  authored_at: "2026-11-07T10:00:00Z",
  parents: ["b".repeat(40)],
};

const olderCommit: CommitInfo = {
  ...headCommit,
  sha: "b".repeat(40),
  short_sha: "bbbbbbb",
  message: "init",
  parents: [],
};

function repoSummary(overrides: Partial<RepositorySummary> = {}): RepositorySummary {
  return {
    id: "repo-1",
    name: "demo",
    path: "/repos/demo",
    currentBranch: "main",
    ahead: 0,
    behind: 0,
    stagedCount: 0,
    unstagedCount: 0,
    lastCommitMessage: "eski başlık",
    lastCommitDate: "2026-11-07T10:00:00Z",
    upstream: "origin/main",
    operationState: "normal",
    conflictedCount: 0,
    missing: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  const history: HistoryOutput = {
    commits: [headCommit, olderCommit],
    has_more: false,
    next_offset: 2,
  };
  vi.mocked(tauriCommands.repositoryGetHistory).mockResolvedValue(history);
  vi.mocked(tauriCommands.repositoryGetCommitDetails).mockResolvedValue({
    commit: headCommit,
    files: [],
    additions: 0,
    deletions: 0,
  } as CommitDetails);
  vi.mocked(tauriCommands.repositoryGetCommitDiff).mockResolvedValue({
    path: "",
    truncated: false,
    binary: false,
    lines: [],
    raw_size: 0,
  });
});

describe("HistoryView amend (v0.2)", () => {
  it("ahead > 0 ve HEAD seçiliyken 'Mesajı düzenle' butonu görünür", async () => {
    render(
      <HistoryView repoId="repo-1" currentRepo={repoSummary({ ahead: 2 })} />
    );
    expect(
      await screen.findByRole("button", { name: "Commit mesajını düzenle" })
    ).toBeInTheDocument();
  });

  it("ahead = 0 iken (commit push edilmiş) buton GÖRÜNMEZ", async () => {
    render(
      <HistoryView repoId="repo-1" currentRepo={repoSummary({ ahead: 0 })} />
    );
    // Detay paneli render olsun (başlık listede + detayda iki yerde).
    await screen.findAllByText("eski başlık");
    expect(
      screen.queryByRole("button", { name: "Commit mesajını düzenle" })
    ).not.toBeInTheDocument();
  });

  it("buton mesaj formunu açar, kaydet amend komutunu çağırır", async () => {
    vi.mocked(tauriCommands.repositoryAmendMessage).mockResolvedValue({
      commit_sha: "c".repeat(40),
      status: {
        repository_path: "/repos/demo",
        branch: "main",
        is_detached_head: false,
        upstream: "origin/main",
        ahead: 2,
        behind: 0,
        staged_files: [],
        unstaged_files: [],
        untracked_files: [],
        conflicted_files: [],
        operation_state: "normal",
      },
    });

    render(
      <HistoryView repoId="repo-1" currentRepo={repoSummary({ ahead: 1 })} />
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Commit mesajını düzenle" })
    );

    const textarea = screen.getByLabelText("Yeni commit mesajı");
    fireEvent.change(textarea, { target: { value: "düzgün başlık" } });
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));

    await waitFor(() =>
      expect(tauriCommands.repositoryAmendMessage).toHaveBeenCalledWith(
        "repo-1",
        "düzgün başlık"
      )
    );
  });

  it("boş mesaj kaydedilemez (buton pasif, hata metni yok — yalnız guard)", async () => {
    render(
      <HistoryView repoId="repo-1" currentRepo={repoSummary({ ahead: 1 })} />
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Commit mesajını düzenle" })
    );
    fireEvent.change(screen.getByLabelText("Yeni commit mesajı"), {
      target: { value: "   " },
    });
    expect(screen.getByRole("button", { name: "Kaydet" })).toBeDisabled();
    expect(tauriCommands.repositoryAmendMessage).not.toHaveBeenCalled();
  });
});
