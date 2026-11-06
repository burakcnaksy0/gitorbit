import React, { useCallback, useEffect, useMemo, useState } from "react";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { ActionNoticeModal } from "../common/ActionNoticeModal";
import { WelcomeView } from "../../features/welcome/WelcomeView";
import { RepositoryListView } from "../../features/repositories/RepositoryListView";
import { ChangesView } from "../../features/changes/ChangesView";
import { HistoryView } from "../../features/history/HistoryView";
import { BranchesView } from "../../features/branches/BranchesView";
import { GitHubView } from "../../features/github/GitHubView";
import { SettingsView } from "../../features/settings/SettingsView";
import type { RepositorySummary, NavigationTab } from "../../types/navigation";
import type {
  AppError,
  AppInfo,
  AppSettings,
  AppSettingsUpdate,
  CommitInfo,
  GitEnvironment,
  GitStatus,
  RepositoryRecord,
} from "../../types/ipc";
import {
  appGetEnvironment,
  appGetInfo,
  repositoryAdd,
  repositoryClone,
  repositoryFetch,
  repositoryGetHistory,
  repositoryGetStatus,
  repositoryList,
  repositoryRelink,
  repositoryRemove,
  openPathInFileManager,
  settingsGet,
  settingsUpdate,
} from "../../lib/tauriCommands";
import { pickDirectory } from "../../lib/directoryPicker";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as AppError).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "Beklenmeyen bir hata oluştu.";
}

function errorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as AppError).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return "INTERNAL_ERROR";
}

function errorHint(err: unknown): string | undefined {
  if (err && typeof err === "object" && "recovery_hint" in err) {
    const hint = (err as AppError).recovery_hint;
    if (typeof hint === "string" && hint.length > 0) return hint;
  }
  return undefined;
}

interface NoticeState {
  isOpen: boolean;
  title: string;
  actionName: string;
  context: string;
  details?: string;
  tone: "info" | "error";
}

const CLOSED_NOTICE: NoticeState = {
  isOpen: false,
  title: "",
  actionName: "",
  context: "",
  tone: "info",
};

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export const Shell: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavigationTab>("welcome");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isDarkTheme, setIsDarkTheme] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  // Backend state -----------------------------------------------------------
  const [repositories, setRepositories] = useState<RepositoryRecord[]>([]);
  const [statuses, setStatuses] = useState<Record<string, GitStatus>>({});
  const [lastCommits, setLastCommits] = useState<Record<string, CommitInfo | undefined>>(
    {}
  );
  const [currentRepoId, setCurrentRepoId] = useState<string | null>(null);

  const [isLoadingRepos, setIsLoadingRepos] = useState(true);
  const [reposError, setReposError] = useState<string | null>(null);

  const [environment, setEnvironment] = useState<GitEnvironment | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const [notice, setNotice] = useState<NoticeState>(CLOSED_NOTICE);

  const showNotice = useCallback(
    (
      title: string,
      actionName: string,
      context: string,
      details?: string,
      tone: "info" | "error" = "info"
    ) => {
      setNotice({ isOpen: true, title, actionName, context, details, tone });
    },
    []
  );

  const showError = useCallback(
    (actionName: string, err: unknown) => {
      const hint = errorHint(err);
      showNotice(
        "İşlem Başarısız",
        actionName,
        errorCode(err),
        [errorMessage(err), hint].filter(Boolean).join("\n"),
        "error"
      );
    },
    [showNotice]
  );

  const closeNotice = useCallback(() => setNotice(CLOSED_NOTICE), []);

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  const loadRepositories = useCallback(async () => {
    try {
      const records = await repositoryList();
      setReposError(null);
      if (!Array.isArray(records)) {
        throw {
          code: "INTERNAL_ERROR",
          message: "Depo listesi beklenmeyen bir biçimde döndü.",
          recoverable: true,
        } satisfies AppError;
      }
      setRepositories(records);

      const statusEntries: Record<string, GitStatus> = {};
      const commitEntries: Record<string, CommitInfo | undefined> = {};

      await Promise.all(
        records.map(async (record) => {
          if (record.missing) return;
          const [statusResult, historyResult] = await Promise.allSettled([
            repositoryGetStatus(record.id),
            repositoryGetHistory(record.id, null, 1, 0),
          ]);
          if (statusResult.status === "fulfilled") {
            statusEntries[record.id] = statusResult.value;
          }
          if (historyResult.status === "fulfilled") {
            commitEntries[record.id] = historyResult.value.commits[0];
          }
        })
      );

      setStatuses(statusEntries);
      setLastCommits(commitEntries);
      setCurrentRepoId((prev) => {
        if (prev && records.some((r) => r.id === prev)) return prev;
        return records[0]?.id ?? null;
      });
    } catch (err) {
      setReposError(errorMessage(err));
      setRepositories([]);
      setStatuses({});
      setLastCommits({});
      setCurrentRepoId(null);
    } finally {
      setIsLoadingRepos(false);
    }
  }, []);

  const loadEnvironment = useCallback(async () => {
    const [envResult, infoResult, settingsResult] = await Promise.allSettled([
      appGetEnvironment(),
      appGetInfo(),
      settingsGet(),
    ]);
    if (envResult.status === "fulfilled") setEnvironment(envResult.value);
    if (infoResult.status === "fulfilled") setAppInfo(infoResult.value);
    if (settingsResult.status === "fulfilled") {
      setSettings(settingsResult.value);
      setIsDarkTheme(settingsResult.value.theme !== "light");
    }
  }, []);

  useEffect(() => {
    // Deferred initial load (same convention as HistoryView): keeps the
    // effect body free of synchronous setState cascades.
    const timer = setTimeout(() => {
      void loadEnvironment();
      void loadRepositories();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadEnvironment, loadRepositories]);

  // -------------------------------------------------------------------------
  // Derived view models
  // -------------------------------------------------------------------------

  const summaries = useMemo<RepositorySummary[]>(() => {
    return repositories.map((record) => {
      const status = statuses[record.id];
      const commit = lastCommits[record.id];
      return {
        id: record.id,
        name: record.display_name,
        path: record.canonical_path,
        currentBranch: status?.branch ?? record.current_branch,
        ahead: status?.ahead ?? 0,
        behind: status?.behind ?? 0,
        stagedCount: status?.staged_files.length ?? 0,
        unstagedCount:
          (status?.unstaged_files.length ?? 0) + (status?.untracked_files.length ?? 0),
        lastCommitMessage: commit?.message.split("\n")[0] ?? null,
        lastCommitDate: commit?.authored_at ?? record.last_opened_at,
        upstream: status?.upstream ?? null,
        operationState: status?.operation_state ?? "normal",
        conflictedCount: status?.conflicted_files.length ?? 0,
        missing: record.missing,
      };
    });
  }, [repositories, statuses, lastCommits]);

  const currentRepo = useMemo(
    () => summaries.find((repo) => repo.id === currentRepoId) ?? null,
    [summaries, currentRepoId]
  );

  const changesCount = currentRepo
    ? currentRepo.stagedCount + currentRepo.unstagedCount
    : 0;

  // -------------------------------------------------------------------------
  // Repository actions
  // -------------------------------------------------------------------------

  const openRepository = useCallback(
    async (path: string) => {
      try {
        const record = await repositoryAdd(path);
        await loadRepositories();
        setCurrentRepoId(record.id);
        setActiveTab("changes");
      } catch (err) {
        showError("Depo Ekle", err);
      }
    },
    [loadRepositories, showError]
  );

  const handleAddRepository = useCallback(async () => {
    try {
      const path = await pickDirectory("Git deposu seçin");
      if (!path) return;
      await openRepository(path);
    } catch (err) {
      showError("Klasör Seç", err);
    }
  }, [openRepository, showError]);

  const handleCloneRepository = useCallback(
    async (url: string, destination: string) => {
      try {
        const result = await repositoryClone(url, destination);
        await loadRepositories();
        setCurrentRepoId(result.repository.id);
        setActiveTab("changes");
      } catch (err) {
        showError("Depo Klonla", err);
      }
    },
    [loadRepositories, showError]
  );

  const handleRemoveRepository = useCallback(
    async (repoId: string) => {
      try {
        await repositoryRemove(repoId);
        await loadRepositories();
      } catch (err) {
        showError("Depo Kaydını Kaldır", err);
      }
    },
    [loadRepositories, showError]
  );

  const handleRelinkRepository = useCallback(
    async (repoId: string, newPath: string) => {
      try {
        await repositoryRelink(repoId, newPath);
        await loadRepositories();
      } catch (err) {
        showError("Depoyu Yeniden Bağla", err);
      }
    },
    [loadRepositories, showError]
  );

  const refreshCurrentStatus = useCallback(async (repoId: string) => {
    try {
      const status = await repositoryGetStatus(repoId);
      setStatuses((prev) => ({ ...prev, [repoId]: status }));
    } catch {
      // The status is refreshed opportunistically; a failure here is surfaced
      // by the next explicit refresh in the active view.
    }
  }, []);

  const handleSync = useCallback(async () => {
    if (!currentRepoId) return;
    setIsSyncing(true);
    try {
      const status = await repositoryFetch(currentRepoId);
      setStatuses((prev) => ({ ...prev, [currentRepoId]: status }));
    } catch (err) {
      showError("Senkronize Et (Fetch)", err);
    } finally {
      setIsSyncing(false);
    }
  }, [currentRepoId, showError]);

  const handleSaveSettings = useCallback(async (update: AppSettingsUpdate) => {
    const next = await settingsUpdate(update);
    setSettings(next);
    if (update.theme) setIsDarkTheme(next.theme !== "light");
    return next;
  }, []);

  const handleToggleTheme = useCallback(() => {
    const nextTheme = isDarkTheme ? "light" : "dark";
    setIsDarkTheme(nextTheme === "dark");
    // Persist best-effort; the visual toggle must stay instant.
    void handleSaveSettings({ theme: nextTheme }).catch(() => {});
  }, [handleSaveSettings, isDarkTheme]);

  // -------------------------------------------------------------------------
  // Keyboard shortcut (Ctrl+K) — honest "not implemented" notice
  // -------------------------------------------------------------------------

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        showNotice(
          "Komut Paleti",
          "Komut Paleti & Arama",
          "Planlanan özellik",
          "Klavye ile hızlı arama henüz uygulanmadı. Şimdilik depoları ve dosyaları ilgili sekmelerden arayabilirsiniz."
        );
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showNotice]);

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------

  const renderActiveView = () => {
    switch (activeTab) {
      case "welcome":
        return (
          <WelcomeView
            repositories={summaries}
            isLoading={isLoadingRepos}
            error={reposError}
            onRetry={() => {
              setIsLoadingRepos(true);
              void loadRepositories();
            }}
            onSelectRepo={(repo) => {
              setCurrentRepoId(repo.id);
              setActiveTab("changes");
            }}
            onNavigate={setActiveTab}
            onAddRepository={() => void handleAddRepository()}
            onCloneRequest={() => setActiveTab("repositories")}
          />
        );
      case "repositories":
        return (
          <RepositoryListView
            repositories={summaries}
            currentRepo={currentRepo}
            isLoading={isLoadingRepos}
            error={reposError}
            onRetry={() => {
              setIsLoadingRepos(true);
              void loadRepositories();
            }}
            onSelectRepo={(repo) => {
              setCurrentRepoId(repo.id);
            }}
            onAddRepository={() => void handleAddRepository()}
            onCloneRepository={(url, destination) =>
              void handleCloneRepository(url, destination)
            }
            onRemoveRepository={(repoId) => void handleRemoveRepository(repoId)}
            onRelinkRepository={(repoId, path) =>
              void handleRelinkRepository(repoId, path)
            }
            onOpenInFileManager={(path) => {
              openPathInFileManager(path).catch((err: unknown) =>
                showError("Dosya Yöneticisinde Aç", err)
              );
            }}
          />
        );
      case "changes":
        return (
          <ChangesView
            repoId={currentRepo?.id ?? null}
            currentRepo={currentRepo}
            onStatusChanged={() => {
              if (currentRepoId) void refreshCurrentStatus(currentRepoId);
            }}
          />
        );
      case "history":
        return <HistoryView repoId={currentRepo?.id ?? null} currentRepo={currentRepo} />;
      case "branches":
        return (
          <BranchesView
            repoId={currentRepo?.id ?? null}
            currentRepo={currentRepo}
            onBranchSwitched={() => {
              if (currentRepoId) void refreshCurrentStatus(currentRepoId);
            }}
          />
        );
      case "github":
        return <GitHubView />;
      case "settings":
        return (
          <SettingsView
            isDarkTheme={isDarkTheme}
            onToggleTheme={handleToggleTheme}
            environment={environment}
            appInfo={appInfo}
            settings={settings}
            onSaveSettings={handleSaveSettings}
            onError={(action, err) => showError(action, err)}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div
      className={`min-h-screen flex flex-col font-sans overflow-hidden ${
        isDarkTheme ? "dark bg-slate-950 text-slate-100" : "bg-slate-50 text-slate-900"
      }`}
    >
      <TopBar
        currentRepo={currentRepo}
        appVersion={appInfo?.version ?? null}
        onRepoClick={() => setActiveTab("repositories")}
        onSearchClick={() =>
          showNotice(
            "Global Arama",
            "Global Arama",
            "Planlanan özellik",
            "Depolar ve komutlar arasında arama henüz uygulanmadı."
          )
        }
        isDarkTheme={isDarkTheme}
        onToggleTheme={handleToggleTheme}
      />

      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          changesCount={changesCount}
          reposCount={summaries.length}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        />

        <main
          role="main"
          className="flex-1 flex overflow-hidden bg-slate-950/80 relative"
        >
          {renderActiveView()}
        </main>
      </div>

      <StatusBar
        currentRepo={currentRepo}
        environment={environment}
        appVersion={appInfo?.version ?? null}
        isSyncing={isSyncing}
        onSyncClick={() => void handleSync()}
      />

      <ActionNoticeModal
        isOpen={notice.isOpen}
        onClose={closeNotice}
        title={notice.title}
        actionName={notice.actionName}
        targetPhase={notice.context}
        details={notice.details}
        tone={notice.tone}
      />
    </div>
  );
};
