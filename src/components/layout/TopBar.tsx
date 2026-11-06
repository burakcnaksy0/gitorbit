import React from "react";
import {
  GitBranch,
  FolderGit2,
  Search,
  Moon,
  Sun,
  Layers,
  ArrowUpRight,
  ArrowDownLeft,
} from "lucide-react";
import { RepositorySummary } from "../../types/navigation";

interface TopBarProps {
  currentRepo: RepositorySummary | null;
  appVersion?: string | null;
  onRepoClick: () => void;
  onSearchClick: () => void;
  isDarkTheme: boolean;
  onToggleTheme: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  currentRepo,
  appVersion = null,
  onRepoClick,
  onSearchClick,
  isDarkTheme,
  onToggleTheme,
}) => {
  return (
    <header className="h-12 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md px-3 sm:px-4 flex items-center justify-between gap-2 shrink-0 select-none">
      {/* Brand & Active Repo Selector */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-6 h-6 rounded-md bg-linear-to-tr from-sky-600 to-cyan-400 flex items-center justify-center text-white shadow-xs shadow-sky-500/30">
            <Layers className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold tracking-tight text-xs sm:text-sm text-slate-100 hidden md:inline">
            GitOrbit
          </span>
        </div>

        <div className="h-4 w-px bg-slate-800 hidden md:block" />

        {/* Repository selector pill */}
        {currentRepo ? (
          <button
            type="button"
            onClick={onRepoClick}
            className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 text-xs font-medium text-slate-200 transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-sky-400 min-w-0"
            title={`Aktif Repo: ${currentRepo.name} (${currentRepo.path})`}
          >
            <FolderGit2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="truncate max-w-[120px] sm:max-w-[180px]">
              {currentRepo.name}
            </span>
            <div className="flex items-center gap-1 text-[11px] font-mono text-slate-400 border-l border-slate-700 pl-2">
              <GitBranch className="w-3 h-3 text-cyan-400" />
              {!currentRepo.currentBranch ? (
                <span className="truncate max-w-[80px] sm:max-w-[120px] text-slate-500">
                  branch yok
                </span>
              ) : currentRepo.currentBranch.startsWith("HEAD") ? (
                <span className="truncate max-w-[80px] sm:max-w-[140px] text-amber-400">
                  Detached HEAD
                </span>
              ) : (
                <span className="truncate max-w-[80px] sm:max-w-[120px]">
                  {currentRepo.currentBranch}
                </span>
              )}
            </div>
            {(currentRepo.ahead > 0 || currentRepo.behind > 0) && (
              <div className="hidden lg:flex items-center gap-1 text-[10px] text-slate-400">
                {currentRepo.ahead > 0 && (
                  <span className="flex items-center text-emerald-400">
                    <ArrowUpRight className="w-3 h-3" />
                    {currentRepo.ahead}
                  </span>
                )}
                {currentRepo.behind > 0 && (
                  <span className="flex items-center text-amber-400">
                    <ArrowDownLeft className="w-3 h-3" />
                    {currentRepo.behind}
                  </span>
                )}
              </div>
            )}
          </button>
        ) : (
          <div className="text-xs text-slate-500 italic">Repo seçilmedi</div>
        )}
      </div>

      {/* Global Search / Command Palette shortcut */}
      <div className="flex-1 max-w-md mx-2 hidden sm:block">
        <button
          type="button"
          onClick={onSearchClick}
          className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-950/70 hover:bg-slate-950 border border-slate-800/80 text-xs text-slate-400 transition-colors cursor-pointer group focus:outline-none focus:ring-1 focus:ring-sky-400"
        >
          <div className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300" />
            <span>Depolarda veya komutlarda ara...</span>
          </div>
          <kbd className="hidden md:inline-block px-1.5 py-0.5 text-[10px] font-mono font-medium text-slate-500 bg-slate-800/80 rounded border border-slate-700">
            Ctrl K
          </kbd>
        </button>
      </div>

      {/* Right Actions: Theme Toggle & Phase Indicator */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="hidden xl:inline-flex text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-sky-400 border border-slate-700 font-mono">
          {appVersion ? `v${appVersion}` : "GitOrbit"}
        </span>
        <button
          type="button"
          onClick={onToggleTheme}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 border border-transparent hover:border-slate-700/60 transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-sky-400"
          title={isDarkTheme ? "Açık temaya geç" : "Karanlık temaya geç"}
          aria-label="Tema Değiştir"
        >
          {isDarkTheme ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 text-slate-300" />
          )}
        </button>
      </div>
    </header>
  );
};
