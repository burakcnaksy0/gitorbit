/**
 * v0.2 konfor paketi — ChangesView ignore + stash arayüz testleri.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChangesView } from "./ChangesView";
import * as tauriCommands from "../../lib/tauriCommands";
import type { GitStatus, StashEntry } from "../../types/ipc";

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
  repositoryIgnoreFile: vi.fn(),
  repositoryStashPush: vi.fn(),
  repositoryStashList: vi.fn(),
  repositoryStashApply: vi.fn(),
  repositoryStashPop: vi.fn(),
  repositoryStashDrop: vi.fn(),
}));

const baseStatus: GitStatus = {
  repository_path: "/test/repo",
  branch: "main",
  is_detached_head: false,
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  staged_files: [],
  unstaged_files: [
    { path: "src/app.ts", old_path: null, status: "modified", staged: false },
  ],
  untracked_files: [
    { path: "debug.log", old_path: null, status: "untracked", staged: false },
  ],
  conflicted_files: [],
  operation_state: "normal",
};

const cleanStatus: GitStatus = {
  ...baseStatus,
  staged_files: [],
  unstaged_files: [],
  untracked_files: [],
};

const sampleStash: StashEntry = {
  index: "0",
  message: "main: wip başlığı",
  date: "2026-11-07 10:00:00 +0300",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tauriCommands.repositoryGetStatus).mockResolvedValue(baseStatus);
  vi.mocked(tauriCommands.repositoryGetDiff).mockResolvedValue({
    path: "",
    truncated: false,
    binary: false,
    lines: [],
    raw_size: 0,
  });
  vi.mocked(tauriCommands.repositoryStashList).mockResolvedValue([]);
});

describe("ChangesView ignore akışı (v0.2)", () => {
  it("untracked satırındaki yoksay butonu kapsam modalını açar ve .gitignore'a yazar", async () => {
    render(<ChangesView repoId="repo-1" />);
    fireEvent.click(await screen.findByLabelText("debug.log dosyasını yoksay"));

    fireEvent.click(await screen.findByText(/\.gitignore \(projeyle paylaşılır\)/));

    await waitFor(() =>
      expect(tauriCommands.repositoryIgnoreFile).toHaveBeenCalledWith(
        "repo-1",
        "debug.log",
        "repo"
      )
    );
  });

  it("yerel kapsam .git/info/exclude'a yönlendirir", async () => {
    render(<ChangesView repoId="repo-1" />);
    fireEvent.click(await screen.findByLabelText("debug.log dosyasını yoksay"));
    fireEvent.click(await screen.findByText(/Sadece bu makine/));

    await waitFor(() =>
      expect(tauriCommands.repositoryIgnoreFile).toHaveBeenCalledWith(
        "repo-1",
        "debug.log",
        "local"
      )
    );
  });

  it("tracked dosyalarda yoksay butonu yoktur", async () => {
    render(<ChangesView repoId="repo-1" />);
    // Satır render oldu (stage butonu göründü) — ama ignore butonu yok.
    await screen.findByLabelText("src/app.ts stage et");
    expect(
      screen.queryByLabelText("src/app.ts dosyasını yoksay")
    ).not.toBeInTheDocument();
  });
});

describe("ChangesView stash akışı (v0.2)", () => {
  it("Kenara Al modalı stash push'u mesaj ve untracked bayrağıyla çağırır", async () => {
    vi.mocked(tauriCommands.repositoryStashPush).mockResolvedValue(cleanStatus);
    render(<ChangesView repoId="repo-1" />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Değişiklikleri kenara al" })
    );
    fireEvent.change(screen.getByPlaceholderText(/wip: arama filtresi/), {
      target: { value: "wip: filtre" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Kenara Al" }));

    await waitFor(() =>
      expect(tauriCommands.repositoryStashPush).toHaveBeenCalledWith(
        "repo-1",
        "wip: filtre",
        true
      )
    );
  });

  it("Stash paneli listeler; pop ve drop çağrılarını tetikler", async () => {
    vi.mocked(tauriCommands.repositoryStashList).mockResolvedValue([sampleStash]);
    vi.mocked(tauriCommands.repositoryStashPop).mockResolvedValue(baseStatus);
    vi.mocked(tauriCommands.repositoryStashDrop).mockResolvedValue([]);

    render(<ChangesView repoId="repo-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Stash listesini göster/i })
    );

    expect(await screen.findByText(/#0 — main: wip başlığı/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "stash 0 pop" }));
    await waitFor(() =>
      expect(tauriCommands.repositoryStashPop).toHaveBeenCalledWith("repo-1", "0")
    );

    // Panel hâlâ açık ve mock liste aynı — drop onay akışı
    fireEvent.click(await screen.findByRole("button", { name: "stash 0 sil" }));
    fireEvent.click(await screen.findByRole("button", { name: "Kalıcı Olarak Sil" }));
    await waitFor(() =>
      expect(tauriCommands.repositoryStashDrop).toHaveBeenCalledWith("repo-1", "0")
    );
  });

  it("stash drop çift tıklama TEK istek tetikler (CB-01 regresyon)", async () => {
    vi.mocked(tauriCommands.repositoryStashList).mockResolvedValue([sampleStash]);
    let resolveDrop!: (v: never[]) => void;
    const dropPromise = new Promise<never[]>((resolve) => {
      resolveDrop = resolve;
    });
    vi.mocked(tauriCommands.repositoryStashDrop).mockReturnValue(dropPromise);

    render(<ChangesView repoId="repo-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Stash listesini göster/i })
    );
    fireEvent.click(await screen.findByRole("button", { name: "stash 0 sil" }));

    const confirm = await screen.findByRole("button", { name: "Kalıcı Olarak Sil" });
    fireEvent.click(confirm);
    fireEvent.click(confirm); // istek sürerken ikinci tıklama

    await waitFor(() => expect(confirm).toBeDisabled());
    expect(tauriCommands.repositoryStashDrop).toHaveBeenCalledTimes(1);

    resolveDrop([]);
    await waitFor(() => expect(confirm).not.toBeInTheDocument());
  });
});
