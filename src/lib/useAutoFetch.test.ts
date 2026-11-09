/**
 * v0.2 madde 4 — useAutoFetch: interval turu, hata yutma, eşzamanlılık
 * koruması ve kapalı ayarda hiç çalışmama.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { GitStatus, RepositoryRecord } from "../types/ipc";

vi.mock("./tauriCommands", () => ({
  repositoryFetch: vi.fn(),
}));

import { repositoryFetch } from "./tauriCommands";
import { useAutoFetch } from "./useAutoFetch";

function repo(id: string, missing = false): RepositoryRecord {
  return {
    id,
    display_name: id,
    canonical_path: `/repos/${id}`,
    current_branch: "main",
    last_opened_at: "2026-11-07T00:00:00Z",
    added_at: "2026-11-01T00:00:00Z",
    missing,
  } as unknown as RepositoryRecord;
}

function statusFor(id: string): GitStatus {
  return {
    repository_path: `/repos/${id}`,
    branch: "main",
    is_detached_head: false,
    upstream: "origin/main",
    ahead: 0,
    behind: 2,
    staged_files: [],
    unstaged_files: [],
    untracked_files: [],
    conflicted_files: [],
    operation_state: "normal",
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAutoFetch", () => {
  it("kapalıyken hiçbir fetch yapılmaz", async () => {
    const onStatus = vi.fn();
    renderHook(() =>
      useAutoFetch({
        enabled: false,
        minutes: 1,
        repositories: [repo("a")],
        onStatus,
      })
    );
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(repositoryFetch).not.toHaveBeenCalled();
  });

  it("açıkken ilk tur 3 sn sonra, sonra her N dakikada bir çalışır", async () => {
    vi.mocked(repositoryFetch).mockResolvedValue(statusFor("a"));
    const onStatus = vi.fn();
    renderHook(() =>
      useAutoFetch({
        enabled: true,
        minutes: 2,
        repositories: [repo("a")],
        onStatus,
      })
    );

    await vi.advanceTimersByTimeAsync(2_900);
    expect(repositoryFetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(repositoryFetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(repositoryFetch).toHaveBeenCalledTimes(2);

    // microtask'lar advanceTimersByTimeAsync içinde boşaltıldı — direkt doğrula.
    expect(onStatus).toHaveBeenCalledWith("a", statusFor("a"));
  });

  it("bir depo patlasa diğerleri güncellenmeye devam eder", async () => {
    vi.mocked(repositoryFetch).mockImplementation(async (id: string) => {
      if (id === "bad") throw { code: "NOT_FOUND", message: "yok" };
      return statusFor(id);
    });
    const onStatus = vi.fn();
    const { result } = renderHook(() =>
      useAutoFetch({
        enabled: true,
        minutes: 5,
        repositories: [repo("bad"), repo("good"), repo("gone", true)],
        onStatus,
      })
    );

    await result.current.runNow();

    expect(repositoryFetch).toHaveBeenCalledWith("bad", null, true);
    expect(repositoryFetch).toHaveBeenCalledWith("good", null, true);
    expect(repositoryFetch).not.toHaveBeenCalledWith("gone"); // missing atlanır
    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith("good", statusFor("good"));
  });

  it("eşzamanlı tur koruması: tur bitmeden ikinci tur başlamaz", async () => {
    let release: (() => void) | null = null;
    vi.mocked(repositoryFetch).mockImplementation(
      () =>
        new Promise<GitStatus>((resolve) => {
          release = () => resolve(statusFor("a"));
        })
    );
    const { result } = renderHook(() =>
      useAutoFetch({
        enabled: true,
        minutes: 5,
        repositories: [repo("a")],
        onStatus: vi.fn(),
      })
    );

    const first = result.current.runNow();
    const second = result.current.runNow(); // sessizce atlanır
    await second;
    expect(repositoryFetch).toHaveBeenCalledTimes(1);

    release!();
    await first;
  });
});
