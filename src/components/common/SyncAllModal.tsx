/**
 * v0.2 madde 8 — "Tümünü eşitle" ilerleme/sonuç modalı.
 *
 * Tur arka planda sırayla çalışır; kullanıcı "Durdur" ile bir sonraki
 * depoda iptal edebilir. Bitince depo depo ✓/⏭/✗ listesi + özet gösterilir.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle,
  Loader2,
  SkipForward,
  X,
} from "lucide-react";
import type { RepoSyncOutcome } from "../../types/ipc";
import { syncCancelAll, syncPullAll, syncPushAll } from "../../lib/tauriCommands";

export type SyncAllKind = "pull" | "push";

interface SyncAllModalProps {
  kind: SyncAllKind;
  onClose: () => void;
  /** Tam tur bitince (sonuçlarla birlikte) bir kez çağrılır — özet toast için. */
  onFinished?: (outcomes: RepoSyncOutcome[]) => void;
}

function OutcomeIcon({ status }: { status: RepoSyncOutcome["status"] }) {
  switch (status) {
    case "done":
      return <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    case "skipped":
      return <SkipForward className="w-3.5 h-3.5 text-slate-500 shrink-0" />;
    case "error":
      return <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />;
  }
}

export function summarizeSync(outcomes: RepoSyncOutcome[]): string {
  const done = outcomes.filter((o) => o.status === "done").length;
  const skipped = outcomes.filter((o) => o.status === "skipped").length;
  const failed = outcomes.filter((o) => o.status === "error").length;
  return `${done} başarılı, ${skipped} atlandı, ${failed} hatalı`;
}

export const SyncAllModal: React.FC<SyncAllModalProps> = ({
  kind,
  onClose,
  onFinished,
}) => {
  const [outcomes, setOutcomes] = useState<RepoSyncOutcome[] | null>(null);
  const [running, setRunning] = useState(true);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    let ignore = false;
    void (async () => {
      try {
        const result = kind === "pull" ? await syncPullAll() : await syncPushAll();
        if (!ignore) {
          setOutcomes(result);
          if (!finishedRef.current) {
            finishedRef.current = true;
            onFinished?.(result);
          }
        }
      } catch (err) {
        if (!ignore) {
          const e = err as { message?: string };
          setError(e.message ?? "Toplu senkronizasyon başlatılamadı.");
          if (!finishedRef.current) {
            finishedRef.current = true;
            onFinished?.([]);
          }
        }
      } finally {
        if (!ignore) setRunning(false);
      }
    })();
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const title = kind === "pull" ? "Tümünü İçe Aktar" : "Tümünü Dışa Aktar";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => !running && onClose()}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-md w-full p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {kind === "pull" ? (
              <ArrowDownToLine className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <ArrowUpFromLine className="w-4 h-4 text-sky-400 shrink-0" />
            )}
            <h3 className="text-sm font-bold text-slate-100">{title}</h3>
          </div>
          {!running && (
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200"
              aria-label="Kapat"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {running && (
          <div className="flex items-center gap-3 rounded-lg bg-slate-950/60 border border-slate-800 px-3 py-3">
            <Loader2 className="w-4 h-4 animate-spin text-sky-400 shrink-0" />
            <p className="text-xs text-slate-300 flex-1">
              Depolar sırayla {kind === "pull" ? "çekiliyor" : "gönderiliyor"}…
              {cancelRequested && (
                <span className="block text-[10px] text-amber-300 mt-0.5">
                  Durdurma istendi — içinde bulunulan depo bitince duracak.
                </span>
              )}
            </p>
            <button
              type="button"
              onClick={() => {
                setCancelRequested(true);
                void syncCancelAll();
              }}
              disabled={cancelRequested}
              className="text-[11px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors disabled:opacity-50 cursor-pointer"
            >
              Durdur
            </button>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-rose-950/40 border border-rose-800/50 px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span className="text-xs text-rose-300">{error}</span>
          </div>
        )}

        {outcomes && (
          <div className="space-y-2">
            <p className="text-xs text-slate-300 font-medium">
              Özet: {summarizeSync(outcomes)}
            </p>
            <ul className="max-h-56 overflow-y-auto space-y-1">
              {outcomes.map((outcome) => (
                <li
                  key={outcome.repo_id}
                  className="flex items-center gap-2 rounded bg-slate-950/50 border border-slate-800/60 px-2.5 py-1.5"
                >
                  <OutcomeIcon status={outcome.status} />
                  <span className="text-xs text-slate-200 truncate flex-1">
                    {outcome.name}
                  </span>
                  <span
                    className={`text-[10px] truncate max-w-[45%] ${
                      outcome.status === "error"
                        ? "text-rose-400"
                        : outcome.status === "skipped"
                          ? "text-slate-500"
                          : "text-emerald-400/80"
                    }`}
                    title={outcome.detail ?? outcome.summary ?? ""}
                  >
                    {outcome.detail ?? outcome.summary ?? "tamam"}
                  </span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={onClose}
              className="w-full py-1.5 rounded text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
            >
              Kapat
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
