import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Compass,
  GitBranch,
  GitMerge,
  Globe,
  HardDrive,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { AppError, BranchInfo, GitStatus } from "../../types/ipc";
import type { RepositorySummary } from "../../types/navigation";
import {
  repositoryAbortOperation,
  repositoryCheckoutBranch,
  repositoryContinueOperation,
  repositoryCreateBranch,
  repositoryDeleteBranch,
  repositoryGetBranches,
  repositoryGetStatus,
  repositoryMergeBranch,
} from "../../lib/tauriCommands";
import { useNotify } from "../../components/common/Toast";
import { useDialogA11y } from "../../lib/useDialogA11y";

interface BranchesViewProps {
  repoId?: string | null;
  currentRepo?: RepositorySummary | { id: string; name?: string; path?: string } | null;
  onBranchSwitched?: (branch: string) => void;
}

const OPERATION_LABELS: Record<string, string> = {
  merge_in_progress: "Merge",
  rebase_in_progress: "Rebase",
  cherry_pick_in_progress: "Cherry-pick",
  revert_in_progress: "Revert",
  bisect_in_progress: "Bisect",
};

export const BranchesView: React.FC<BranchesViewProps> = ({
  repoId,
  currentRepo,
  onBranchSwitched,
}) => {
  const activeRepoId = repoId ?? currentRepo?.id ?? null;
  const notify = useNotify();

  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [filter, setFilter] = useState<"all" | "local" | "remote">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dirtyConflictError, setDirtyConflictError] = useState<string | null>(null);

  // Create Branch Modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [checkoutNewBranch, setCheckoutNewBranch] = useState(true);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Delete Branch Modal state
  const [branchToDelete, setBranchToDelete] = useState<BranchInfo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [forceDelete, setForceDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Merge state
  const [branchToMerge, setBranchToMerge] = useState<BranchInfo | null>(null);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  // Operation (continue/abort) state
  const [isOperationBusy, setIsOperationBusy] = useState(false);
  const [isAbortConfirmOpen, setIsAbortConfirmOpen] = useState(false);

  // CB-04: hızlı depo geçişinde eski deponun geç dönen yanıtı yeni deponun
  // listesini ezmesin — sonuç, talep anındaki repo + sıra numarasıyla doğrulanır.
  const branchesReqSeq = useRef(0);

  // CB-09/CB-10: tüm diyaloglarda açılış odağı + Escape + Tab tuzağı +
  // kapanışta odağın tetikleyiciye dönmesi (koşulsuz hook çağrıları).
  const dirtyConflictDialogRef = useDialogA11y(!!dirtyConflictError, () =>
    setDirtyConflictError(null)
  );
  const createDialogRef = useDialogA11y(isCreateOpen, () => setIsCreateOpen(false));
  const deleteDialogRef = useDialogA11y(!!branchToDelete, () => setBranchToDelete(null));
  const mergeDialogRef = useDialogA11y(!!branchToMerge, () => setBranchToMerge(null));
  const abortConfirmDialogRef = useDialogA11y(isAbortConfirmOpen, () =>
    setIsAbortConfirmOpen(false)
  );

  const loadBranches = useCallback(async () => {
    if (!activeRepoId) {
      setBranches([]);
      setStatus(null);
      return;
    }

    const seq = ++branchesReqSeq.current;
    setIsLoading(true);
    setActionError(null);
    try {
      const [branchList, repoStatus] = await Promise.all([
        repositoryGetBranches(activeRepoId),
        repositoryGetStatus(activeRepoId),
      ]);
      if (branchesReqSeq.current !== seq) return; // bayat yanıt
      setBranches(branchList);
      setStatus(repoStatus);
    } catch (err) {
      if (branchesReqSeq.current !== seq) return;
      const e = err as AppError;
      setActionError(e.message || "Branch listesi yüklenemedi.");
    } finally {
      if (branchesReqSeq.current === seq) setIsLoading(false);
    }
  }, [activeRepoId]);

  useEffect(() => {
    let ignore = false;
    const timer = setTimeout(() => {
      if (!ignore) void loadBranches();
    }, 0);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [loadBranches]);

  // -------------------------------------------------------------------------
  // Checkout
  // -------------------------------------------------------------------------

  const handleCheckout = async (branch: BranchInfo) => {
    if (!activeRepoId) return;
    setActionError(null);
    setDirtyConflictError(null);
    setIsLoading(true);
    try {
      const updatedStatus = await repositoryCheckoutBranch(activeRepoId, branch.name);
      setStatus(updatedStatus);
      await loadBranches();
      notify.success("Dala geçildi", branch.name);
      if (onBranchSwitched && updatedStatus.branch) {
        onBranchSwitched(updatedStatus.branch);
      }
    } catch (err) {
      const e = err as AppError;
      if (e.code === "DIRTY_WORKTREE") {
        setDirtyConflictError(
          e.message ||
            "Kaydedilmemiş değişiklikleriniz hedef branch ile çakışıyor. Veri kaybını önlemek için checkout durduruldu. Değişiklikleriniz korundu."
        );
      } else {
        setActionError(e.message || "Checkout işlemi başarısız oldu.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newBranchName.trim();
    if (!trimmed) {
      setCreateError("Branch adı boş olamaz.");
      return;
    }
    if (!activeRepoId) {
      setCreateError("Önce bir depo seçin.");
      return;
    }

    setIsCreating(true);
    setCreateError(null);
    try {
      const created = await repositoryCreateBranch(
        activeRepoId,
        trimmed,
        null,
        checkoutNewBranch
      );
      setIsCreateOpen(false);
      setNewBranchName("");
      await loadBranches();
      notify.success(
        "Dal oluşturuldu",
        checkoutNewBranch ? `${created.name} dalına geçildi` : created.name
      );
      if (checkoutNewBranch && onBranchSwitched) {
        onBranchSwitched(created.name);
      }
    } catch (err) {
      const e = err as AppError;
      setCreateError(e.message || "Branch oluşturulamadı.");
    } finally {
      setIsCreating(false);
    }
  };

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------

  const handleDeleteSubmit = async () => {
    if (!branchToDelete || !activeRepoId) return;

    setIsDeleting(true);
    setDeleteError(null);
    try {
      await repositoryDeleteBranch(activeRepoId, branchToDelete.name, forceDelete);
      notify.info("Dal silindi", branchToDelete.name);
      setBranchToDelete(null);
      setForceDelete(false);
      await loadBranches();
    } catch (err) {
      const e = err as AppError;
      setDeleteError(e.message || "Branch silinemedi.");
    } finally {
      setIsDeleting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Merge
  // -------------------------------------------------------------------------

  const handleMergeSubmit = async () => {
    if (!branchToMerge || !activeRepoId) return;
    setIsMerging(true);
    setMergeError(null);
    try {
      const result = await repositoryMergeBranch(activeRepoId, branchToMerge.name);
      setStatus(result);
      notify.success(
        "Birleştirme tamamlandı",
        `${branchToMerge.name} → ${result.branch ?? "aktif dal"}`
      );
      setBranchToMerge(null);
      await loadBranches();
    } catch (err) {
      const e = err as AppError;
      if (e.code === "CONFLICTS_PRESENT" || e.code === "MERGE_IN_PROGRESS") {
        setMergeError(
          e.message ||
            "Birleştirme sırasında çakışma oluştu. Değişiklikleriniz korundu; çakışmaları çözdükten sonra devam edin veya işlemi iptal edin."
        );
        await loadBranches();
      } else {
        setMergeError(e.message || "Merge işlemi başarısız oldu.");
      }
    } finally {
      setIsMerging(false);
    }
  };

  // -------------------------------------------------------------------------
  // Continue / abort in-progress operation
  // -------------------------------------------------------------------------

  const handleContinueOperation = async () => {
    if (!activeRepoId) return;
    setIsOperationBusy(true);
    setActionError(null);
    try {
      const result = await repositoryContinueOperation(activeRepoId);
      setStatus(result);
      notify.success("İşlem tamamlandı", "Devam eden merge/rebase bitirildi");
      await loadBranches();
    } catch (err) {
      const e = err as AppError;
      setActionError(e.message || "İşlem sürdürülemedi.");
    } finally {
      setIsOperationBusy(false);
    }
  };

  const handleAbortOperation = async () => {
    if (!activeRepoId) return;
    setIsOperationBusy(true);
    setActionError(null);
    try {
      const result = await repositoryAbortOperation(activeRepoId);
      setStatus(result);
      setIsAbortConfirmOpen(false);
      notify.info("İşlem iptal edildi", "Devam eden merge/rebase geri alındı");
      await loadBranches();
    } catch (err) {
      const e = err as AppError;
      setActionError(e.message || "İşlem iptal edilemedi.");
    } finally {
      setIsOperationBusy(false);
    }
  };

  const filteredBranches = branches.filter((b) => {
    const matchesSearch = b.name.toLowerCase().includes(searchTerm.toLowerCase());
    if (!matchesSearch) return false;
    if (filter === "local") return !b.is_remote;
    if (filter === "remote") return b.is_remote;
    return true;
  });

  const isDetached = status?.is_detached_head ?? false;
  const operationLabel = status ? OPERATION_LABELS[status.operation_state] : undefined;
  const currentBranchName = status?.branch ?? null;

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6 max-w-5xl mx-auto w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              Dallar (Branches)
            </h1>
            <button
              type="button"
              onClick={() => void loadBranches()}
              disabled={isLoading || !activeRepoId}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-50"
              title="Yenile"
              aria-label="Branch Listesini Yenile"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            {currentRepo
              ? `${"name" in currentRepo ? currentRepo.name : "Depo"} deposuna ait yerel ve uzak branch'ler.`
              : "Repository branch listesi."}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setCreateError(null);
            setNewBranchName("");
            setIsCreateOpen(true);
          }}
          disabled={!activeRepoId}
          className="inline-flex items-center gap-2 px-3.5 py-2 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer self-start sm:self-auto focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          <span>Yeni Dal Oluştur</span>
        </button>
      </div>

      {/* Operation in progress banner */}
      {operationLabel && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-amber-950/40 border border-amber-600/50 rounded-xl p-4 text-xs text-amber-200">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-amber-300">
                {operationLabel} işlemi devam ediyor
              </div>
              <p className="text-amber-300/80 leading-relaxed mt-1">
                Çakışmaları çözüp dosyaları stage ettikten sonra işlemi sürdürebilir veya
                işlemi iptal edebilirsiniz.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleContinueOperation()}
              disabled={isOperationBusy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
            >
              {isOperationBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Devam Et
            </button>
            <button
              type="button"
              onClick={() => setIsAbortConfirmOpen(true)}
              disabled={isOperationBusy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-800 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
            >
              İptal Et
            </button>
          </div>
        </div>
      )}

      {/* Detached HEAD Banner */}
      {isDetached && (
        <div className="flex items-start gap-3 bg-amber-950/40 border border-amber-600/50 rounded-xl p-4 text-xs text-amber-200">
          <Compass className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-semibold text-amber-300">
              Detached HEAD Durumu Algılandı
            </div>
            <p className="text-amber-300/80 leading-relaxed">
              Şu an doğrudan bir commit üzerinde bulunuyorsunuz ({status?.branch}). Bu
              durumda yapılan yeni commitler bir branch&apos;e ait olmaz.
              Değişikliklerinizi korumak için buradan yeni bir dal oluşturabilirsiniz.
            </p>
            <button
              type="button"
              onClick={() => {
                setNewBranchName("");
                setCreateError(null);
                setIsCreateOpen(true);
              }}
              className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-md shadow-sm transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Bu Noktadan Yeni Dal Oluştur</span>
            </button>
          </div>
        </div>
      )}

      {/* Dirty Worktree Conflict Modal */}
      {dirtyConflictError && (
        <div
          ref={dirtyConflictDialogRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-slate-900 border border-rose-700/60 rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-bold text-slate-100">
                  Checkout Engellendi (Veri Kaybı Koruması)
                </h2>
                <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                  {dirtyConflictError}
                </p>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 bg-slate-950 p-3 rounded-lg border border-slate-800">
              Gybe, kaydedilmemiş dosyalarınızı otomatik olarak silmez veya ezmez. Lütfen
              önce Değişiklikler ekranından dosyalarınızı commit edin veya geri alın.
            </p>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setDirtyConflictError(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold rounded-lg"
              >
                Anladım
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Error Banner */}
      {actionError && (
        <div className="flex items-center justify-between gap-3 bg-rose-950/50 border border-rose-800/80 rounded-xl p-3 text-xs text-rose-200">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-rose-400 hover:text-rose-200 p-1"
            aria-label="Hatayı Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filter Tabs & Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center p-1 rounded-lg bg-slate-900 border border-slate-800 text-xs">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
              filter === "all"
                ? "bg-slate-800 text-white font-medium"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Tümü ({branches.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("local")}
            className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
              filter === "local"
                ? "bg-slate-800 text-white font-medium"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Yerel ({branches.filter((b) => !b.is_remote).length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("remote")}
            className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
              filter === "remote"
                ? "bg-slate-800 text-white font-medium"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Uzak ({branches.filter((b) => b.is_remote).length})
          </button>
        </div>

        <div className="relative max-w-xs">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Dal adı ara..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-400"
          />
        </div>
      </div>

      {/* Branches List */}
      <div className="space-y-2">
        {!activeRepoId ? (
          <div className="p-8 text-center bg-slate-900/30 rounded-xl border border-slate-800 text-slate-400 text-xs">
            Dalları görmek için bir depo seçin.
          </div>
        ) : isLoading && branches.length === 0 ? (
          <div className="flex items-center justify-center p-12 text-slate-400 text-xs gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
            <span>Dallar yükleniyor...</span>
          </div>
        ) : filteredBranches.length === 0 ? (
          <div className="p-8 text-center bg-slate-900/30 rounded-xl border border-slate-800 text-slate-400 text-xs">
            Arama kriterine uygun branch bulunamadı.
          </div>
        ) : (
          filteredBranches.map((branch) => (
            <div
              key={branch.name}
              className={`flex items-center justify-between p-3.5 rounded-xl border transition-colors ${
                branch.is_current
                  ? "bg-slate-900/90 border-sky-500/50 shadow-sm"
                  : "bg-slate-900/40 hover:bg-slate-800/50 border-slate-800/80"
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                    branch.is_remote
                      ? "bg-slate-800 text-cyan-400"
                      : "bg-sky-950/80 text-sky-400 border border-sky-800/60"
                  }`}
                >
                  {branch.is_remote ? (
                    <Globe className="w-3.5 h-3.5" />
                  ) : (
                    <HardDrive className="w-3.5 h-3.5" />
                  )}
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-100 truncate">
                      {branch.name}
                    </span>
                    {branch.is_current && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.2 rounded-full bg-sky-950 text-sky-400 border border-sky-800 font-medium">
                        <Check className="w-3 h-3" />
                        Mevcut Dal
                      </span>
                    )}
                  </div>
                  {branch.upstream && (
                    <div className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
                      İzlenen remote: {branch.upstream}
                    </div>
                  )}
                  {branch.last_commit_message && (
                    <div className="text-[11px] text-slate-400 truncate mt-0.5">
                      {branch.last_commit_message}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {branch.last_commit_hash && (
                  <span className="text-[10px] font-mono text-slate-500 bg-slate-950 px-2 py-1 rounded border border-slate-800 hidden sm:inline">
                    {branch.last_commit_hash}
                  </span>
                )}

                {!branch.is_current && (
                  <>
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={() => void handleCheckout(branch)}
                      className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-300 text-xs font-medium rounded-lg border border-slate-700/80 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Checkout
                    </button>
                    {!branch.is_remote &&
                      branch.name !== currentBranchName &&
                      !operationLabel && (
                        <button
                          type="button"
                          onClick={() => {
                            setMergeError(null);
                            setBranchToMerge(branch);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg border border-slate-700/80 transition-colors"
                          title={`${branch.name} dalını mevcut dala merge et`}
                        >
                          <GitMerge className="w-3.5 h-3.5" />
                          Merge
                        </button>
                      )}
                    {!branch.is_remote && (
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteError(null);
                          setForceDelete(false);
                          setBranchToDelete(branch);
                        }}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 transition-colors"
                        title="Dalı Sil"
                        aria-label={`Branch Sil: ${branch.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </>
                )}

                {branch.is_current && (
                  <span
                    className="text-[11px] text-slate-500 italic pr-2"
                    title="Aktif branch silinemez"
                  >
                    Aktif
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create Branch Modal */}
      {isCreateOpen && (
        <div
          ref={createDialogRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-sky-400" />
                <h2 className="text-sm font-bold text-slate-100">Yeni Dal Oluştur</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="text-slate-400 hover:text-slate-200"
                aria-label="Kapat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleCreateSubmit(e)} className="space-y-4">
              <div>
                <label
                  htmlFor="branch-name-input"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Dal Adı
                </label>
                <input
                  id="branch-name-input"
                  type="text"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="feature/yeni-ozellik"
                  autoFocus
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-400 font-mono"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Base: {status?.branch || "HEAD"}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="checkout-checkbox"
                  type="checkbox"
                  checked={checkoutNewBranch}
                  onChange={(e) => setCheckoutNewBranch(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-950 text-sky-600 focus:ring-sky-500"
                />
                <label
                  htmlFor="checkout-checkbox"
                  className="text-xs text-slate-300 select-none cursor-pointer"
                >
                  Oluşturulduktan sonra bu dala geç (checkout)
                </label>
              </div>

              {createError && (
                <div className="bg-rose-950/40 border border-rose-800/60 rounded-lg p-2.5 text-xs text-rose-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{createError}</span>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  disabled={isCreating}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors disabled:opacity-50"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={isCreating || !newBranchName.trim()}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {isCreating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Oluştur</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Branch Modal */}
      {branchToDelete && (
        <div
          ref={deleteDialogRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start gap-3">
              <Trash2 className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-bold text-slate-100">Dalı Sil</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Bu işlem seçilen yerel dalı silecektir.
                </p>
              </div>
            </div>

            <div className="bg-slate-950 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 border border-slate-800">
              {branchToDelete.name}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                id="force-delete-checkbox"
                type="checkbox"
                checked={forceDelete}
                onChange={(e) => setForceDelete(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-rose-600 focus:ring-rose-500"
              />
              <label
                htmlFor="force-delete-checkbox"
                className="text-xs text-slate-300 select-none cursor-pointer"
              >
                Birleştirilmemiş olsa bile zorla sil (-D)
              </label>
            </div>
            {forceDelete && (
              <p className="text-[11px] text-amber-200 bg-amber-950/40 border border-amber-700/50 rounded-lg p-2.5 leading-relaxed">
                Zorla silme, henüz birleştirilmemiş commit&apos;leri bu dal üzerinden
                erişilemez hale getirebilir. Varsayılan güvenli silme (`-d`) tercih
                edilir.
              </p>
            )}

            {deleteError && (
              <div className="bg-rose-950/40 border border-rose-800/60 rounded-lg p-2.5 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{deleteError}</span>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setBranchToDelete(null)}
                disabled={isDeleting}
                className="flex-1 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors disabled:opacity-50"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteSubmit()}
                disabled={isDeleting}
                className="flex-1 py-2 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Dalı Sil</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Merge Modal */}
      {branchToMerge && (
        <div
          ref={mergeDialogRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start gap-3">
              <GitMerge className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-bold text-slate-100">Dalı Merge Et</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Seçilen dal mevcut aktif dala birleştirilecektir. Çakışma olması
                  durumunda hiçbir değişiklik otomatik olarak silinmez.
                </p>
              </div>
            </div>

            <div className="bg-slate-950 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 border border-slate-800">
              {branchToMerge.name} → {status?.branch ?? "mevcut dal"}
            </div>

            {status &&
              (status.staged_files.length > 0 || status.unstaged_files.length > 0) && (
                <p className="text-[11px] text-amber-200 bg-amber-950/40 border border-amber-700/50 rounded-lg p-2.5 leading-relaxed">
                  Çalışma ağacınızda commit edilmemiş değişiklikler var. Bunlar
                  birleştirme ile çakışırsa işlem güvenli biçimde durdurulacaktır.
                </p>
              )}

            {mergeError && (
              <div className="bg-rose-950/40 border border-rose-800/60 rounded-lg p-2.5 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{mergeError}</span>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setBranchToMerge(null)}
                disabled={isMerging}
                className="flex-1 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors disabled:opacity-50"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={() => void handleMergeSubmit()}
                disabled={isMerging}
                className="flex-1 py-2 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {isMerging && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Merge Et</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Abort confirmation (destructive, explicit) */}
      {isAbortConfirmOpen && (
        <div
          ref={abortConfirmDialogRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-slate-900 border border-rose-700/60 rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-bold text-slate-100">İşlemi İptal Et</h2>
                <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                  Bu işlem devam eden {operationLabel ?? "Git"} operasyonunu iptal eder ve
                  o ana kadarki çakışma çözümlerini geri alır. Geri alınamaz.
                </p>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsAbortConfirmOpen(false)}
                disabled={isOperationBusy}
                className="flex-1 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors disabled:opacity-50"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={() => void handleAbortOperation()}
                disabled={isOperationBusy}
                className="flex-1 py-2 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {isOperationBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>İptal Et</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
