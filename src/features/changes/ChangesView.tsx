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
  CheckCircle,
  FileDiff,
  FileMinus,
  FilePlus,
  FileText,
  HelpCircle,
  Loader2,
  RotateCcw,
  User,
  X,
} from "lucide-react";
import type { AppError, ChangedFile, DiffOutput, GitStatus } from "../../types/ipc";
import type { RepositorySummary } from "../../types/navigation";
import {
  repositoryCommit,
  repositoryDiscardChanges,
  repositoryGetDiff,
  repositoryGetIdentity,
  repositoryGetStatus,
  repositoryGetStatusHash,
  repositorySetIdentity,
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
  isStaged: boolean;
  isLoading: boolean;
}

function FileRow({
  file,
  isSelected,
  onSelect,
  onStageToggle,
  onDiscard,
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
              {isStatusLoading && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
              )}
            </div>
          </div>

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
    </>
  );
};
