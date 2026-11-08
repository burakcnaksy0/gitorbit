import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  Key,
  Keyboard,
  Layers,
  Loader2,
  Moon,
  Shield,
  Sun,
  Terminal,
  XCircle,
} from "lucide-react";
import type {
  AppInfo,
  AppSettings,
  AppSettingsUpdate,
  GitEnvironment,
  GitHubAccount,
} from "../../types/ipc";
import {
  githubBeginLogin,
  githubDisconnectAccount,
  githubListAccounts,
  githubPollLogin,
} from "../../lib/tauriCommands";

interface SettingsViewProps {
  isDarkTheme: boolean;
  onToggleTheme: () => void;
  environment?: GitEnvironment | null;
  appInfo?: AppInfo | null;
  settings?: AppSettings | null;
  onSaveSettings?: (update: AppSettingsUpdate) => Promise<AppSettings>;
  onError?: (action: string, err: unknown) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  isDarkTheme,
  onToggleTheme,
  environment = null,
  appInfo = null,
  settings = null,
  onSaveSettings,
  onError,
}) => {
  const [accounts, setAccounts] = useState<GitHubAccount[]>([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  // CB-02: cihaz-akışı poll döngüsü bu bileşen ayrılırken (sekme değişimi)
  // durdurulmalı — aksi halde 15 dk boyunca terk edilmiş işlemin IPC'sine ve
  // hayalet setState/hatalarına devam eder.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadAccounts = useCallback(async () => {
    try {
      const list = await githubListAccounts();
      setAccounts(list);
      setAccountsError(null);
    } catch (err) {
      const e = err as { message?: string };
      setAccountsError(e.message ?? "GitHub hesapları yüklenemedi.");
    } finally {
      setIsLoadingAccounts(false);
    }
  }, []);

  useEffect(() => {
    // Deferred load (setTimeout(…, 0) convention): avoids synchronous
    // setState cascades inside the effect body.
    const timer = setTimeout(() => void loadAccounts(), 0);
    return () => clearTimeout(timer);
  }, [loadAccounts]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setAccountsError(null);
    try {
      const session = await githubBeginLogin();
      if (!mountedRef.current) return;
      // Show the user code in a modal-free way: the GitHub view owns the full
      // device-flow dialog. Here we only open the browser and start polling.
      // wry/Tauri'de window.open ölü uç olabiliyor — opener plugini tercih et.
      try {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(session.verification_uri);
      } catch {
        window.open(session.verification_uri, "_blank", "noopener,noreferrer");
      }

      const startedAt = Date.now();
      const deadline = startedAt + session.expires_in * 1000;
      const intervalMs = Math.max(session.interval, 1) * 1000;

      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        // Bileşen ayrıldıysa döngüyü terk et: terk edilmiş cihaz akışının
        // IPC trafiği ve hayalet hata bildirimi üretilmez (CB-02).
        if (!mountedRef.current) return;
        try {
          const result = await githubPollLogin(session.session_token);
          if (result.status === "success") {
            await loadAccounts();
            return;
          }
        } catch (err) {
          const code = (err as { code?: string }).code;
          if (code === "AUTHORIZATION_PENDING" || code === "DEVICE_FLOW_PENDING") {
            continue;
          }
          throw err;
        }
      }
      throw {
        code: "DEVICE_FLOW_EXPIRED",
        message: "Cihaz kodu süresi doldu. Lütfen tekrar deneyin.",
      };
    } catch (err) {
      if (!mountedRef.current) return;
      const e = err as { message?: string };
      if (onError) onError("GitHub Hesabı Bağla", err);
      else setAccountsError(e.message ?? "GitHub bağlantısı kurulamadı.");
    } finally {
      if (mountedRef.current) setConnecting(false);
    }
  }, [loadAccounts, onError]);

  const handleDisconnect = useCallback(
    async (accountId: string) => {
      try {
        await githubDisconnectAccount(accountId);
        await loadAccounts();
      } catch (err) {
        const e = err as { message?: string };
        if (onError) onError("GitHub Hesabını Ayır", err);
        else setAccountsError(e.message ?? "Hesap ayrılamadı.");
      }
    },
    [loadAccounts, onError]
  );

  const handleActiveAccountChange = useCallback(
    async (accountId: string) => {
      if (!onSaveSettings) return;
      try {
        await onSaveSettings({
          active_github_account_id: accountId === "" ? null : accountId,
        });
      } catch (err) {
        if (onError) onError("Aktif GitHub Hesabını Kaydet", err);
      }
    },
    [onError, onSaveSettings]
  );

  // v0.2 — arka plan fetch ayarları
  const [autoFetchBusy, setAutoFetchBusy] = useState(false);

  const handleAutoFetchSave = useCallback(
    async (update: AppSettingsUpdate) => {
      if (!onSaveSettings) return;
      setAutoFetchBusy(true);
      try {
        await onSaveSettings(update);
      } catch (err) {
        if (onError) onError("Otomatik Kontrolü Kaydet", err);
      } finally {
        setAutoFetchBusy(false);
      }
    },
    [onError, onSaveSettings]
  );

  const gitStatus = (() => {
    if (!environment) {
      return {
        label: "Kontrol ediliyor…",
        className: "bg-slate-800 text-slate-300 border-slate-700",
        icon: <Loader2 className="w-3 h-3 animate-spin" />,
      };
    }
    if (!environment.installed) {
      return {
        label: "Bulunamadı",
        className: "bg-rose-950/80 text-rose-400 border-rose-800",
        icon: <XCircle className="w-3 h-3" />,
      };
    }
    if (!environment.meets_minimum) {
      return {
        label: "Sürüm çok eski",
        className: "bg-amber-950/80 text-amber-400 border-amber-800",
        icon: <AlertTriangle className="w-3 h-3" />,
      };
    }
    return {
      label: "Algılandı",
      className: "bg-emerald-950/80 text-emerald-400 border-emerald-800",
      icon: <CheckCircle className="w-3 h-3" />,
    };
  })();

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6 max-w-4xl mx-auto w-full">
      <div className="pb-4 border-b border-slate-800">
        <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
          Ayarlar
        </h1>
        <p className="text-xs sm:text-sm text-slate-400 mt-1">
          Uygulama tercihleri, ortam gereksinimleri ve güvenlik ayarları.
        </p>
      </div>

      <div className="space-y-6">
        {/* Theme Settings Section */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">Arayüz Teması</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Karanlık ve aydınlık tema tercihini belirleyin.
              </p>
            </div>
            <button
              type="button"
              onClick={onToggleTheme}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-sky-400"
            >
              {isDarkTheme ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  <span>Açık Temaya Geç</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-slate-400" />
                  <span>Karanlık Temaya Geç</span>
                </>
              )}
            </button>
          </div>
        </section>

        {/* v0.2 — Arka Plan Eşitlemesi (auto-fetch) */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">
                Uzaktan Değişiklikleri Otomatik Kontrol Et
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Uygulama açıkken belirli aralıklarla fetch yapılır; uzakta yeni
                commit varsa rozetlerde görünür. Pull otomatik yapılmaz.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings?.auto_fetch ?? true}
              disabled={!onSaveSettings || autoFetchBusy}
              onClick={() =>
                void handleAutoFetchSave({ auto_fetch: !(settings?.auto_fetch ?? true) })
              }
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors cursor-pointer disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-sky-400 ${
                settings?.auto_fetch ?? true
                  ? "bg-sky-600 border-sky-500"
                  : "bg-slate-700 border-slate-600"
              }`}
              aria-label="Otomatik kontrolü aç/kapat"
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  settings?.auto_fetch ?? true ? "translate-x-[18px]" : "translate-x-[3px]"
                }`}
              />
            </button>
          </div>
          {settings?.auto_fetch ?? true ? (
            <label className="flex items-center gap-2 text-xs text-slate-300">
              Aralık:
              <select
                value={settings?.auto_fetch_minutes ?? 3}
                disabled={!onSaveSettings || autoFetchBusy}
                onChange={(e) =>
                  void handleAutoFetchSave({ auto_fetch_minutes: Number(e.target.value) })
                }
                className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-400 cursor-pointer"
                aria-label="Otomatik kontrol aralığı (dakika)"
              >
                {[1, 3, 5, 10, 15, 30, 60].map((m) => (
                  <option key={m} value={m}>
                    {m} dakika
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-[11px] text-slate-500">
              Kapalıyken uzak durum yalnızca Senkronize Et / açılışta güncellenir.
            </p>
          )}
        </section>

        {/* v0.2 madde 12 — ilk çalışma yönlendirmesi */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-100">İlk Çalışma Yönlendirmesi</h2>
              <p className="text-[11px] text-slate-400 mt-1">
                {settings?.onboarding_completed
                  ? "Kapalı — hoş geldin ekranındaki 3 adımlık rehber gizleniyor."
                  : "Açık — depo yokken hoş geldin ekranında rehber gösteriliyor."}
              </p>
            </div>
            <button
              type="button"
              disabled={!onSaveSettings || autoFetchBusy || settings?.onboarding_completed === false}
              onClick={() =>
                void handleAutoFetchSave({ onboarding_completed: false })
              }
              className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              Yeniden Göster
            </button>
          </div>
        </section>

        {/* Git Executable Environment Section */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-cyan-950/80 text-cyan-400 border border-cyan-800/60 flex items-center justify-center shrink-0">
                <Terminal className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-200">
                  Sistem Git Yapılandırması
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Yerel Git yürütücüsü ve sistem yolu kontrolü.
                </p>
              </div>
            </div>
            <span
              className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border font-mono ${gitStatus.className}`}
            >
              {gitStatus.icon}
              {gitStatus.label}
            </span>
          </div>

          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono text-xs space-y-1.5">
            <div className="flex justify-between gap-3 text-slate-400">
              <span>Git Versiyonu:</span>
              <span className="text-slate-200 truncate">
                {environment?.version ?? "—"}
              </span>
            </div>
            <div className="flex justify-between gap-3 text-slate-400">
              <span>Git İkili Yolu:</span>
              <span className="text-slate-200 truncate">
                {environment?.executable_path ?? "—"}
              </span>
            </div>
            <div className="flex justify-between gap-3 text-slate-400">
              <span>Minimum Sürüm:</span>
              <span className="text-slate-200">
                {environment?.minimum_version ?? "—"}
              </span>
            </div>
          </div>

          {environment && !environment.meets_minimum && (
            <div className="flex items-start gap-2 bg-amber-950/40 border border-amber-700/50 rounded-lg p-3 text-xs text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                GitOrbit en az{" "}
                <span className="font-mono">{environment.minimum_version}</span> sürümünü
                gerektirir. Lütfen Git&apos;i güncelleyin.
              </span>
            </div>
          )}
        </section>

        {/* GitHub Accounts */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-950/80 text-amber-400 border border-amber-800/60 flex items-center justify-center shrink-0">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-200">
                GitHub Hesapları ve Kimlik Kasası
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Token&apos;lar yalnızca işletim sisteminin kimlik kasasında tutulur.
              </p>
            </div>
          </div>

          {isLoadingAccounts ? (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Hesaplar yükleniyor…</span>
            </div>
          ) : accounts.length === 0 ? (
            <div className="text-xs text-slate-400 bg-slate-950 p-3.5 rounded-lg border border-slate-800 leading-relaxed">
              Bağlı GitHub hesabı yok. Hesap bağladığınızda OAuth token&apos;ı OS
              keychain&apos;e yazılır; SQLite&apos;a asla kaydedilmez.
            </div>
          ) : (
            <div className="space-y-2">
              {accounts.map((account) => {
                const isActive = settings?.active_github_account_id === account.id;
                return (
                  <div
                    key={account.id}
                    className="flex items-center justify-between gap-3 bg-slate-950 p-3 rounded-lg border border-slate-800"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-200 truncate">
                        {account.display_name ?? account.login}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono truncate">
                        @{account.login} • {account.connection_status}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleActiveAccountChange(account.id)}
                        disabled={!onSaveSettings || isActive}
                        className={`px-2 py-1 rounded text-[11px] font-medium border transition-colors ${
                          isActive
                            ? "bg-sky-950 text-sky-400 border-sky-800"
                            : "bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 disabled:opacity-50"
                        }`}
                      >
                        {isActive ? "Aktif" : "Aktif Yap"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDisconnect(account.id)}
                        className="px-2 py-1 rounded text-[11px] font-medium bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 transition-colors"
                      >
                        Ayır
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {accountsError && (
            <div className="flex items-center gap-2 text-xs text-rose-300">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{accountsError}</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleConnect()}
            disabled={connecting}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            {connecting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {connecting ? "Tarayıcıda onay bekleniyor…" : "Hesap Ekle"}
          </button>
        </section>

        {/* Keyboard Shortcuts Reference */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-slate-200">Klavye Kısayolları</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
            <div className="flex items-center justify-between p-2 rounded bg-slate-950/60 border border-slate-800/80">
              <span className="text-slate-400">Komut Paleti:</span>
              <kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-200 border border-slate-700">
                Ctrl + K
              </kbd>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-slate-950/60 border border-slate-800/80">
              <span className="text-slate-400">Değişikliklere Git:</span>
              <kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-200 border border-slate-700">
                Ctrl + G
              </kbd>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-slate-950/60 border border-slate-800/80">
              <span className="text-slate-400">Sekme Gezinmesi:</span>
              <kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-200 border border-slate-700">
                Tab / Shift+Tab
              </kbd>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-slate-950/60 border border-slate-800/80">
              <span className="text-slate-400">Aktif Eylem:</span>
              <kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-200 border border-slate-700">
                Enter / Space
              </kbd>
            </div>
          </div>
        </section>

        {/* Application Info */}
        <section className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs text-slate-500 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Layers className="w-4 h-4 text-sky-400 shrink-0" />
            <span className="truncate">
              {appInfo
                ? `${appInfo.name} v${appInfo.version} • ${appInfo.os}/${appInfo.arch}`
                : "GitOrbit • sürüm bilgisi yükleniyor…"}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            <span>Açık Kaynak &amp; Local-first</span>
          </div>
        </section>
      </div>
    </div>
  );
};
