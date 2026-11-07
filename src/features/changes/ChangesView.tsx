/**
 * ChangesView — Phase 3
 *
 * Displays staged / unstaged / untracked file groups backed by real
 * Tauri IPC calls. The diff viewer renders structured `FileDiffLine` data.
 *
 * Safety invariants enforced by this component:
 * - Discard requires a two-step confirmation with a status hash check.
 * - Stage/unstage operations always refresh status from the backend.
 * - Large diffs (truncated) and binary files display appropriate warnings.
 * - Errors are shown inline, never swallowed silently.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle,
  CornerDownLeft,
  EyeOff,
  FileDiff,
  FileMinus,
  FilePlus,
  FileText,
  HelpCircle,
  Loader2,
  PackageOpen,
  RotateCcw,
  Trash2,
  User,
  X,
} from "lucide-react";
import type {
  AppError,
  ChangedFile,
  DiffOutput,
  GitStatus,
  StashEntry,
} from "../../types/ipc";
import type { RepositorySummary } from "../../types/navigation";
import {
  repositoryAbortOperation,
  repositoryCommit,
  repositoryContinueOperation,
  repositoryDiscardChanges,
  repositoryGetDiff,
  repositoryGetIdentity,
  repositoryGetStatus,
  repositoryGetStatusHash,
  repositoryIgnoreFile,
  repositoryResolveConflict,
  repositorySetIdentity,
  repositoryStashApply,
  repositoryStashDrop,
  repositoryStashList,
  repositoryStashPop,
  repositoryStashPush,
  repositoryStageFiles,
  repositoryUnstageFiles,
} from "../../lib/tauriCommands";
import { shortSha, useNotify } from "../../components/common/Toast";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ChangesViewProps {
  /** ID of the currently active repository. Null = no repo selected. */
  repoId?: string | null;
  currentRepo?: RepositorySummary | { id: string; name?: string; path?: string } | null;
  /** Called after any mutation so the shell can refresh shared status. */
  onStatusChanged?: (status: GitStatus) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function FileStatusIcon({ status }: { status: ChangedFile["status"] }) {
  switch (status) {
    case "added":
      return <FilePlus className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    case "modified":
      return <FileText className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    case "deleted":
      return <FileMinus className="w-3.5 h-3.5 text-rose-400 shrink-0" />;
    case "untracked":
      return <HelpCircle className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
    case "renamed":
      return <FileDiff className="w-3.5 h-3.5 text-violet-400 shrink-0" />;
    case "conflicted":
      return <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />;
  }
}

function StatusBadge({ status }: { status: ChangedFile["status"] }) {
  const colors: Record<ChangedFile["status"], string> = {
    added: "bg-emerald-900/40 text-emerald-400",
    modified: "bg-amber-900/40 text-amber-400",
    deleted: "bg-rose-900/40 text-rose-400",
    untracked: "bg-sky-900/40 text-sky-400",
    renamed: "bg-violet-900/40 text-violet-400",
    conflicted: "bg-rose-900/60 text-rose-300",
  };
  return (
    <span
      className={`text-[9px] uppercase font-bold px-1 py-0.5 rounded ${colors[status]}`}
    >
      {status[0].toUpperCase()}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Discard confirmation modal
// ---------------------------------------------------------------------------

interface DiscardModalProps {
  file: ChangedFile;
  isUntracked: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}

function DiscardModal({
  file,
  isUntracked,
  onConfirm,
  onCancel,
  isLoading,
}: DiscardModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="discard-modal-title"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-md w-full mx-4 p-6 space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <h2 id="discard-modal-title" className="text-sm font-bold text-slate-100">
              {isUntracked ? "Dosyayı Sil" : "Değişikliği Geri Al"}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              {isUntracked
                ? "Bu işlem dosyayı diskten kalıcı olarak siler ve geri alınamaz."
                : "Bu işlem dosyanın çalışma ağacındaki değişikliklerini geri alır."}
            </p>
          </div>
        </div>

        <div className="bg-slate-950 rounded-lg px-3 py-2 text-xs font-mono text-slate-300 break-all">
          {file.path}
        </div>

        {isUntracked && (
          <div className="flex items-center gap-2 bg-rose-950/40 border border-rose-800/50 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span className="text-xs text-rose-300">
              Bu dosya henüz Git tarafından izlenmiyor. Silinince kurtarılamaz.
            </span>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            id="discard-cancel-btn"
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1 py-2 px-4 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors disabled:opacity-50"
          >
            İptal
          </button>
          <button
            id="discard-confirm-btn"
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 py-2 px-4 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RotateCcw className="w-3.5 h-3.5" />
            )}
            {isUntracked ? "Sil" : "Geri Al"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff viewer
// ---------------------------------------------------------------------------

interface DiffViewerProps {
  file: ChangedFile;
  diff: DiffOutput | null;
  isLoading: boolean;
  error: string | null;
}

function DiffViewer({ file: _file, diff, isLoading, error }: DiffViewerProps) {
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Diff yükleniyor…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="flex items-center gap-2 text-rose-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!diff) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        Diff görüntülemek için sol panelden dosya seçin.
      </div>
    );
  }

  if (diff.binary) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-center">
        <div className="space-y-2">
          <div className="text-slate-400 text-sm font-medium">İkili Dosya</div>
          <div className="text-slate-500 text-xs">
            Bu dosya ikili format içerdiğinden diff gösterilemiyor.
          </div>
        </div>
      </div>
    );
  }

  if (diff.truncated) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-center">
        <div className="space-y-2">
          <AlertTriangle className="w-6 h-6 text-amber-400 mx-auto" />
          <div className="text-amber-400 text-sm font-medium">Diff Çok Büyük</div>
          <div className="text-slate-500 text-xs">
            Bu diff 512 KB sınırını aştığı için gösterilemiyor ({" "}
            {Math.round(diff.raw_size / 1024)} KB).
          </div>
        </div>
      </div>
    );
  }

  if (diff.lines.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        Bu dosyada henüz diff yok.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto font-mono text-xs bg-slate-950 p-2 space-y-0">
      {diff.lines.map((line, idx) => {
        let cls = "px-3 py-0.5 rounded-sm select-text ";
        let prefix = " ";
        switch (line.kind) {
          case "header":
            cls += "text-slate-500 bg-transparent";
            break;
          case "hunk":
            cls += "text-sky-400 bg-sky-950/20";
            break;
          case "added":
            cls += "text-emerald-300 bg-emerald-950/30";
            prefix = "+";
            break;
          case "removed":
            cls += "text-rose-300 bg-rose-950/30";
            prefix = "-";
            break;
          case "context":
            cls += "text-slate-400";
            break;
        }
        return (
          <div key={idx} className={`flex items-start gap-2 ${cls}`}>
            {line.kind !== "header" && line.kind !== "hunk" && (
              <span className="text-slate-600 select-none w-8 shrink-0 text-right">
                {line.kind === "added"
                  ? line.new_line_no
                  : line.kind === "removed"
                    ? line.old_line_no
                    : line.new_line_no}
              </span>
            )}
            <span className="text-slate-600 select-none w-3 shrink-0">{prefix}</span>
            <span className="whitespace-pre-wrap break-all">{line.content}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// File row button
// ---------------------------------------------------------------------------

interface FileRowProps {
  file: ChangedFile;
  isSelected: boolean;
  onSelect: () => void;
  onStageToggle: () => void;
  onDiscard: () => void;
  onIgnore?: () => void;
  isStaged: boolean;
  isLoading: boolean;
}

function FileRow({
  file,
  isSelected,
  onSelect,
  onStageToggle,
  onDiscard,
  onIgnore,
  isStaged,
  isLoading,
}: FileRowProps) {
  const filePath =
    file?.path ?? (typeof file === "string" ? (file as unknown as string) : "");
  const fileStatus = file?.status ?? "untracked";
  const fileOldPath = file?.old_path;
  const safeId = filePath.replace(/[^a-zA-Z0-9]/g, "-");

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs group transition-colors cursor-pointer border ${
        isSelected
          ? "bg-sky-600/20 text-sky-200 border-sky-500/30"
          : "text-slate-300 hover:bg-slate-800/60 border-transparent"
      }`}
    >
      <button
        id={`file-select-${safeId}`}
        type="button"
        onClick={onSelect}
        className="flex items-center gap-2 min-w-0 flex-1 text-left"
        aria-label={`${filePath} dosyasını diff'te göster`}
      >
        <FileStatusIcon status={fileStatus} />
        <span className="truncate">{filePath}</span>
        {fileOldPath && (
          <span className="text-[9px] text-slate-500 truncate">← {fileOldPath}</span>
        )}
      </button>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          id={`file-stage-${safeId}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onStageToggle();
          }}
          disabled={isLoading}
          title={isStaged ? "Unstage" : "Stage"}
          className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          aria-label={isStaged ? `${file.path} unstage et` : `${file.path} stage et`}
        >
          {isLoading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : isStaged ? (
            <X className="w-3 h-3" />
          ) : (
            <CheckCircle className="w-3 h-3" />
          )}
        </button>

        {!isStaged && (
          <button
            id={`file-discard-${file.path.replace(/[^a-zA-Z0-9]/g, "-")}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDiscard();
            }}
            disabled={isLoading}
            title="Değişikliği geri al"
            className="p-1 rounded hover:bg-rose-900/40 text-slate-400 hover:text-rose-400 transition-colors"
            aria-label={`${file.path} değişikliğini geri al`}
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        )}

        {onIgnore && !isStaged && (
          <button
            id={`file-ignore-${file.path.replace(/[^a-zA-Z0-9]/g, "-")}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onIgnore();
            }}
            disabled={isLoading}
            title="Yoksay (.gitignore veya bu makine)"
            className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-amber-300 transition-colors"
            aria-label={`${file.path} dosyasını yoksay`}
          >
            <EyeOff className="w-3 h-3" />
          </button>
        )}
      </div>

      <StatusBadge status={file.status} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ChangesView
// ---------------------------------------------------------------------------

export const ChangesView: React.FC<ChangesViewProps> = ({
  repoId: propRepoId,
  currentRepo,
  onStatusChanged,
}) => {
  const repoId = propRepoId ?? currentRepo?.id ?? null;
  const notify = useNotify();

  const [status, setStatus] = useState<GitStatus | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [selectedFile, setSelectedFile] = useState<ChangedFile | null>(null);
  const [diff, setDiff] = useState<DiffOutput | null>(null);

  const [isStatusLoading, setIsStatusLoading] = useState(false);
  const [isDiffLoading, setIsDiffLoading] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);

  const [statusError, setStatusError] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Discard confirmation state
  const [discardTarget, setDiscardTarget] = useState<ChangedFile | null>(null);
  const [discardHash, setDiscardHash] = useState<string | null>(null);
  const [isDiscardLoading, setIsDiscardLoading] = useState(false);

  // Track selected file staged/unstaged context
  const selectedIsStaged = selectedFile
    ? (status?.staged_files.some((f) => f.path === selectedFile.path) ?? false)
    : false;

  // Ref to abort stale diff fetches
  const diffAbortRef = useRef<AbortController | null>(null);

  // Faz 4: Commit & Identity Guard state
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitSuccessSha, setCommitSuccessSha] = useState<string | null>(null);
  const [isIdentityModalOpen, setIsIdentityModalOpen] = useState(false);
  const [identityName, setIdentityName] = useState("");
  const [identityEmail, setIdentityEmail] = useState("");
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [isSavingIdentity, setIsSavingIdentity] = useState(false);

  // v0.2 — Ignore + Stash state
  const [ignoreTarget, setIgnoreTarget] = useState<ChangedFile | null>(null);
  const [isIgnoring, setIsIgnoring] = useState(false);
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [stashPanelOpen, setStashPanelOpen] = useState(false);
  const [stashModalOpen, setStashModalOpen] = useState(false);
  const [stashMessage, setStashMessage] = useState("");
  const [stashIncludeUntracked, setStashIncludeUntracked] = useState(true);
  const [isStashing, setIsStashing] = useState(false);
  const [stashBusyId, setStashBusyId] = useState<string | null>(null);
  const [stashDropTarget, setStashDropTarget] = useState<StashEntry | null>(null);

  // v0.2 — Çakışma yardımcı paneli (madde 7)
  const [conflictBusy, setConflictBusy] = useState<string | null>(null);
  const [abortArmed, setAbortArmed] = useState(false);
  const conflictTotalRef = useRef(0);

  // -------------------------------------------------------------------------
  // Toplu Stage / Unstage
  // -------------------------------------------------------------------------

  const handleStageAll = useCallback(async () => {
    if (!status) return;
    const pathsToStage = [
      ...status.unstaged_files.map((f) => f.path),
      ...status.untracked_files.map((f) => f.path),
    ];
    if (pathsToStage.length === 0) return;
    if (!repoId) {
      setStatus((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          staged_files: [
            ...prev.staged_files,
            ...prev.unstaged_files,
            ...prev.untracked_files,
          ],
          unstaged_files: [],
          untracked_files: [],
        };
      });
      return;
    }
    setIsActionLoading(true);
    setActionError(null);
    try {
      const newStatus = await repositoryStageFiles(repoId, pathsToStage);
      setStatus(newStatus);
      onStatusChanged?.(newStatus);
    } catch (err) {
      const e = err as AppError;
      setActionError(e.message ?? "Tümünü stage etme başarısız");
    } finally {
      setIsActionLoading(false);
    }
  }, [onStatusChanged, repoId, status]);

  // -------------------------------------------------------------------------
  // Load status
  // -------------------------------------------------------------------------

  const loadStatus = useCallback(async () => {
    if (!repoId) return;
    setIsStatusLoading(true);
    setStatusError(null);
    try {
      const s = await repositoryGetStatus(repoId);
      setStatus(s);
    } catch (err) {
      const e = err as AppError;
      setStatusError(e.message ?? "Status alınamadı");
    } finally {
      setIsStatusLoading(false);
    }
  }, [repoId]);

  useEffect(() => {
    if (!repoId) return;
    let ignore = false;

    // Asynchronously fetch initial status
    const timer = setTimeout(() => {
      void (async () => {
        setIsStatusLoading(true);
        setStatusError(null);
        try {
          const s = await repositoryGetStatus(repoId);
          if (!ignore) {
            setStatus(s);
            setSelectedFile((prev) => {
              if (prev) return prev;
              return (
                s.staged_files[0] ?? s.unstaged_files[0] ?? s.untracked_files[0] ?? null
              );
            });
          }
        } catch (err) {
          if (!ignore) {
            const e = err as AppError;
            setStatusError(e.message ?? "Status alınamadı");
          }
        } finally {
          if (!ignore) setIsStatusLoading(false);
        }
      })();
    }, 0);

    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [repoId]);

  // -------------------------------------------------------------------------
  // Load diff when selection changes
  // -------------------------------------------------------------------------

  const loadDiff = useCallback(
    async (file: ChangedFile, staged: boolean) => {
      if (!repoId) return;

      // Cancel any in-flight diff request
      diffAbortRef.current?.abort();
      const ctrl = new AbortController();
      diffAbortRef.current = ctrl;

      setIsDiffLoading(true);
      setDiffError(null);
      setDiff(null);

      try {
        const d = await repositoryGetDiff(repoId, file.path, staged);
        if (!ctrl.signal.aborted) {
          setDiff(d);
        }
      } catch (err) {
        if (!ctrl.signal.aborted) {
          const e = err as AppError;
          setDiffError(e.message ?? "Diff alınamadı");
        }
      } finally {
        if (!ctrl.signal.aborted) {
          setIsDiffLoading(false);
        }
      }
    },
    [repoId]
  );

  const handleSelectFile = useCallback(
    (file: ChangedFile, staged: boolean) => {
      setSelectedFile(file);
      void loadDiff(file, staged);
    },
    [loadDiff]
  );

  // -------------------------------------------------------------------------
  // Stage
  // -------------------------------------------------------------------------

  const handleStage = useCallback(
    async (file: ChangedFile) => {
      if (!repoId) return;
      setIsActionLoading(true);
      setActionError(null);
      try {
        const newStatus = await repositoryStageFiles(repoId, [file.path]);
        setStatus(newStatus);
        onStatusChanged?.(newStatus);
        // Keep selection but switch to staged diff
        if (selectedFile?.path === file.path) {
          void loadDiff(file, true);
        }
      } catch (err) {
        const e = err as AppError;
        setActionError(e.message ?? "Stage işlemi başarısız");
      } finally {
        setIsActionLoading(false);
      }
    },
    [repoId, selectedFile, loadDiff, onStatusChanged]
  );

  // -------------------------------------------------------------------------
  // Unstage
  // -------------------------------------------------------------------------

  const handleUnstage = useCallback(
    async (file: ChangedFile) => {
      if (!repoId) return;
      setIsActionLoading(true);
      setActionError(null);
      try {
        const newStatus = await repositoryUnstageFiles(repoId, [file.path]);
        setStatus(newStatus);
        onStatusChanged?.(newStatus);
        if (selectedFile?.path === file.path) {
          void loadDiff(file, false);
        }
      } catch (err) {
        const e = err as AppError;
        setActionError(e.message ?? "Unstage işlemi başarısız");
      } finally {
        setIsActionLoading(false);
      }
    },
    [repoId, selectedFile, loadDiff, onStatusChanged]
  );

  // -------------------------------------------------------------------------
  // Discard — two-step confirmation
  // -------------------------------------------------------------------------

  /** Step 1: User clicks the discard button — fetch status hash, open modal. */
  const handleDiscardRequest = useCallback(
    async (file: ChangedFile) => {
      if (!repoId) return;
      setActionError(null);
      try {
        const hash = await repositoryGetStatusHash(repoId);
        setDiscardHash(hash);
        setDiscardTarget(file);
      } catch (err) {
        const e = err as AppError;
        setActionError(e.message ?? "Durum hash alınamadı");
      }
    },
    [repoId]
  );

  /** Step 2: User confirms — call backend with hash for second-check. */
  const handleDiscardConfirm = useCallback(async () => {
    if (!repoId || !discardTarget || !discardHash) return;
    setIsDiscardLoading(true);
    setActionError(null);
    try {
      const newStatus = await repositoryDiscardChanges(
        repoId,
        discardTarget.path,
        discardHash
      );
      setStatus(newStatus);
      onStatusChanged?.(newStatus);
      if (selectedFile?.path === discardTarget.path) {
        setSelectedFile(null);
        setDiff(null);
      }
    } catch (err) {
      const e = err as AppError;
      if (e.code === "STATUS_CHANGED") {
        setActionError(
          "Dosya durumu değişti. Lütfen listeyi yenileyin ve tekrar deneyin."
        );
      } else {
        setActionError(e.message ?? "Discard işlemi başarısız");
      }
    } finally {
      setIsDiscardLoading(false);
      setDiscardTarget(null);
      setDiscardHash(null);
    }
  }, [onStatusChanged, repoId, discardTarget, discardHash, selectedFile]);

  // -------------------------------------------------------------------------
  // Commit & Identity Guard (Faz 4)
  // -------------------------------------------------------------------------

  const handleCommit = useCallback(async () => {
    const trimmed = commitMessage.trim();

    if (!trimmed) {
      setActionError("Commit mesajı boş olamaz.");
      return;
    }

    if (!status || status.staged_files.length === 0) {
      setActionError(
        "Commit edilecek staged dosya bulunmuyor. Önce dosyaları stage edin."
      );
      return;
    }

    if (!repoId) {
      setActionError("Önce bir depo seçin.");
      return;
    }

    setIsCommitting(true);
    setActionError(null);
    setCommitSuccessSha(null);
    try {
      const res = await repositoryCommit(repoId, trimmed, false);
      setStatus(res.status);
      onStatusChanged?.(res.status);
      setCommitMessage("");
      setCommitSuccessSha(res.commit_sha);
      setTimeout(() => setCommitSuccessSha(null), 6000);
      notify.success(
        "Commit atıldı",
        `${shortSha(res.commit_sha)} · ${res.status.branch ?? status?.branch ?? "HEAD"} dalında`
      );
    } catch (err) {
      const e = err as AppError;
      if (e.code === "IDENTITY_MISSING") {
        try {
          const currentId = await repositoryGetIdentity(repoId);
          setIdentityName(currentId.name ?? "");
          setIdentityEmail(currentId.email ?? "");
        } catch {
          // ignore
        }
        setIdentityError(null);
        setIsIdentityModalOpen(true);
      } else {
        setActionError(e.message ?? "Commit işlemi başarısız");
      }
    } finally {
      setIsCommitting(false);
    }
  }, [commitMessage, notify, onStatusChanged, repoId, status]);

  const handleSaveIdentity = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!repoId) return;
      if (!identityName.trim()) {
        setIdentityError("İsim (user.name) alanı boş olamaz.");
        return;
      }
      if (!identityEmail.trim() || !identityEmail.includes("@")) {
        setIdentityError("Geçerli bir e-posta (user.email) adresi girilmelidir.");
        return;
      }

      setIsSavingIdentity(true);
      setIdentityError(null);
      try {
        await repositorySetIdentity(repoId, identityName.trim(), identityEmail.trim());
        setIsIdentityModalOpen(false);
        notify.success(
          "Depo kimliği güncellendi",
          `${identityName.trim()} · ${identityEmail.trim()}`
        );
        if (commitMessage.trim() && status && status.staged_files.length > 0) {
          void handleCommit();
        }
      } catch (err) {
        const e = err as AppError;
        setIdentityError(e.message ?? "Kimlik kaydedilemedi.");
      } finally {
        setIsSavingIdentity(false);
      }
    },
    [commitMessage, handleCommit, identityEmail, identityName, notify, repoId, status]
  );

  // -------------------------------------------------------------------------
  // v0.2 — Ignore & Stash eylemleri
  // -------------------------------------------------------------------------

  const refreshStashes = useCallback(async () => {
    if (!repoId) {
      setStashes([]);
      return;
    }
    try {
      setStashes(await repositoryStashList(repoId));
    } catch {
      // Panel boş kalır; ana status akışı etkilenmez.
    }
  }, [repoId]);

  // Depo değişince stash sayısını tazele (panel kapalıyken de rozet doğru olsun).
  useEffect(() => {
    const timer = setTimeout(() => void refreshStashes(), 0);
    return () => clearTimeout(timer);
  }, [refreshStashes]);

  const handleIgnore = useCallback(
    async (file: ChangedFile, scope: "repo" | "local") => {
      if (!repoId) return;
      setIsIgnoring(true);
      try {
        const res = await repositoryIgnoreFile(repoId, file.path, scope);
        const newStatus = await repositoryGetStatus(repoId);
        setStatus(newStatus);
        onStatusChanged?.(newStatus);
        setIgnoreTarget(null);
        notify.success(
          "Yoksayıldı",
          `${res.pattern} · ${scope === "repo" ? ".gitignore" : "yalnız bu makine"}`
        );
      } catch (err) {
        const e = err as AppError;
        setActionError(e.message ?? "Yoksayma işlemi başarısız oldu.");
        setIgnoreTarget(null);
      } finally {
        setIsIgnoring(false);
      }
    },
    [notify, onStatusChanged, repoId]
  );

  const handleStashPush = useCallback(async () => {
    if (!repoId) return;
    setIsStashing(true);
    try {
      const newStatus = await repositoryStashPush(
        repoId,
        stashMessage.trim() || undefined,
        stashIncludeUntracked
      );
      setStatus(newStatus);
      onStatusChanged?.(newStatus);
      setStashModalOpen(false);
      setStashMessage("");
      await refreshStashes();
      notify.success("Değişiklikler kenara alındı", stashMessage.trim() || "stash@ kaydedildi");
    } catch (err) {
      const e = err as AppError;
      setActionError(e.message ?? "Stash alınamadı.");
    } finally {
      setIsStashing(false);
    }
  }, [notify, onStatusChanged, refreshStashes, repoId, stashIncludeUntracked, stashMessage]);

  const handleStashRestore = useCallback(
    async (entry: StashEntry, mode: "apply" | "pop") => {
      if (!repoId) return;
      setStashBusyId(entry.index);
      try {
        const newStatus =
          mode === "pop"
            ? await repositoryStashPop(repoId, entry.index)
            : await repositoryStashApply(repoId, entry.index);
        setStatus(newStatus);
        onStatusChanged?.(newStatus);
        await refreshStashes();
        notify.success(
          mode === "pop" ? "Stash geri yüklendi" : "Stash uygulandı",
          mode === "pop" ? `#${entry.index} listeden düşürüldü` : `#${entry.index} korundu`
        );
      } catch (err) {
        const e = err as AppError;
        setActionError(e.message ?? "Stash geri yüklenemedi.");
        await refreshStashes();
      } finally {
        setStashBusyId(null);
      }
    },
    [notify, onStatusChanged, refreshStashes, repoId]
  );

  const handleStashDrop = useCallback(async () => {
    if (!repoId || !stashDropTarget) return;
    setStashBusyId(stashDropTarget.index);
    try {
      setStashes(await repositoryStashDrop(repoId, stashDropTarget.index));
      setStashDropTarget(null);
      notify.info("Stash silindi", `#${stashDropTarget.index}`);
    } catch (err) {
      const e = err as AppError;
      setActionError(e.message ?? "Stash silinemedi.");
    } finally {
      setStashBusyId(null);
    }
  }, [notify, repoId, stashDropTarget]);

  // -------------------------------------------------------------------------
  // v0.2 — Çakışma paneli (madde 7): taraf seç, aç, işaretle, devam/iptal
  // -------------------------------------------------------------------------

  const conflictedFiles = status?.conflicted_files ?? [];
  const operationState = status?.operation_state ?? "normal";
  const inConflictFlow = operationState !== "normal" || conflictedFiles.length > 0;

  // Çözülen sayacı: işlem boyunca görülen en yüksek çakışma sayısı toplamdır.
  if (inConflictFlow && conflictedFiles.length > conflictTotalRef.current) {
    conflictTotalRef.current = conflictedFiles.length;
  }
  if (!inConflictFlow && conflictTotalRef.current !== 0) {
    conflictTotalRef.current = 0;
    setAbortArmed(false);
  }

  const applyConflictStatus = useCallback(
    (newStatus: GitStatus) => {
      setStatus(newStatus);
      onStatusChanged?.(newStatus);
    },
    [onStatusChanged]
  );

  const handleResolveSide = useCallback(
    async (path: string, side: "ours" | "theirs") => {
      if (!repoId) return;
      setConflictBusy(path);
      setActionError(null);
      try {
        applyConflictStatus(await repositoryResolveConflict(repoId, path, side));
        notify.success(
          "Çakışma çözüldü",
          `${path} · ${side === "ours" ? "bizim taraf" : "onların tarafı"} seçildi`
        );
      } catch (err) {
        const e = err as AppError;
        setActionError(e.message ?? "Çakışma çözülemedi.");
      } finally {
        setConflictBusy(null);
      }
    },
    [applyConflictStatus, notify, repoId]
  );

  /** Harici çözülmüş (editörde düzeltilmiş) dosyayı stage'ler. */
  const handleMarkResolved = useCallback(
    async (path: string) => {
      if (!repoId) return;
      setConflictBusy(path);
      setActionError(null);
      try {
        applyConflictStatus(await repositoryStageFiles(repoId, [path]));
        notify.success("Çözüldü olarak işaretlendi", path);
      } catch (err) {
        const e = err as AppError;
        setActionError(e.message ?? "Dosya stage edilemedi.");
      } finally {
        setConflictBusy(null);
      }
    },
    [applyConflictStatus, notify, repoId]
  );

  /** Dosyayı sistemdeki varsayılan editörde açar (opener köprüsü yoksa sessiz). */
  const handleOpenConflictFile = useCallback(
    async (path: string) => {
      if (!status) return;
      const fullPath = `${status.repository_path.replace(/\/+$/, "")}/${path}`;
      try {
        const { openPath } = await import("@tauri-apps/plugin-opener");
        await openPath(fullPath);
      } catch {
        setActionError("Dosya editörde açılamadı — konumu elle açabilirsiniz:");
      }
    },
    [status]
  );

  const handleConflictContinue = useCallback(async () => {
    if (!repoId) return;
    setConflictBusy("__flow__");
    setActionError(null);
    try {
      const newStatus = await repositoryContinueOperation(repoId);
      applyConflictStatus(newStatus);
      if (newStatus.conflicted_files.length > 0) {
        setActionError("Çözümlenmemiş çakışmalar hâlâ var.");
      } else {
        notify.success("İşlem tamamlandı", "Devam eden Git işlemi bitirildi");
      }
    } catch (err) {
      const e = err as AppError;
      setActionError(e.message ?? "İşlem sürdürülemedi.");
      void loadStatus();
    } finally {
      setConflictBusy(null);
    }
  }, [applyConflictStatus, loadStatus, notify, repoId]);

  const handleConflictAbort = useCallback(async () => {
    if (!repoId) return;
    setConflictBusy("__flow__");
    setActionError(null);
    try {
      applyConflictStatus(await repositoryAbortOperation(repoId));
      notify.info("İşlem iptal edildi", "Depo işlem öncesi durumuna döndü");
    } catch (err) {
      const e = err as AppError;
      setActionError(e.message ?? "İşlem iptal edilemedi.");
    } finally {
      setConflictBusy(null);
      setAbortArmed(false);
    }
  }, [applyConflictStatus, notify, repoId]);

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const allFiles = [
    ...(status?.staged_files ?? []),
    ...(status?.unstaged_files ?? []),
    ...(status?.untracked_files ?? []),
  ];

  // -------------------------------------------------------------------------
  // No repo selected
  // -------------------------------------------------------------------------

  if (!repoId) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        Değişiklikleri görmek için sol panelden bir repository seçin.
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Status loading
  // -------------------------------------------------------------------------

  if (isStatusLoading && !status) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Durum yükleniyor…</span>
      </div>
    );
  }

  if (statusError && !status) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
          <div className="text-rose-400 text-sm font-medium">{statusError}</div>
          <button
            id="changes-retry-btn"
            type="button"
            onClick={() => void loadStatus()}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition-colors"
          >
            Yeniden Dene
          </button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Main layout
  // -------------------------------------------------------------------------

  return (
    <>
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden bg-slate-950">
        {/* Left: file list */}
        <div className="w-full md:w-72 border-r border-slate-800 bg-slate-900/40 flex flex-col shrink-0">
          {/* Header */}
          <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-200">
              Değişiklikler ({allFiles.length})
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleStageAll()}
                disabled={
                  isActionLoading ||
                  ((status?.unstaged_files.length ?? 0) === 0 &&
                    (status?.untracked_files.length ?? 0) === 0)
                }
                className="text-[11px] text-sky-400 hover:text-sky-300 disabled:opacity-40 disabled:hover:text-sky-400 font-medium transition-opacity cursor-pointer"
              >
                Tümünü Stage Et
              </button>
              <button
                type="button"
                onClick={() => setStashModalOpen(true)}
                disabled={!repoId || isStashing}
                title="Değişiklikleri stash'le (kenara al)"
                className="flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 disabled:opacity-40 font-medium transition-colors cursor-pointer"
                aria-label="Değişiklikleri kenara al"
              >
                <Archive className="w-3 h-3" />
                Kenara Al
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = !stashPanelOpen;
                  setStashPanelOpen(next);
                  if (next) void refreshStashes();
                }}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 font-medium transition-colors cursor-pointer"
                aria-expanded={stashPanelOpen}
                aria-label="Stash listesini göster/gizle"
              >
                <PackageOpen className="w-3 h-3" />
                Stash ({stashes.length})
              </button>
              {isStatusLoading && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
              )}
            </div>
          </div>

          {/* v0.2 — Çakışma yardımcı bandı (madde 7) */}
          {inConflictFlow && (
            <div
              className="mx-3 mt-2 rounded-lg border border-rose-800/60 bg-rose-950/30 p-2.5 space-y-2"
              role="alert"
              aria-label="Çakışma paneli"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span className="text-xs font-bold text-rose-200 truncate">
                    {conflictedFiles.length > 0
                      ? `${conflictedFiles.length} dosyada çakışma var`
                      : "Tüm çakışmalar çözüldü"}
                  </span>
                </div>
                {conflictTotalRef.current > 0 && (
                  <span className="text-[10px] font-mono text-rose-300/80 shrink-0">
                    {conflictTotalRef.current - conflictedFiles.length}/
                    {conflictTotalRef.current} çözüldü
                  </span>
                )}
              </div>

              {conflictedFiles.length > 0 ? (
                <ul className="space-y-1.5">
                  {conflictedFiles.map((path) => (
                    <li
                      key={path}
                      className="rounded bg-slate-950/60 border border-slate-800 px-2 py-1.5"
                    >
                      <p className="text-[11px] font-mono text-slate-200 truncate" title={path}>
                        {path}
                      </p>
                      <div className="flex flex-wrap items-center gap-1 mt-1">
                        {conflictBusy === path ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleOpenConflictFile(path)}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors cursor-pointer"
                              title="Dosyayı varsayılan editörde aç (karma çözüm için)"
                            >
                              Dosyayı Aç
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleResolveSide(path, "ours")}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-sky-600/30 text-sky-300 hover:bg-sky-600/50 transition-colors cursor-pointer"
                              title="Çakışan içeriğin HEAD (mevcut dal) tarafını al ve stage'le"
                              aria-label={`${path} için bizim tarafı seç`}
                            >
                              ← Bizim
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleResolveSide(path, "theirs")}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-violet-600/30 text-violet-300 hover:bg-violet-600/50 transition-colors cursor-pointer"
                              title="Çakışan içeriğin gelen tarafını al ve stage'le"
                              aria-label={`${path} için onların tarafını seç`}
                            >
                              Onların →
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleMarkResolved(path)}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600/30 text-emerald-300 hover:bg-emerald-600/50 transition-colors cursor-pointer"
                              title="Editörde elle çözdüysen stage'le"
                            >
                              <CornerDownLeft className="w-2.5 h-2.5 inline mr-0.5" />
                              Çözüldü işaretle
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-emerald-300/90">
                  İşlemi tamamlayabilir veya başa dönebilirsin. İptal, bu işleme
                  kadar yapılan çözümleri geri alır.
                </p>
              )}

              {conflictedFiles.length === 0 && (
                <div className="flex gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => void handleConflictContinue()}
                    disabled={conflictBusy === "__flow__"}
                    className="flex-1 py-1.5 rounded text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {conflictBusy === "__flow__" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle className="w-3.5 h-3.5" />
                    )}
                    Devam Et
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!abortArmed) {
                        setAbortArmed(true);
                      } else {
                        void handleConflictAbort();
                      }
                    }}
                    disabled={conflictBusy === "__flow__"}
                    className={`flex-1 py-1.5 rounded text-xs font-semibold transition-colors disabled:opacity-50 ${
                      abortArmed
                        ? "bg-rose-600 hover:bg-rose-500 text-white"
                        : "bg-slate-800 hover:bg-slate-700 text-slate-200"
                    }`}
                  >
                    {abortArmed ? "Emin misin? Tekrar bas" : "İptal Et"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Stash paneli (v0.2) */}
          {stashPanelOpen && (
            <div className="mx-3 mt-2 rounded-lg border border-slate-800 bg-slate-900/60 p-2 space-y-1.5">
              {stashes.length === 0 && (
                <p className="text-[11px] text-slate-500 px-1 py-1">
                  Kenara alınmış değişiklik yok.
                </p>
              )}
              {stashes.map((entry) => (
                <div
                  key={entry.index}
                  className="flex items-center gap-2 rounded bg-slate-800/50 px-2 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-slate-200 truncate">
                      #{entry.index} — {entry.message}
                    </p>
                    <p className="text-[10px] text-slate-500">{entry.date}</p>
                  </div>
                  {stashBusyId === entry.index ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                  ) : (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleStashRestore(entry, "pop")}
                        title="Geri yükle ve listeden düşür (pop)"
                        className="text-[10px] px-1.5 py-0.5 rounded bg-sky-600/30 text-sky-300 hover:bg-sky-600/50 transition-colors cursor-pointer"
                        aria-label={`stash ${entry.index} pop`}
                      >
                        Pop
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleStashRestore(entry, "apply")}
                        title="Kopyala (stash listede kalır)"
                        className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300 hover:bg-slate-700 transition-colors cursor-pointer"
                        aria-label={`stash ${entry.index} apply`}
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        onClick={() => setStashDropTarget(entry)}
                        title="Sil (geri alınamaz)"
                        className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-900/30 transition-colors cursor-pointer"
                        aria-label={`stash ${entry.index} sil`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Action error */}
          {actionError && (
            <div className="mx-3 mt-2 flex items-center gap-2 bg-rose-950/40 border border-rose-800/40 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span className="text-xs text-rose-300">{actionError}</span>
              <button
                type="button"
                onClick={() => setActionError(null)}
                className="ml-auto text-slate-500 hover:text-slate-300"
                aria-label="Hata mesajını kapat"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* File groups */}
          <div className="flex-1 overflow-y-auto p-2 space-y-3">
            {allFiles.length === 0 && (
              <div className="py-8 text-center space-y-2">
                <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto" />
                <div className="text-slate-300 text-xs font-medium">
                  Çalışma ağacı temiz
                </div>
                <div className="text-slate-500 text-[11px]">
                  {status?.branch
                    ? `${status.branch} branch'inde değişiklik yok.`
                    : "Değişiklik yok."}
                </div>
              </div>
            )}

            {/* Staged */}
            {(status?.staged_files.length ?? 0) > 0 && (
              <div>
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-1 mb-1">
                  Staged ({status!.staged_files.length})
                </div>
                <div className="space-y-0.5">
                  {status!.staged_files.map((file) => (
                    <FileRow
                      key={`staged-${file.path}`}
                      file={file}
                      isSelected={selectedFile?.path === file.path && selectedIsStaged}
                      onSelect={() => handleSelectFile(file, true)}
                      onStageToggle={() => void handleUnstage(file)}
                      onDiscard={() => void handleDiscardRequest(file)}
                      isStaged={true}
                      isLoading={isActionLoading}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Unstaged */}
            {(status?.unstaged_files.length ?? 0) > 0 && (
              <div>
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-1 mb-1">
                  Unstaged ({status!.unstaged_files.length})
                </div>
                <div className="space-y-0.5">
                  {status!.unstaged_files.map((file) => (
                    <FileRow
                      key={`unstaged-${file.path}`}
                      file={file}
                      isSelected={selectedFile?.path === file.path && !selectedIsStaged}
                      onSelect={() => handleSelectFile(file, false)}
                      onStageToggle={() => void handleStage(file)}
                      onDiscard={() => void handleDiscardRequest(file)}
                      isStaged={false}
                      isLoading={isActionLoading}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Untracked */}
            {(status?.untracked_files.length ?? 0) > 0 && (
              <div>
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-1 mb-1">
                  Untracked ({status!.untracked_files.length})
                </div>
                <div className="space-y-0.5">
                  {status!.untracked_files.map((item) => {
                    const fileObj: ChangedFile =
                      typeof item === "string"
                        ? {
                            path: item,
                            status: "untracked",
                            staged: false,
                            old_path: null,
                          }
                        : item;
                    return (
                      <FileRow
                        key={`untracked-${fileObj.path}`}
                        file={fileObj}
                        isSelected={selectedFile?.path === fileObj.path}
                        onSelect={() => handleSelectFile(fileObj, false)}
                        onStageToggle={() => void handleStage(fileObj)}
                        onDiscard={() => void handleDiscardRequest(fileObj)}
                        onIgnore={() => setIgnoreTarget(fileObj)}
                        isStaged={false}
                        isLoading={isActionLoading}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Commit form box (Faz 4 entegrasyonu) */}
          <div className="p-2.5 border-t border-slate-800 bg-slate-900/60 space-y-2 shrink-0">
            {commitSuccessSha && (
              <div className="bg-emerald-950/60 border border-emerald-700/60 rounded px-2.5 py-1.5 text-xs text-emerald-300 flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-mono text-[11px] truncate">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Commit: {commitSuccessSha.slice(0, 7)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setCommitSuccessSha(null)}
                  className="text-emerald-400 hover:text-emerald-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <textarea
              rows={2}
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Commit mesajı yazın..."
              className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500 resize-none font-sans"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-slate-500 truncate">
                {status?.staged_files.length ?? 0} dosya hazır
              </span>
              <button
                type="button"
                onClick={() => void handleCommit()}
                disabled={
                  isCommitting ||
                  !commitMessage.trim() ||
                  (status?.staged_files.length ?? 0) === 0
                }
                className="px-3 py-1 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:hover:bg-sky-600 text-white rounded text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 shrink-0"
              >
                {isCommitting && <Loader2 className="w-3 h-3 animate-spin" />}
                <span>Commit ({status?.staged_files.length ?? 0})</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right: diff viewer */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedFile && (
            <div className="h-10 border-b border-slate-800 px-4 flex items-center justify-between text-xs text-slate-400 bg-slate-900/30 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <FileDiff className="w-4 h-4 text-sky-400 shrink-0" />
                <span className="font-mono text-slate-200 truncate">
                  {selectedFile.path}
                </span>
                <StatusBadge status={selectedFile.status} />
                <span className="text-[9px] text-slate-600">
                  {selectedIsStaged ? "staged" : "unstaged"}
                </span>
              </div>
              {diff && !diff.binary && !diff.truncated && (
                <div className="text-[11px] font-mono shrink-0 flex gap-2">
                  <span className="text-emerald-400">
                    +{diff.lines.filter((l) => l.kind === "added").length}
                  </span>
                  <span className="text-rose-400">
                    -{diff.lines.filter((l) => l.kind === "removed").length}
                  </span>
                </div>
              )}
            </div>
          )}

          <DiffViewer
            file={
              selectedFile ?? {
                path: "",
                status: "modified",
                staged: false,
                old_path: null,
              }
            }
            diff={diff}
            isLoading={isDiffLoading}
            error={diffError}
          />
        </div>
      </div>

      {/* Discard confirmation modal */}
      {discardTarget && (
        <DiscardModal
          file={discardTarget}
          isUntracked={discardTarget.status === "untracked"}
          onConfirm={() => void handleDiscardConfirm()}
          onCancel={() => {
            setDiscardTarget(null);
            setDiscardHash(null);
          }}
          isLoading={isDiscardLoading}
        />
      )}

      {/* Identity Configuration Modal */}
      {isIdentityModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-sky-400" />
                <h2 className="text-sm font-bold text-slate-100">
                  Git Kimliği Gerekli (Identity Guard)
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsIdentityModalOpen(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Git commit metadata&apos;sı için geçerli bir yazar adı ve e-posta adresi
              gereklidir. Bu ayar yalnızca bu depoya (`git config --local`)
              kaydedilecektir.
            </p>

            <form onSubmit={(e) => void handleSaveIdentity(e)} className="space-y-3">
              <div>
                <label
                  htmlFor="identity-name-input"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Ad Soyad (user.name)
                </label>
                <input
                  id="identity-name-input"
                  type="text"
                  value={identityName}
                  onChange={(e) => setIdentityName(e.target.value)}
                  placeholder="Ahmet Yılmaz"
                  autoFocus
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-400"
                />
              </div>

              <div>
                <label
                  htmlFor="identity-email-input"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  E-posta (user.email)
                </label>
                <input
                  id="identity-email-input"
                  type="email"
                  value={identityEmail}
                  onChange={(e) => setIdentityEmail(e.target.value)}
                  placeholder="ahmet@example.com"
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-400"
                />
              </div>

              {identityError && (
                <div className="bg-rose-950/40 border border-rose-800/60 rounded p-2 text-xs text-rose-300">
                  {identityError}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsIdentityModalOpen(false)}
                  disabled={isSavingIdentity}
                  className="flex-1 py-1.5 rounded text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={
                    isSavingIdentity || !identityName.trim() || !identityEmail.trim()
                  }
                  className="flex-1 py-1.5 rounded text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {isSavingIdentity && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Kimliği Kaydet</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* v0.2 — Yoksayme kapsam secimi */}
      {ignoreTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Dosyayı yoksay"
          onClick={() => !isIgnoring && setIgnoreTarget(null)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-sm w-full p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <EyeOff className="w-4 h-4 text-amber-400 shrink-0" />
              <h3 className="text-sm font-bold text-slate-100">Dosyayı yoksay</h3>
            </div>
            <p className="text-xs text-slate-400">
              <code className="text-slate-200 break-all">{ignoreTarget.path}</code>{" "}
              artık değişiklik listesinde görünmeyecek. Nereye yazılsın?
            </p>
            <div className="space-y-2 pt-1">
              <button
                type="button"
                disabled={isIgnoring}
                onClick={() => void handleIgnore(ignoreTarget, "repo")}
                className="w-full text-left rounded-lg border border-slate-700 px-3 py-2 hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
              >
                <span className="block text-xs font-semibold text-slate-100">
                  .gitignore (projeyle paylaşılır)
                </span>
                <span className="block text-[10px] text-slate-500 mt-0.5">
                  Depoya commit'lenir; repoyu klonlayan herkes için geçerli olur.
                </span>
              </button>
              <button
                type="button"
                disabled={isIgnoring}
                onClick={() => void handleIgnore(ignoreTarget, "local")}
                className="w-full text-left rounded-lg border border-slate-700 px-3 py-2 hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
              >
                <span className="block text-xs font-semibold text-slate-100">
                  Sadece bu makine (.git/info/exclude)
                </span>
                <span className="block text-[10px] text-slate-500 mt-0.5">
                  Depoya girmez; yalnızca senin bilgisayarında yoksayılır.
                </span>
              </button>
            </div>
            <button
              type="button"
              disabled={isIgnoring}
              onClick={() => setIgnoreTarget(null)}
              className="w-full py-1.5 rounded text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
            >
              Vazgeç
            </button>
          </div>
        </div>
      )}

      {/* v0.2 — Stash alma (Kenara Al) */}
      {stashModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Değişiklikleri kenara al"
          onClick={() => !isStashing && setStashModalOpen(false)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-sm w-full p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <Archive className="w-4 h-4 text-amber-400 shrink-0" />
              <h3 className="text-sm font-bold text-slate-100">Değişiklikleri kenara al</h3>
            </div>
            <p className="text-xs text-slate-400">
              Tüm staged + unstaged değişiklikler geçici olarak kaldırılır ve çalışma
              ağacı temizlenir. İstediğin zaman geri yükleyebilirsin.
            </p>
            <input
              type="text"
              value={stashMessage}
              onChange={(e) => setStashMessage(e.target.value)}
              placeholder="İsteğe bağlı açıklama (örn. wip: arama filtresi)"
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
            />
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={stashIncludeUntracked}
                onChange={(e) => setStashIncludeUntracked(e.target.checked)}
                className="rounded border-slate-600 bg-slate-950 accent-amber-500"
              />
              Untracked dosyalar da dahil olsun
            </label>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setStashModalOpen(false)}
                disabled={isStashing}
                className="flex-1 py-1.5 rounded text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={() => void handleStashPush()}
                disabled={isStashing}
                className="flex-1 py-1.5 rounded text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {isStashing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Kenara Al</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* v0.2 — Stash silme onayi */}
      {stashDropTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Stash'i sil"
          onClick={() => setStashDropTarget(null)}
        >
          <div
            className="bg-slate-900 border border-rose-800/50 rounded-xl shadow-2xl max-w-sm w-full p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-rose-400 shrink-0" />
              <h3 className="text-sm font-bold text-slate-100">Stash silinsin mi?</h3>
            </div>
            <p className="text-xs text-slate-400">
              #{stashDropTarget.index} — {stashDropTarget.message}
              <br />
              <span className="text-rose-300/80 mt-1 inline-block">
                Bu işlem geri alınamaz; stash içeriği kalıcı olarak silinir.
              </span>
            </p>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setStashDropTarget(null)}
                className="flex-1 py-1.5 rounded text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={() => void handleStashDrop()}
                className="flex-1 py-1.5 rounded text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-colors"
              >
                Kalıcı Olarak Sil
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
