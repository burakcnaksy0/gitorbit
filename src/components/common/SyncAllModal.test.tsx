/**
 * v0.2 madde 8 — SyncAllModal: çalışma durumu, sonuç listesi, özet, iptal.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SyncAllModal, summarizeSync } from "./SyncAllModal";
import * as tauriCommands from "../../lib/tauriCommands";
import type { RepoSyncOutcome } from "../../types/ipc";

vi.mock("../../lib/tauriCommands", () => ({
  syncPullAll: vi.fn(),
  syncPushAll: vi.fn(),
  syncCancelAll: vi.fn(),
}));

const outcomes: RepoSyncOutcome[] = [
  { repo_id: "r1", name: "alpha", status: "done", detail: null, summary: "güncel" },
  { repo_id: "r2", name: "beta", status: "skipped", detail: "origin yok", summary: null },
  { repo_id: "r3", name: "gamma", status: "error", detail: "merge hatası", summary: null },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("summarizeSync", () => {
  it("başarı/atlandı/hatalı sayılarını özetler", () => {
    expect(summarizeSync(outcomes)).toBe("1 başarılı, 1 atlandı, 1 hatalı");
    expect(summarizeSync([])).toBe("0 başarılı, 0 atlandı, 0 hatalı");
  });
});

describe("SyncAllModal", () => {
  it("pull turunu başlatır, sonuç listesini ve özeti gösterir", async () => {
    vi.mocked(tauriCommands.syncPullAll).mockResolvedValue(outcomes);
    const onFinished = vi.fn();

    render(<SyncAllModal kind="pull" onClose={() => {}} onFinished={onFinished} />);

    expect(screen.getByRole("dialog", { name: "Tümünü İçe Aktar" })).toBeInTheDocument();
    expect(screen.getByText("Durdur")).toBeInTheDocument();

    expect(await screen.findByText("Özet: 1 başarılı, 1 atlandı, 1 hatalı")).toBeInTheDocument();
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("origin yok")).toBeInTheDocument();
    expect(screen.getByText("merge hatası")).toBeInTheDocument();
    expect(onFinished).toHaveBeenCalledWith(outcomes);
  });

  it("push turu syncPushAll'ı çağırır", async () => {
    vi.mocked(tauriCommands.syncPushAll).mockResolvedValue([]);
    render(<SyncAllModal kind="push" onClose={() => {}} />);
    await waitFor(() => expect(tauriCommands.syncPushAll).toHaveBeenCalled());
    expect(screen.getByRole("dialog", { name: "Tümünü Dışa Aktar" })).toBeInTheDocument();
  });

  it("Durdur, syncCancelAll'ı çağırır", async () => {
    let release: ((v: RepoSyncOutcome[]) => void) | null = null;
    vi.mocked(tauriCommands.syncPullAll).mockImplementation(
      () => new Promise<RepoSyncOutcome[]>((resolve) => (release = resolve))
    );
    vi.mocked(tauriCommands.syncCancelAll).mockResolvedValue(true);

    render(<SyncAllModal kind="pull" onClose={() => {}} />);
    fireEvent.click(screen.getByText("Durdur"));
    expect(tauriCommands.syncCancelAll).toHaveBeenCalled();
    expect(
      screen.getByText(/Durdurma istendi — içinde bulunulan depo bitince duracak/)
    ).toBeInTheDocument();

    release!([]);
    await screen.findByText("Özet: 0 başarılı, 0 atlandı, 0 hatalı");
  });

  it("hata durumu dürüst gösterilir; onFinished boş diziyle çağrılır", async () => {
    vi.mocked(tauriCommands.syncPullAll).mockRejectedValue({
      code: "INTERNAL_ERROR",
      message: "Senkron turu başlatılamadı.",
    });
    const onFinished = vi.fn();

    render(<SyncAllModal kind="pull" onClose={() => {}} onFinished={onFinished} />);
    expect(
      await screen.findByText("Senkron turu başlatılamadı.")
    ).toBeInTheDocument();
    expect(onFinished).toHaveBeenCalledWith([]);
  });
});
