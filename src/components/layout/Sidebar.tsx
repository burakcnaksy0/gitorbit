import React from "react";
import {
  Compass,
  FolderGit2,
  FileDiff,
  History,
  GitBranch,
  Settings,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { GithubIcon } from "../common/GithubIcon";
import { NavigationTab } from "../../types/navigation";

interface SidebarProps {
  activeTab: NavigationTab;
  onTabChange: (tab: NavigationTab) => void;
  changesCount: number;
  reposCount: number;
  /** v0.2: tüm depolardaki toplam bekleyen (behind) commit sayısı. */
  incomingCount?: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

interface NavItem {
  id: NavigationTab;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  badgeVariant?: "sky" | "amber";
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  changesCount,
  reposCount,
  incomingCount,
  isCollapsed,
  onToggleCollapse,
}) => {
  const navItems: NavItem[] = [
    {
      id: "welcome",
      label: "Genel Bakış",
      icon: <Compass className="w-4 h-4 shrink-0" />,
    },
    {
      id: "repositories",
      label: "Depolar",
      icon: <FolderGit2 className="w-4 h-4 shrink-0" />,
      badge: reposCount,
      badgeVariant: "sky",
    },
    {
      id: "changes",
      label: "Değişiklikler",
      icon: <FileDiff className="w-4 h-4 shrink-0" />,
      badge: changesCount > 0 ? changesCount : undefined,
      badgeVariant: "amber",
    },
    {
      id: "history",
      label: "Geçmiş",
      icon: <History className="w-4 h-4 shrink-0" />,
    },
    {
      id: "branches",
      label: "Dallar",
      icon: <GitBranch className="w-4 h-4 shrink-0" />,
    },
    {
      id: "github",
      label: "GitHub",
      icon: <GithubIcon className="w-4 h-4 shrink-0" />,
    },
    {
      id: "settings",
      label: "Ayarlar",
      icon: <Settings className="w-4 h-4 shrink-0" />,
    },
  ];

  return (
    <aside
      className={`border-r border-slate-800 bg-slate-900/60 backdrop-blur-md flex flex-col justify-between transition-all duration-200 select-none ${
        isCollapsed ? "w-14" : "w-56"
      }`}
      aria-label="Ana Gezinme"
    >
      {/* Top Nav List */}
      <div className="p-2 space-y-1">
        <div className="px-2 py-1 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
          {!isCollapsed && "Çalışma Alanı"}
        </div>
        <nav className="space-y-0.5">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer group focus:outline-none focus:ring-1 focus:ring-sky-400 ${
                  isActive
                    ? "bg-sky-600/20 text-sky-400 border border-sky-500/30"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent"
                }`}
                title={isCollapsed ? item.label : undefined}
                aria-current={isActive ? "page" : undefined}
              >
                <span
                  className={
                    isActive
                      ? "text-sky-400"
                      : "text-slate-400 group-hover:text-slate-200"
                  }
                >
                  {item.icon}
                </span>

                {!isCollapsed && (
                  <span className="truncate flex-1 text-left">{item.label}</span>
                )}

                {!isCollapsed && item.badge !== undefined && (
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                      item.badgeVariant === "amber"
                        ? "bg-amber-950 text-amber-400 border border-amber-800/60"
                        : "bg-slate-800 text-slate-400 border border-slate-700"
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
                {!isCollapsed &&
                  item.id === "repositories" &&
                  (incomingCount ?? 0) > 0 && (
                    <span
                      className="text-[10px] px-1.5 py-0.2 rounded-full font-mono bg-sky-950 text-sky-300 border border-sky-800/60"
                      title={`${incomingCount} uzak commit bekliyor (pull hazır)`}
                      aria-label={`${incomingCount} bekleyen uzak commit`}
                    >
                      ↓{incomingCount}
                    </span>
                  )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Collapse Toggle Footer */}
      <div className="p-2 border-t border-slate-800/80">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="w-full flex items-center justify-center p-2 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 transition-colors focus:outline-none focus:ring-1 focus:ring-sky-400"
          title={isCollapsed ? "Genişlet" : "Daralt"}
          aria-label={isCollapsed ? "Menüyü Genişlet" : "Menüyü Daralt"}
        >
          {isCollapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <div className="flex items-center gap-2 text-xs w-full px-1">
              <ChevronLeft className="w-4 h-4" />
              <span>Menüyü Daralt</span>
            </div>
          )}
        </button>
      </div>
    </aside>
  );
};
