import React, { useCallback, useEffect, useMemo, useState } from "react";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { ActionNoticeModal } from "../common/ActionNoticeModal";
import { CommandPalette, type PaletteItem } from "../common/CommandPalette";
import { SyncAllModal, summarizeSync } from "../common/SyncAllModal";
import { WelcomeView } from "../../features/welcome/WelcomeView";
import { OnboardingCards } from "../../features/welcome/OnboardingCards";
import { RepositoryListView } from "../../features/repositories/RepositoryListView";
import {
  NotGitChoiceModal,
  PublishRepoModal,
} from "../../features/repositories/PublishDialogs";
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
  BranchInfo,
  CommitInfo,
  GitEnvironment,
  GitStatus,
  GitHubPublishResult,
  RepositoryRecord,
} from "../../types/ipc";
import {
  appGetEnvironment,
  appGetInfo,
  repositoryAdd,
  repositoryCheckoutBranch,
  repositoryInit,
  repositoryClone,
  repositoryFetch,
  repositoryGetBranches,
  repositoryPull,
  repositoryPush,
  repositoryGetHistory,
  repositoryGetStatus,
  repositoryList,
  repositoryRelink,
  repositoryRemove,
  repositorySetPinned,
  openPathInFileManager,
  settingsGet,
  settingsUpdate,
} from "../../lib/tauriCommands";
import { pickDirectory } from "../../lib/directoryPicker";
import { notifySystem } from "../../lib/notifications";
import { useAutoFetch } from "../../lib/useAutoFetch";
import { useFolderDrop } from "../../lib/useFolderDrop";
import { useNotify } from "../common/Toast";
import { errorCode, errorMessage, errorHint } from "../../lib/errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// CB-08: hata ayrıştırma merkezi modülde (lib/errors) — Shell, GitHubView ve
// PublishDialogs aynı kaynağı kullanır; recovery_hint hiçbir gösterim
// noktasında kaybolmaz. (import yukarıda)

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

// CB-03 bayat-tur sayacı: modül düzeyinde monoton sayaç. (Ref yerine:
// loadRepositories'i yakalayan palet kapanları render-fazında "ref okuyan
// fonksiyon" uyarısı veriyordu — React Compiler'ın refs kuralı. Monoton
// sayaç tek örnek uygulama için birebir aynı garantidir; testlerdeki tekrar
// tekrar mount durumunda da doğru çalışır, çünkü her yeni tur büyük seq alır.)
let loadSeqCounter = 0;

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export const Shell: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavigationTab>("welcome");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isDarkTheme, setIsDarkTheme] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isPushing, setIsPushing] = useState(false);

  // Backend state -----------------------------------------------------------
  const [repositories, setRepositories] = useState<RepositoryRecord[]>([]);
  const [statuses, setStatuses] = useState<Record<string, GitStatus>>({});
  const [lastCommits, setLastCommits] = useState<Record<string, CommitInfo | undefined>>(
    {}
  );
  const [currentRepoId, setCurrentRepoId] = useState<string | null>(null);

  const [isLoadingRepos, setIsLoadingRepos] = useState(true);
  const [reposError, setReposError] = useState<string | null>(null);
  // "Folder is not a Git repo" choice flow + publish-to-GitHub dialog.
  const [notGitPath, setNotGitPath] = useState<string | null>(null);
  const [initBusy, setInitBusy] = useState(false);
  const [publishTarget, setPublishTarget] = useState<{
    repoId: string;
    name: string;
  } | null>(null);

  const [environment, setEnvironment] = useState<GitEnvironment | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const [notice, setNotice] = useState<NoticeState>(CLOSED_NOTICE);
  const notify = useNotify();

  // v0.2 — Komut paleti + sürükle-bırak state
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteBranches, setPaletteBranches] = useState<BranchInfo[]>([]);
  // v0.2 — "Tümünü eşitle" modalı (madde 8)
  const [syncAllKind, setSyncAllKind] = useState<"pull" | "push" | null>(null);

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
    const seq = ++loadSeqCounter;
    try {
      const records = await repositoryList();
      if (loadSeqCounter !== seq) return; // CB-03: bayat tur
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
      // Tarama bitti ama bu arada daha yeni bir tur başladıysa bu turun
      // toplu sonuçları uygulamaz (CB-03).
      if (loadSeqCounter !== seq) return;
      // Toplu DEĞİŞTİRME değil birleştirme: bu sırada yazan auto-fetch/
      // mutasyon güncellemeleri silinmesin.
      setStatuses((prev) => ({ ...prev, ...statusEntries }));
      setLastCommits((prev) => ({ ...prev, ...commitEntries }));
      setCurrentRepoId((prev) => {
        if (prev && records.some((r) => r.id === prev)) return prev;
        return records[0]?.id ?? null;
      });
    } catch (err) {
      if (loadSeqCounter !== seq) return;
      setReposError(errorMessage(err));
      setRepositories([]);
      setStatuses({});
      setLastCommits({});
      setCurrentRepoId(null);
    } finally {
      if (loadSeqCounter === seq) setIsLoadingRepos(false);
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
        pinned: record.pinned,
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

  // v0.2 — toplam bekleyen uzak commit (Sidebar rozeti)
  const totalIncoming = useMemo(
    () => summaries.reduce((sum, repo) => sum + (repo.behind ?? 0), 0),
    [summaries]
  );

  // -------------------------------------------------------------------------
  // v0.2 — Arka plan fetch (madde 4)
  // -------------------------------------------------------------------------

  const applyFetchedStatus = useCallback((repoId: string, status: GitStatus) => {
    setStatuses((prev) => ({ ...prev, [repoId]: status }));
  }, []);

  useAutoFetch({
    enabled: settings?.auto_fetch ?? false,
    minutes: settings?.auto_fetch_minutes ?? 3,
    repositories,
    onStatus: applyFetchedStatus,
  });

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
        notify.success("Depo açıldı", record.display_name);
      } catch (err) {
        // Plain folder: offer to git-init it (locally or published to GitHub)
        // instead of dead-ending with NOT_A_GIT_REPOSITORY.
        const code = (err as AppError)?.code;
        if (code === "NOT_A_GIT_REPOSITORY") {
          setNotGitPath(path);
          return;
        }
        showError("Depo Ekle", err);
      }
    },
    [loadRepositories, notify, showError]
  );

  // "Git deposu olarak başlat" — init + register, then continue normally.
  const handleInitLocal = useCallback(async () => {
    if (!notGitPath) return;
    setInitBusy(true);
    try {
      const record = await repositoryInit(notGitPath);
      setNotGitPath(null);
      await loadRepositories();
      setCurrentRepoId(record.id);
      setActiveTab("changes");
      notify.success("Git deposu başlatıldı", record.display_name);
    } catch (err) {
      setNotGitPath(null);
      showError("Git Deposu Başlat", err);
    } finally {
      setInitBusy(false);
    }
  }, [notGitPath, loadRepositories, showError]);

  // "Başlat ve GitHub'da yayınla" — init first, then open the publish form.
  const handleInitAndPublish = useCallback(async () => {
    if (!notGitPath) return;
    setInitBusy(true);
    try {
      const record = await repositoryInit(notGitPath);
      setNotGitPath(null);
      await loadRepositories();
      setCurrentRepoId(record.id);
      setPublishTarget({ repoId: record.id, name: record.display_name });
    } catch (err) {
      setNotGitPath(null);
      showError("Git Deposu Başlat", err);
    } finally {
      setInitBusy(false);
    }
  }, [notGitPath, loadRepositories, showError]);

  // Later publishing for any registered repo that has no origin yet.
  const handlePublishRequest = useCallback((repo: RepositorySummary) => {
    setPublishTarget({ repoId: repo.id, name: repo.name });
  }, []);

  const handlePublished = useCallback(
    async (result: GitHubPublishResult) => {
      await loadRepositories();
      if (result.pushed) {
        notify.success(
          "GitHub'da yayınlandı",
          result.warning ? `${result.html_url} — ${result.warning}` : result.html_url
        );
        void notifySystem("Depo yayınlandı", result.html_url);
      } else {
        notify.warning(
          "GitHub'da oluşturuldu — push tamamlanamadı",
          result.warning ?? result.html_url
        );
        void notifySystem(
          "Yayınlama yarım kaldı",
          `Repo oluşturuldu ancak push edilemedi — ${result.html_url}`
        );
      }
    },
    [loadRepositories, notify]
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
        notify.success("Depo klonlandı", result.repository.display_name);
        void notifySystem("Depo klonlandı", result.repository.display_name);
      } catch (err) {
        showError("Depo Klonla", err);
        void notifySystem("Klonlama başarısız", errorMessage(err));
      }
    },
    [loadRepositories, notify, showError]
  );

  const handleRemoveRepository = useCallback(
    async (repoId: string) => {
      try {
        await repositoryRemove(repoId);
        await loadRepositories();
        notify.info(
          "Depo listesinden çıkarıldı",
          repositories.find((r) => r.id === repoId)?.display_name
        );
      } catch (err) {
        showError("Depo Kaydını Kaldır", err);
      }
    },
    [loadRepositories, notify, repositories, showError]
  );

  /** v0.2 madde 10 — sabitlemeyi aç/kapat (yalnızca DB meta verisi). */
  const handleTogglePin = useCallback(
    async (repo: RepositorySummary) => {
      try {
        await repositorySetPinned(repo.id, !(repo.pinned ?? false));
        await loadRepositories();
      } catch (err) {
        showError("Sabitle", err);
      }
    },
    [loadRepositories, showError]
  );

  const handleRelinkRepository = useCallback(
    async (repoId: string, newPath: string) => {
      try {
        await repositoryRelink(repoId, newPath);
        await loadRepositories();
        notify.success("Depo yeniden bağlandı", newPath);
      } catch (err) {
        showError("Depoyu Yeniden Bağla", err);
      }
    },
    [loadRepositories, notify, showError]
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
      notify.info(
        "Senkronize edildi",
        `origin güncellendi${status.behind ? ` — ${status.behind} yeni commit var` : ""}`
      );
    } catch (err) {
      showError("Senkronize Et (Fetch)", err);
    } finally {
      setIsSyncing(false);
    }
  }, [currentRepoId, notify, showError]);

  // Pull: backend refuses destructive/unsafe states (dirty tree, conflicts)
  // with typed errors — surfaced verbatim through the notice modal.
  const handlePull = useCallback(async () => {
    if (!currentRepoId) return;
    setIsPulling(true);
    try {
      const incoming = currentRepo?.behind ?? 0;
      const status = await repositoryPull(currentRepoId);
      setStatuses((prev) => ({ ...prev, [currentRepoId]: status }));
      // New commits landed locally — refresh summaries (last commit, branch).
      await loadRepositories();
      notify.success(
        "İçe aktarma tamamlandı",
        incoming > 0
          ? `${incoming} yeni commit → ${status.branch ?? currentRepo?.currentBranch ?? "dal"}`
          : `${status.branch ?? currentRepo?.currentBranch ?? "dal"} zaten günceldi`
      );
    } catch (err) {
      showError("İçe Aktar (Pull)", err);
    } finally {
      setIsPulling(false);
    }
  }, [currentRepoId, currentRepo, loadRepositories, notify, showError]);

  // Push: never auto-forces; non-fast-forward arrives as REMOTE_REJECTED.
  // A branch without upstream is published with --set-upstream (origin/<branch>),
  // mirroring the "Publish Branch" convention instead of failing with NO_UPSTREAM.
  const handlePush = useCallback(async () => {
    if (!currentRepoId) return;
    setIsPushing(true);
    try {
      const publish = !currentRepo?.upstream;
      const branch = currentRepo?.currentBranch ?? "HEAD";
      const outgoing = currentRepo?.ahead ?? 0;
      const status = await repositoryPush(currentRepoId, null, null, false, publish);
      setStatuses((prev) => ({ ...prev, [currentRepoId]: status }));
      await loadRepositories();
      notify.success(
        publish ? "Dal yayınlandı" : "Push tamamlandı",
        `${outgoing} commit → origin/${branch}`
      );
    } catch (err) {
      showError("Dışa Aktar (Push)", err);
      // Uzak reddetti (non-fast-forward vb.) ve kullanıcı muhtemelen pencerede
      // değil — OS bildirimi dikkat çeksin.
      if (errorCode(err) === "REMOTE_REJECTED") {
        void notifySystem("Push reddedildi", errorMessage(err));
      }
    } finally {
      setIsPushing(false);
    }
  }, [currentRepoId, currentRepo, loadRepositories, notify, showError]);

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
  // v0.2 — Komut paleti (madde 5): Ctrl+K / Ctrl+Shift+P
  // -------------------------------------------------------------------------

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (key === "k" || (key === "p" && e.shiftKey))) {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Palet açılınca aktif deponun dallarını tazele (bayat listeyle checkout yok).
  useEffect(() => {
    if (!paletteOpen || !currentRepo?.id) {
      return;
    }
    let ignore = false;
    void repositoryGetBranches(currentRepo.id)
      .then((branches) => {
        if (!ignore) setPaletteBranches(branches.filter((b) => !b.is_remote));
      })
      .catch(() => {
        if (!ignore) setPaletteBranches([]);
      });
    return () => {
      ignore = true;
    };
  }, [paletteOpen, currentRepo?.id]);

  const handlePaletteCheckout = useCallback(
    async (branch: string) => {
      if (!currentRepo?.id) return;
      try {
        await repositoryCheckoutBranch(currentRepo.id, branch);
        await loadRepositories();
        notify.success("Dala geçildi", branch);
      } catch (err) {
        showError("Dala Geç", err);
      }
    },
    [currentRepo, loadRepositories, notify, showError]
  );

  const paletteItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [
      {
        id: "tab.welcome",
        section: "Sekmeler",
        label: "Genel Bakış",
        run: () => setActiveTab("welcome"),
      },
      {
        id: "tab.repositories",
        section: "Sekmeler",
        label: "Depolar",
        run: () => setActiveTab("repositories"),
      },
      {
        id: "tab.changes",
        section: "Sekmeler",
        label: "Değişiklikler",
        run: () => setActiveTab("changes"),
      },
      {
        id: "tab.history",
        section: "Sekmeler",
        label: "Geçmiş",
        run: () => setActiveTab("history"),
      },
      {
        id: "tab.branches",
        section: "Sekmeler",
        label: "Dallar",
        run: () => setActiveTab("branches"),
      },
      {
        id: "tab.github",
        section: "Sekmeler",
        label: "GitHub",
        run: () => setActiveTab("github"),
      },
      {
        id: "tab.settings",
        section: "Sekmeler",
        label: "Ayarlar",
        run: () => setActiveTab("settings"),
      },
    ];

    for (const repo of summaries) {
      items.push({
        id: `repo.${repo.id}`,
        section: "Depolar",
        label: repo.name,
        hint: repo.path,
        run: () => {
          setCurrentRepoId(repo.id);
          setActiveTab("changes");
        },
      });
    }

    for (const branch of paletteBranches) {
      if (branch.is_current) continue;
      items.push({
        id: `branch.${currentRepo?.id ?? "?"}.${branch.name}`,
        section: "Dallar",
        label: `Dala geç: ${branch.name}`,
        hint: currentRepo?.name,
        run: () => void handlePaletteCheckout(branch.name),
      });
    }

    items.push(
      {
        id: "action.add-repo",
        section: "İşlemler",
        label: "Depo Ekle",
        hint: "Klasörden kaydet",
        run: () => void handleAddRepository(),
      },
      {
        id: "action.clone",
        section: "İşlemler",
        label: "GitHub'dan Klonla",
        hint: "Depolar sekmesi",
        run: () => setActiveTab("repositories"),
      },
      {
        id: "action.sync",
        section: "İşlemler",
        label: "Senkronize Et (Fetch)",
        hint: currentRepo?.name,
        run: () => void handleSync(),
      },
      {
        id: "action.pull",
        section: "İşlemler",
        label: "İçe Aktar (Pull)",
        hint: currentRepo?.name,
        run: () => void handlePull(),
      },
      {
        id: "action.push",
        section: "İşlemler",
        label: "Dışa Aktar (Push)",
        hint: currentRepo?.name,
        run: () => void handlePush(),
      }
    );

    if (currentRepo && !currentRepo.upstream) {
      items.push({
        id: "action.publish",
        section: "İşlemler",
        label: "GitHub'da Yayınla",
        hint: `${currentRepo.name} · origin yok`,
        run: () => setPublishTarget({ repoId: currentRepo.id, name: currentRepo.name }),
      });
    }

    return items;
  }, [
    currentRepo,
    handleAddRepository,
    handlePaletteCheckout,
    handlePull,
    handlePush,
    handleSync,
    paletteBranches,
    summaries,
  ]);

  // -------------------------------------------------------------------------
  // v0.2 — Klasör sürükle-bırak (madde 9)
  // -------------------------------------------------------------------------

  const { isDragging } = useFolderDrop(
    useCallback(
      (paths: string[]) => {
        if (paths.length === 0) return;
        if (paths.length > 1) {
          notify.info("Birden fazla öğe bırakıldı", `İlk klasör ekleniyor: ${paths[0]}`);
        }
        void openRepository(paths[0]);
      },
      [notify, openRepository]
    )
  );

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------

  const renderActiveView = () => {
    switch (activeTab) {
      case "welcome": {
        // v0.2 madde 12: onboarding yalnızca ayar açıkken, depo listesi
        // yüklendikten SONRA ve hiç depo yokken görünür — açılış yarışında
        // (önce ayar, sonra liste gelir) kurulmuş kullanıcıya göz kırpmaz.
        const showOnboarding =
          settings !== null &&
          !isLoadingRepos &&
          !settings.onboarding_completed &&
          repositories.length === 0;
        return (
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {showOnboarding && (
              <div className="px-4 sm:px-8 pt-4 sm:pt-6 max-w-6xl mx-auto w-full shrink-0">
                <OnboardingCards
                  hasRepositories={repositories.length > 0}
                  onConnectGitHub={() => setActiveTab("github")}
                  onAddRepository={() => void handleAddRepository()}
                  onStartFirstTask={() =>
                    setActiveTab(currentRepoId ? "changes" : "repositories")
                  }
                  onDismiss={() =>
                    void handleSaveSettings({ onboarding_completed: true }).catch(
                      () => {}
                    )
                  }
                />
              </div>
            )}
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
          </div>
        );
      }
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
            onRelinkRepository={(repoId, path) => handleRelinkRepository(repoId, path)}
            onOpenInFileManager={(path) => {
              openPathInFileManager(path).catch((err: unknown) =>
                showError("Dosya Yöneticisinde Aç", err)
              );
            }}
            onPublishRequest={handlePublishRequest}
            onTogglePin={(repo) => void handleTogglePin(repo)}
          />
        );
      case "changes":
        return (
          <ChangesView
            // CB-06 (WP-10a sürümü): depo değişimi = taze mount. Eski deponun
            // dosya seçimi/diff/commit taslağı yeni depoya taşınmaz — bunu
            // eskiden effect içindeki reset setState'ler yapıyordu; React
            // "sıfırlama için key" desenini öneriyor.
            key={currentRepo?.id ?? "none"}
            repoId={currentRepo?.id ?? null}
            currentRepo={currentRepo}
            onStatusChanged={() => {
              if (currentRepoId) void refreshCurrentStatus(currentRepoId);
            }}
          />
        );
      case "history":
        return (
          <HistoryView
            key={currentRepo?.id ?? "none"}
            repoId={currentRepo?.id ?? null}
            currentRepo={currentRepo}
          />
        );
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
        onSearchClick={() => setPaletteOpen(true)}
        isDarkTheme={isDarkTheme}
        onToggleTheme={handleToggleTheme}
      />

      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          changesCount={changesCount}
          reposCount={summaries.length}
          incomingCount={totalIncoming}
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
        isPulling={isPulling}
        isPushing={isPushing}
        onSyncClick={() => void handleSync()}
        onPullClick={() => void handlePull()}
        onPushClick={() => void handlePush()}
        onSyncAllPull={() => setSyncAllKind("pull")}
        onSyncAllPush={() => setSyncAllKind("push")}
        syncAllRunning={syncAllKind !== null}
      />

      {syncAllKind && (
        <SyncAllModal
          key={syncAllKind}
          kind={syncAllKind}
          onClose={() => setSyncAllKind(null)}
          onFinished={(outcomes) => {
            void loadRepositories();
            if (outcomes.length > 0) {
              notify.info(
                syncAllKind === "pull"
                  ? "İçe aktarma tamamlandı"
                  : "Dışa aktarma tamamlandı",
                summarizeSync(outcomes)
              );
            }
          }}
        />
      )}

      {notGitPath && (
        <NotGitChoiceModal
          path={notGitPath}
          busy={initBusy}
          onInitLocal={() => void handleInitLocal()}
          onInitAndPublish={() => void handleInitAndPublish()}
          onClose={() => setNotGitPath(null)}
        />
      )}

      {publishTarget && (
        <PublishRepoModal
          key={publishTarget.repoId}
          repoId={publishTarget.repoId}
          defaultName={publishTarget.name}
          onClose={() => setPublishTarget(null)}
          onPublished={(res) => void handlePublished(res)}
        />
      )}

      {paletteOpen && (
        <CommandPalette items={paletteItems} onClose={() => setPaletteOpen(false)} />
      )}

      {/* v0.2 — klasör bırakma overlay'i (madde 9) */}
      {isDragging && (
        <div
          className="fixed inset-0 z-[70] pointer-events-none flex items-center justify-center bg-sky-950/70 backdrop-blur-sm"
          aria-hidden="true"
        >
          <div className="rounded-2xl border-2 border-dashed border-sky-400 bg-slate-900/90 px-10 py-8 text-center">
            <p className="text-lg font-bold text-sky-200">Klasörü buraya bırakın</p>
            <p className="text-xs text-slate-400 mt-1">
              Git deposu olarak açılacak · düz klasörse başlatma seçenekleri sunulacak
            </p>
          </div>
        </div>
      )}

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
