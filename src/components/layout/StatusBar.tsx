import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  RefreshCw,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import type { RepositorySummary } from "../../types/navigation";
import type { GitEnvironment } from "../../types/ipc";

interface StatusBarProps {
  currentRepo: RepositorySummary | null;
  onSyncClick: () => void;
  isSyncing?: boolean;
  environment?: GitEnvironment | null;
  appVersion?: string | null;
}

function getOperationStateLabel(
  state?: string
): { label: string; className: string } | null {
  switch (state) {
    case "merge_in_progress":
      return {
        label: "Merge Devam Ediyor",
        className: "bg-rose-500/20 text-rose-300 border-rose-500/40",
      };
    case "rebase_in_progress":
      return {
        label: "Rebase Devam Ediyor",
        className: "bg-purple-500/20 text-purple-300 border-purple-500/40",
      };
    case "cherry_pick_in_progress":
      return {
        label: "Cherry-pick Devam Ediyor",
        className: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
      };
    case "revert_in_progress":
      return {
        label: "Revert Devam Ediyor",
        className: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40",
      };
    case "bisect_in_progress":
      return {
        label: "Bisect Devam Ediyor",
        className: "bg-amber-500/20 text-amber-300 border-amber-500/40",
      };
    default:
      return null;
  }
}

export const StatusBar: React.FC<StatusBarProps> = ({
  currentRepo,
  onSyncClick,
  isSyncing = false,
  environment = null,
  appVersion = null,
}) => {
  const opState = getOperationStateLabel(currentRepo?.operationState);
  const hasBranch = Boolean(currentRepo?.currentBranch);
  const isDetached = hasBranch && currentRepo!.currentBranch!.startsWith("HEAD");

  return (
    <footer className="h-7 border-t border-slate-800 bg-slate-900/95 px-3 flex items-center justify-between text-[11px] text-slate-400 select-none shrink-0 z-10">
      {/* Left: Active Branch, Sync & Operation State */}
      <div className="flex items-center gap-3">
        {currentRepo ? (
          <>
            <div className="flex items-center gap-1.5 font-medium text-slate-300">
              <GitBranch className="w-3.5 h-3.5 text-sky-400" />
              {!hasBranch ? (
                <span className="text-slate-500 italic">branch yok</span>
              ) : isDetached ? (
                <span className="text-amber-400">Detached HEAD</span>
              ) : (
                <span>{currentRepo.currentBranch}</span>
              )}
            </div>

            <button
              type="button"
              onClick={onSyncClick}
              disabled={isSyncing || currentRepo.missing}
              className="flex items-center gap-1 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-sky-400 rounded px-1 disabled:opacity-60 disabled:cursor-not-allowed"
              title="Remote durumunu yenile (Fetch)"
            >
              <RefreshCw
                className={`w-3 h-3 text-slate-500 ${isSyncing ? "animate-spin text-sky-400" : ""}`}
              />
              <span className="hidden sm:inline">
                {isSyncing ? "Senkronize Ediliyor..." : "Senkronize Et"}
              </span>
            </button>

            {opState && (
              <span
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${opState.className}`}
                title="Devam eden Git işlemi algılandı"
              >
                <AlertTriangle className="w-2.5 h-2.5" />
                {opState.label}
              </span>
            )}

            <span className="text-slate-600 hidden md:inline">|</span>

            <div className="hidden md:flex items-center gap-2 text-slate-400">
              <span className="text-emerald-400">{currentRepo.stagedCount} staged</span>
              <span>•</span>
              <span className="text-amber-400">{currentRepo.unstagedCount} modified</span>
              {(currentRepo.conflictedCount ?? 0) > 0 && (
                <>
                  <span>•</span>
                  <span className="text-rose-400 font-medium">
                    {currentRepo.conflictedCount} çakışma
                  </span>
                </>
              )}
            </div>
          </>
        ) : (
          <span className="text-slate-500">Çalışma alanı seçilmedi</span>
        )}
      </div>

      {/* Right: Environment & Platform Health */}
      <div className="flex items-center gap-3 font-mono text-[10px]">
        <div
          className={`flex items-center gap-1 ${
            environment?.installed && environment.meets_minimum
              ? "text-slate-400"
              : "text-rose-400"
          }`}
          title={
            environment?.installed
              ? (environment.executable_path ?? "Git CLI")
              : "Git CLI bulunamadı"
          }
        >
          <Terminal className="w-3 h-3 text-cyan-400" />
          <span className="hidden sm:inline">
            {environment?.installed ? `Git ${environment.version ?? "?"}` : "Git yok"}
          </span>
        </div>

        <span className="text-slate-600">|</span>

        <div
          className="flex items-center gap-1 text-emerald-400"
          title="Git komutları yerel makinede çalışır; kimlik bilgileri OS kasasında tutulur"
        >
          <ShieldCheck className="w-3 h-3" />
          <span className="hidden sm:inline">Local-first</span>
        </div>

        <span className="text-slate-600 hidden sm:inline">|</span>

        <div className="flex items-center gap-1 text-slate-400">
          <CheckCircle2 className="w-3 h-3 text-sky-400" />
          <span>{appVersion ? `v${appVersion}` : "GitOrbit"}</span>
        </div>
      </div>
    </footer>
  );
};
