import React from "react";
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  FolderGit2,
  FolderPlus,
  GitFork,
  Layers,
  Loader2,
  Shield,
  Sparkles,
} from "lucide-react";
import { RepositorySummary, NavigationTab } from "../../types/navigation";

interface WelcomeViewProps {
  repositories: RepositorySummary[];
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onSelectRepo: (repo: RepositorySummary) => void;
  onNavigate: (tab: NavigationTab) => void;
  onAddRepository: () => void;
  onCloneRequest: () => void;
}

export const WelcomeView: React.FC<WelcomeViewProps> = ({
  repositories,
  isLoading = false,
  error = null,
  onRetry,
  onSelectRepo,
  onNavigate,
  onAddRepository,
  onCloneRequest,
}) => {
  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6 max-w-6xl mx-auto w-full">
      {/* Welcome Banner */}
      <div className="bg-linear-to-r from-slate-900 via-slate-900 to-sky-950/40 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-950/80 border border-sky-800/60 text-sky-400 text-xs font-semibold mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Developer Workspace</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            GitOrbit&apos;e Hoş Geldiniz
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-2 leading-relaxed">
            GitHub hesaplarınızı, yerel repolarınızı ve günlük Git iş akışlarınızı hızlı,
            güvenli ve modern bir masaüstü alanında yönetin.
          </p>

          <div className="flex flex-wrap items-center gap-3 mt-6">
            <button
              type="button"
              onClick={onAddRepository}
              className="inline-flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
              <FolderPlus className="w-4 h-4" />
              <span>Yerel Depo Aç</span>
            </button>

            <button
              type="button"
              onClick={onCloneRequest}
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
              <GitFork className="w-4 h-4" />
              <span>GitHub&apos;dan Klonla</span>
            </button>
          </div>
        </div>

        {/* Decorative background glow */}
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-linear-to-l from-sky-500/10 to-transparent pointer-events-none" />
      </div>

      {/* Main Grid: Recent Repositories & Principles */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Repositories */}
        <div className="lg:col-span-2 bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-4">
              <div className="flex items-center gap-2">
                <FolderGit2 className="w-4 h-4 text-sky-400" />
                <h2 className="text-sm font-bold text-slate-200">Son Açılan Depolar</h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate("repositories")}
                className="text-xs text-sky-400 hover:text-sky-300 font-medium inline-flex items-center gap-1 focus:outline-none focus:ring-1 focus:ring-sky-400 rounded px-1"
              >
                Tümünü Gör
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-slate-400 text-xs">
                <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
                <span>Depolar yükleniyor…</span>
              </div>
            ) : error ? (
              <div className="py-8 text-center space-y-3">
                <AlertTriangle className="w-7 h-7 text-rose-400 mx-auto" />
                <p className="text-xs text-rose-300">{error}</p>
                {onRetry && (
                  <button
                    type="button"
                    onClick={onRetry}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition-colors"
                  >
                    Yeniden Dene
                  </button>
                )}
              </div>
            ) : repositories.length === 0 ? (
              <div className="py-10 text-center space-y-2">
                <FolderGit2 className="w-8 h-8 text-slate-600 mx-auto" />
                <p className="text-xs text-slate-400">
                  Henüz kayıtlı depo yok. Başlamak için yerel bir Git deposu açın.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {repositories.slice(0, 5).map((repo) => (
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
                    className="w-full flex items-center justify-between p-3 rounded-lg bg-slate-950/60 hover:bg-slate-800/60 border border-slate-800/80 transition-colors text-left cursor-pointer focus:outline-none focus:ring-1 focus:ring-sky-400"
                  >
                    <div className="min-w-0 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs text-slate-100 truncate">
                          {repo.name}
                        </span>
                        {repo.currentBranch && (
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-cyan-400 border border-slate-700">
                            {repo.currentBranch}
                          </span>
                        )}
                        {repo.missing && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-950 text-rose-400 border border-rose-800">
                            bulunamadı
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate mt-1">
                        {repo.lastCommitMessage ?? repo.path}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 text-right">
                      <div className="text-[10px] text-slate-500 font-mono hidden sm:block">
                        {repo.lastCommitDate && (
                          <div className="flex items-center gap-1 justify-end">
                            <Clock className="w-3 h-3" />
                            <span>{repo.lastCommitDate}</span>
                          </div>
                        )}
                      </div>
                      {(repo.stagedCount > 0 || repo.unstagedCount > 0) && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-950/80 text-amber-400 border border-amber-800/60 font-mono">
                          {repo.stagedCount + repo.unstagedCount} değişiklik
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Local-First Architecture Summary Card */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-800/80">
            <Shield className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-slate-200">Mimari İlkelerimiz</h2>
          </div>

          <div className="space-y-3 text-xs text-slate-400">
            <div className="flex items-start gap-2.5">
              <div className="w-5 h-5 rounded-md bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 flex items-center justify-center shrink-0 mt-0.5 text-[11px]">
                1
              </div>
              <p>
                <strong className="text-slate-200">Local-first:</strong> Yerel Git
                operasyonları doğrudan makinenizdeki Git CLI üzerinden yürütülür.
              </p>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="w-5 h-5 rounded-md bg-sky-950/80 text-sky-400 border border-sky-800/60 flex items-center justify-center shrink-0 mt-0.5 text-[11px]">
                2
              </div>
              <p>
                <strong className="text-slate-200">Veri Bütünlüğü:</strong> Kullanıcı
                onayı olmadan hiçbir yıkıcı komut (hard reset, force push) çalıştırılamaz.
              </p>
            </div>

            <div className="flex items-start gap-2.5">
              <div className="w-5 h-5 rounded-md bg-cyan-950/80 text-cyan-400 border border-cyan-800/60 flex items-center justify-center shrink-0 mt-0.5 text-[11px]">
                3
              </div>
              <p>
                <strong className="text-slate-200">Şeffaf Durum:</strong> Gerçek olmayan
                hiçbir sahte işlem başarı mesajı üretilmez.
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800/80">
            <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-sky-400" />
              <span>Local-first • OS Keychain • Doğrulanabilir işlem durumu</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
