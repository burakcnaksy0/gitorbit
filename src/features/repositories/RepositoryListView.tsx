import React, { useCallback, useState } from "react";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Download,
  FolderGit2,
  FolderOpen,
  GitBranch,
  Link2,
  Loader2,
  Plus,
  Rocket,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { RepositorySummary } from "../../types/navigation";
import { EmptyState } from "../../components/common/EmptyState";
import { pickDirectory } from "../../lib/directoryPicker";

interface RepositoryListViewProps {
  repositories: RepositorySummary[];
  currentRepo: RepositorySummary | null;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onSelectRepo: (repo: RepositorySummary) => void;
  onAddRepository: () => void;
  onCloneRepository: (url: string, destination: string) => void;
  onRemoveRepository: (repoId: string) => void;
  onRelinkRepository: (repoId: string, newPath: string) => void;
  onOpenInFileManager: (path: string) => void;
  /** Shown for repos without an `origin`: publish to GitHub. */
  onPublishRequest?: (repo: RepositorySummary) => void;
}

type ModalState =
  { kind: "none" } | { kind: "remove"; repo: RepositorySummary } | { kind: "clone" };

export const RepositoryListView: React.FC<RepositoryListViewProps> = ({
  repositories,
  currentRepo,
  isLoading = false,
  error = null,
  onRetry,
  onSelectRepo,
  onAddRepository,
  onCloneRepository,
  onRemoveRepository,
  onRelinkRepository,
  onOpenInFileManager,
  onPublishRequest,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [busyRepoId, setBusyRepoId] = useState<string | null>(null);

  // Clone form state
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneDestination, setCloneDestination] = useState("");
  const [cloneError, setCloneError] = useState<string | null>(null);

  const filteredRepos = repositories.filter((repo) => {
    const term = searchTerm.toLowerCase();
    return (
      repo.name.toLowerCase().includes(term) ||
      repo.path.toLowerCase().includes(term) ||
      (repo.currentBranch ?? "").toLowerCase().includes(term)
    );
  });

  const handleRelink = useCallback(
    async (repo: RepositorySummary) => {
      const selected = await pickDirectory("Deponun yeni konumunu seçin");
      if (!selected) return;
      setBusyRepoId(repo.id);
      try {
        onRelinkRepository(repo.id, selected);
      } finally {
        setBusyRepoId(null);
      }
    },
    [onRelinkRepository]
  );

  const handlePickCloneDestination = useCallback(async () => {
    try {
      const selected = await pickDirectory("Klonlama hedef klasörünü seçin");
      if (selected) setCloneDestination(selected);
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : "Klasör seçilemedi.");
    }
  }, []);

  const handleCloneSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!cloneUrl.trim() || !cloneDestination.trim()) {
        setCloneError("Depo adresi ve hedef klasör zorunludur.");
        return;
      }
      onCloneRepository(cloneUrl.trim(), cloneDestination.trim());
      setModal({ kind: "none" });
      setCloneUrl("");
      setCloneDestination("");
    },
    [cloneDestination, cloneUrl, onCloneRepository]
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6 max-w-6xl mx-auto w-full">
      {/* Header and Add Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            Depolar
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Çalışma alanına kayıtlı yerel ve uzak repository&apos;lerin listesi.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => {
              // Clear stale clone errors when (re)opening the dialog.
              setCloneError(null);
              setModal({ kind: "clone" });
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-400"
          >
            <Download className="w-4 h-4" />
            <span>Klonla</span>
          </button>
          <button
            type="button"
            onClick={onAddRepository}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-400"
          >
            <Plus className="w-4 h-4" />
            <span>Yeni Depo Ekle</span>
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center justify-between gap-3 bg-rose-950/50 border border-rose-800/80 rounded-xl p-3 text-xs text-rose-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
            >
              Yeniden Dene
            </button>
          )}
        </div>
      )}

      {/* Search Input */}
      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="İsim, yol veya branch ara..."
          className="w-full pl-9 pr-4 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-400 transition-colors"
        />
      </div>

      {/* Repositories List */}
      {isLoading && repositories.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-400 text-xs">
          <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
          <span>Depolar yükleniyor…</span>
        </div>
      ) : repositories.length === 0 ? (
        <EmptyState
          title="Henüz depo yok"
          description="Çalışma alanına bir Git deposu ekleyerek başlayın."
          actionLabel="Yeni Depo Ekle"
          onAction={onAddRepository}
        />
      ) : filteredRepos.length === 0 ? (
        <EmptyState
          title="Eşleşen Depo Bulunamadı"
          description={`"${searchTerm}" kriterine uygun repository bulunamadı.`}
          actionLabel="Aramayı Temizle"
          onAction={() => setSearchTerm("")}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredRepos.map((repo) => {
            const isSelected = currentRepo?.id === repo.id;
            return (
              <div
                key={repo.id}
                onClick={() => onSelectRepo(repo)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectRepo(repo);
                  }
                }}
                tabIndex={0}
                role="button"
                className={`flex flex-col justify-between p-4 rounded-xl border transition-all text-left cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-400 ${
                  isSelected
                    ? "bg-slate-900/90 border-sky-500/60 ring-1 ring-sky-500/30 shadow-lg"
                    : "bg-slate-900/40 hover:bg-slate-800/60 border-slate-800/80 shadow-xs"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FolderGit2 className="w-4 h-4 text-sky-400 shrink-0" />
                      <span className="font-bold text-sm text-slate-100 truncate">
                        {repo.name}
                      </span>
                      {repo.missing && (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800">
                          bulunamadı
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isSelected && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-sky-950 text-sky-400 border border-sky-800 font-medium">
                          <Check className="w-3 h-3" />
                          Aktif
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenInFileManager(repo.path);
                        }}
                        disabled={repo.missing}
                        className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-40 transition-colors"
                        title="Klasörü dosya yöneticisinde aç"
                        aria-label={`${repo.name} klasörünü aç`}
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="text-[11px] font-mono text-slate-400 truncate mb-3">
                    {repo.path}
                  </div>

                  {repo.lastCommitMessage && (
                    <div className="text-[11px] text-slate-400 truncate mb-2">
                      {repo.lastCommitMessage}
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-800/80 pt-3 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 font-mono text-[11px] text-cyan-400 bg-slate-950/70 px-2 py-0.5 rounded border border-slate-800">
                    <GitBranch className="w-3 h-3" />
                    <span>{repo.currentBranch ?? "branch yok"}</span>
                  </div>

                  <div className="flex items-center gap-2 text-[11px]">
                    {repo.ahead > 0 && (
                      <span className="flex items-center text-emerald-400 font-mono">
                        <ArrowUpRight className="w-3 h-3" />
                        {repo.ahead}
                      </span>
                    )}
                    {repo.behind > 0 && (
                      <span className="flex items-center text-amber-400 font-mono">
                        <ArrowDownLeft className="w-3 h-3" />
                        {repo.behind}
                      </span>
                    )}
                    <span className="text-slate-500">
                      {repo.stagedCount + repo.unstagedCount} değişiklik
                    </span>

                    {repo.missing ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRelink(repo);
                        }}
                        disabled={busyRepoId === repo.id}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors disabled:opacity-50"
                        title="Depoyu yeni konumuna bağla"
                      >
                        {busyRepoId === repo.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Link2 className="w-3 h-3" />
                        )}
                        Yeniden Bağla
                      </button>
                    ) : (
                      <div className="flex items-center gap-1">
                        {onPublishRequest && !repo.upstream && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onPublishRequest(repo);
                            }}
                            className="p-1 rounded text-slate-500 hover:text-sky-400 hover:bg-sky-950/30 transition-colors"
                            title="GitHub'da Yayınla (bu depoda origin remote'u yok)"
                            aria-label={`${repo.name} deposunu GitHub'da yayınla`}
                          >
                            <Rocket className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setModal({ kind: "remove", repo });
                          }}
                          className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 transition-colors"
                          title="Depo kaydını kaldır"
                          aria-label={`${repo.name} kaydını kaldır`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Remove confirmation */}
      {modal.kind === "remove" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start gap-3">
              <Trash2 className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-bold text-slate-100">Depo Kaydını Kaldır</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Bu işlem yalnızca GitOrbit kaydını siler. Disk üzerindeki dosyalar
                  etkilenmez.
                </p>
              </div>
            </div>
            <div className="bg-slate-950 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 border border-slate-800 break-all">
              {modal.repo.path}
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setModal({ kind: "none" })}
                className="flex-1 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={() => {
                  onRemoveRepository(modal.repo.id);
                  setModal({ kind: "none" });
                }}
                className="flex-1 py-2 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-colors"
              >
                Kaydı Kaldır
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clone form */}
      {modal.kind === "clone" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Download className="w-4 h-4 text-sky-400" />
                <h2 className="text-sm font-bold text-slate-100">Depo Klonla</h2>
              </div>
              <button
                type="button"
                onClick={() => setModal({ kind: "none" })}
                className="text-slate-400 hover:text-slate-200"
                aria-label="Kapat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCloneSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="clone-url-input"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Depo Adresi (HTTPS veya SSH)
                </label>
                <input
                  id="clone-url-input"
                  type="text"
                  value={cloneUrl}
                  onChange={(e) => setCloneUrl(e.target.value)}
                  placeholder="https://github.com/kullanici/depo.git"
                  autoFocus
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-400 font-mono"
                />
              </div>

              <div>
                <label
                  htmlFor="clone-destination-input"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Hedef Klasör
                </label>
                <div className="flex gap-2">
                  <input
                    id="clone-destination-input"
                    type="text"
                    value={cloneDestination}
                    onChange={(e) => setCloneDestination(e.target.value)}
                    placeholder="/home/kullanici/projeler/yeni-depo"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-400 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => void handlePickCloneDestination()}
                    className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs border border-slate-700"
                  >
                    Seç…
                  </button>
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Hedef klasör boş olmalıdır.
                </span>
              </div>

              {cloneError && (
                <div className="bg-rose-950/40 border border-rose-800/60 rounded-lg p-2.5 text-xs text-rose-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{cloneError}</span>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModal({ kind: "none" })}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={!cloneUrl.trim() || !cloneDestination.trim()}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-50"
                >
                  Klonla
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
