/**
 * v0.2 madde 7 — ChangesView çakışma yardımcı bandı testleri.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChangesView } from "./ChangesView";
import * as tauriCommands from "../../lib/tauriCommands";
import type { GitStatus } from "../../types/ipc";

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
  repositoryResolveConflict: vi.fn(),
  repositoryContinueOperation: vi.fn(),
  repositoryAbortOperation: vi.fn(),
}));

function statusWith(overrides: Partial<GitStatus>): GitStatus {
  return {
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
    ...overrides,
  };
}

const mergeConflictStatus = statusWith({
  operation_state: "merge_in_progress",
  conflicted_files: ["src/app.ts", "README.md"],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tauriCommands.repositoryGetStatus).mockResolvedValue(mergeConflictStatus);
  vi.mocked(tauriCommands.repositoryGetDiff).mockResolvedValue({
    path: "",
    truncated: false,
    binary: false,
    lines: [],
    raw_size: 0,
  });
  vi.mocked(tauriCommands.repositoryStashList).mockResolvedValue([]);
});

describe("ChangesView çakışma bandı (v0.2 madde 7)", () => {
  it("çakışmalı durumda bant + dosya başına dört eyleme butonu görünür", async () => {
    render(<ChangesView repoId="repo-1" />);

    const band = await screen.findByRole("alert", { name: "Çakışma paneli" });
    expect(band).toHaveTextContent("2 dosyada çakışma var");

    expect(
      screen.getByRole("button", { name: "src/app.ts için bizim tarafı seç" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "src/app.ts için onların tarafını seç" })
    ).toBeInTheDocument();
    // her çakışmalı dosya için birer buton
    expect(await screen.findAllByText("Çözüldü işaretle")).toHaveLength(2);
    expect(screen.getAllByText("Dosyayı Aç")).toHaveLength(2);
  });

  it("normal durumda bant YOK", async () => {
    vi.mocked(tauriCommands.repositoryGetStatus).mockResolvedValue(statusWith({}));
    render(<ChangesView repoId="repo-1" />);
    await screen.findByText("Çalışma ağacı temiz");
    expect(
      screen.queryByRole("alert", { name: "Çakışma paneli" })
    ).not.toBeInTheDocument();
  });

  it("'← Bizim' resolve komutunu ours tarafıyla çağırır ve durumu yeniler", async () => {
    const resolved = statusWith({
      operation_state: "merge_in_progress",
      conflicted_files: ["README.md"],
    });
    vi.mocked(tauriCommands.repositoryResolveConflict).mockResolvedValue(resolved);

    render(<ChangesView repoId="repo-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "src/app.ts için bizim tarafı seç" })
    );

    await waitFor(() =>
      expect(tauriCommands.repositoryResolveConflict).toHaveBeenCalledWith(
        "repo-1",
        "src/app.ts",
        "ours"
      )
    );
    await waitFor(() =>
      expect(screen.getByRole("alert", { name: "Çakışma paneli" })).toHaveTextContent(
        "1 dosyada çakışma var"
      )
    );
    // ilerleme sayacı: 2 toplamdan 1 çözüldü
    expect(screen.getByText("1/2 çözüldü")).toBeInTheDocument();
  });

  it("çözümler bitince Devam Et / İptal Et görünür; Devam Et continue çağırır", async () => {
    const allResolved = statusWith({
      operation_state: "merge_in_progress",
      conflicted_files: [],
    });
    vi.mocked(tauriCommands.repositoryResolveConflict).mockResolvedValue(allResolved);
    vi.mocked(tauriCommands.repositoryContinueOperation).mockResolvedValue(
      statusWith({})
    );

    render(<ChangesView repoId="repo-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "src/app.ts için onların tarafını seç" })
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "README.md için onların tarafını seç" })
    );

    const devam = await screen.findByRole("button", { name: /Devam Et/ });
    fireEvent.click(devam);

    await waitFor(() =>
      expect(tauriCommands.repositoryContinueOperation).toHaveBeenCalledWith("repo-1")
    );
  });

  it("İptal Et iki adımlı onay ister; onaysız abort çağrılmaz", async () => {
    const allResolved = statusWith({
      operation_state: "merge_in_progress",
      conflicted_files: [],
    });
    vi.mocked(tauriCommands.repositoryResolveConflict).mockResolvedValue(allResolved);

    render(<ChangesView repoId="repo-1" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "src/app.ts için bizim tarafı seç" })
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "README.md için bizim tarafı seç" })
    );

    const iptal = await screen.findByRole("button", { name: "İptal Et" });
    fireEvent.click(iptal);
    expect(tauriCommands.repositoryAbortOperation).not.toHaveBeenCalled();

    // ikinci tıklama = onay
    fireEvent.click(screen.getByRole("button", { name: /Emin misin\?/ }));
    await waitFor(() =>
      expect(tauriCommands.repositoryAbortOperation).toHaveBeenCalledWith("repo-1")
    );
  });

  it("'Çözüldü işaretle' dosyayı stage'ler (editörde elle çözüm akışı)", async () => {
    vi.mocked(tauriCommands.repositoryStageFiles).mockResolvedValue(
      statusWith({
        operation_state: "merge_in_progress",
        conflicted_files: ["src/app.ts"],
      })
    );

    render(<ChangesView repoId="repo-1" />);
    await screen.findByRole("alert", { name: "Çakışma paneli" });
    // README.md satırındaki "Çözüldü işaretle" butonunu hedefle
    const readmeRow = screen.getByText("README.md").closest("li");
    fireEvent.click(within(readmeRow!).getByText("Çözüldü işaretle"));

    await waitFor(() =>
      expect(tauriCommands.repositoryStageFiles).toHaveBeenCalledWith("repo-1", [
        "README.md",
      ])
    );
  });
});
