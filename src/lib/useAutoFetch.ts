/**
 * v0.2 madde 4 — arka plan fetch döngüsü.
 *
 * Kurallar:
 * - Yalnızca `enabled` ise çalışır; `minutes` dakikada bir tur atar.
 * - Pencere görünürken çalışır (visible); görünmezken tur atlanır (sonraki tur
 *   pencere geri gelince normal ritminde devam eder).
 * - Eşzamanlı tur koruması: bir tur bitmeden yenisi başlamaz.
 * - Tek depo hatası tüm turu düşürmez (Promise.allSettled).
 * - `runNow` testler ve manuel tetikleme için dışa açıktır.
 */
import { useCallback, useEffect, useRef } from "react";
import type { GitStatus, RepositoryRecord } from "../types/ipc";
import { repositoryFetch } from "./tauriCommands";

const FIRST_ROUND_DELAY_MS = 3_000;

export interface AutoFetchOptions {
  enabled: boolean;
  minutes: number;
  repositories: RepositoryRecord[];
  onStatus: (repoId: string, status: GitStatus) => void;
}

export function useAutoFetch({
  enabled,
  minutes,
  repositories,
  onStatus,
}: AutoFetchOptions): { runNow: () => Promise<void> } {
  // Repolar sık güncelleniyor; zamanlayıcıyı yeniden kurmadan en güncel
  // listeyi ref üzerinden oku.
  const reposRef = useRef(repositories);
  useEffect(() => {
    reposRef.current = repositories;
  }, [repositories]);

  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  const busyRef = useRef(false);

  const runNow = useCallback(async () => {
    if (busyRef.current) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }
    const targets = reposRef.current.filter((r) => !r.missing);
    if (targets.length === 0) return;

    busyRef.current = true;
    try {
      const results = await Promise.allSettled(
        targets.map((repo) => repositoryFetch(repo.id, null, true))
      );
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          onStatusRef.current(targets[index].id, result.value);
        }
      });
    } finally {
      busyRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const periodMs = Math.max(1, minutes) * 60_000;
    // Açılış yığılmasını önle: ilk tur kısa bir gecikmeyle.
    const first = window.setTimeout(() => void runNow(), FIRST_ROUND_DELAY_MS);
    const timer = window.setInterval(() => void runNow(), periodMs);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [enabled, minutes, runNow]);

  return { runNow };
}
