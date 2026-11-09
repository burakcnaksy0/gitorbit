import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { StatusBar } from "./StatusBar";
import { MockRepository } from "../../types/navigation";

describe("StatusBar component (Faz 5 Remote & Operation State)", () => {
  const baseRepo: MockRepository = {
    id: "repo_123",
    name: "Gybe",
    path: "/home/user/Gybe",
    currentBranch: "main",
    ahead: 2,
    behind: 1,
    stagedCount: 3,
    unstagedCount: 4,
    lastCommitMessage: "feat: remote",
    lastCommitDate: "2026-11-02",
    operationState: "normal",
    conflictedCount: 0,
  };

  it("renders active branch and staged/modified counts", () => {
    const handleSync = vi.fn();
    render(<StatusBar currentRepo={baseRepo} onSyncClick={handleSync} />);

    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText(/3 staged/i)).toBeInTheDocument();
    expect(screen.getByText(/4 modified/i)).toBeInTheDocument();
  });

  it("triggers onSyncClick when sync button is clicked", () => {
    const handleSync = vi.fn();
    render(<StatusBar currentRepo={baseRepo} onSyncClick={handleSync} />);

    const syncBtn = screen.getByTitle(/Remote durumunu yenile/i);
    fireEvent.click(syncBtn);
    expect(handleSync).toHaveBeenCalledTimes(1);
  });

  it("shows syncing state when isSyncing is true", () => {
    render(<StatusBar currentRepo={baseRepo} onSyncClick={vi.fn()} isSyncing={true} />);

    expect(screen.getByText("Senkronize Ediliyor...")).toBeInTheDocument();
  });

  it("displays merge in progress badge and conflict count", () => {
    const conflictedRepo: MockRepository = {
      ...baseRepo,
      operationState: "merge_in_progress",
      conflictedCount: 2,
    };

    render(<StatusBar currentRepo={conflictedRepo} onSyncClick={vi.fn()} />);

    expect(screen.getByText("Merge Devam Ediyor")).toBeInTheDocument();
    expect(screen.getByText(/2 çakışma/i)).toBeInTheDocument();
  });

  it("displays rebase in progress badge", () => {
    const rebaseRepo: MockRepository = {
      ...baseRepo,
      operationState: "rebase_in_progress",
    };

    render(<StatusBar currentRepo={rebaseRepo} onSyncClick={vi.fn()} />);

    expect(screen.getByText("Rebase Devam Ediyor")).toBeInTheDocument();
  });

  it("shows pull/push actions with ahead/behind counts and triggers handlers", () => {
    const onPull = vi.fn();
    const onPush = vi.fn();
    const repo: MockRepository = { ...baseRepo, upstream: "origin/main" };

    render(
      <StatusBar
        currentRepo={repo}
        onSyncClick={vi.fn()}
        onPullClick={onPull}
        onPushClick={onPush}
      />
    );

    const pullBtn = screen.getByRole("button", { name: /İçe Aktar/i });
    const pushBtn = screen.getByRole("button", { name: /Dışa Aktar/i });
    expect(pullBtn).toBeEnabled();
    expect(pushBtn).toBeEnabled();
    expect(pullBtn).toHaveTextContent("↓1");
    expect(pushBtn).toHaveTextContent("↑2");

    fireEvent.click(pullBtn);
    fireEvent.click(pushBtn);
    expect(onPull).toHaveBeenCalledTimes(1);
    expect(onPush).toHaveBeenCalledTimes(1);
  });

  it("disables push with nothing to push and pull without upstream", () => {
    const repo: MockRepository = { ...baseRepo, ahead: 0, upstream: "origin/main" };

    render(
      <StatusBar
        currentRepo={repo}
        onSyncClick={vi.fn()}
        onPullClick={vi.fn()}
        onPushClick={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /Dışa Aktar/i })).toBeDisabled();
  });

  it("enables push for a brand-new branch without upstream (publish)", () => {
    const repo: MockRepository = { ...baseRepo, ahead: 0, upstream: undefined };

    render(
      <StatusBar
        currentRepo={repo}
        onSyncClick={vi.fn()}
        onPullClick={vi.fn()}
        onPushClick={vi.fn()}
      />
    );

    const pushBtn = screen.getByRole("button", { name: /Dışa Aktar/i });
    expect(pushBtn).toBeEnabled();
    expect(pushBtn).toHaveAttribute(
      "title",
      expect.stringMatching(/uzak depoda yayınlayın/i)
    );
  });
});
