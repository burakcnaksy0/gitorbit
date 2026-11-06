/**
 * GitOrbit — GitHub Accounts View (Phase 6)
 *
 * Features:
 * - Lists connected GitHub accounts (no token shown)
 * - Device-flow login: shows user_code + opens verification_uri in browser
 * - Polls until success, expired, or denied
 * - Repository listing with pagination per account
 * - Disconnect account (with confirmation)
 * - Full loading / error / empty / offline state coverage
 * - SECURITY: Token never displayed or transmitted to this component
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  RefreshCw,
  LogOut,
  ChevronRight,
  ChevronLeft,
  ExternalLink,
  Lock,
  Star,
  GitFork,
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
  Copy,
  Check,
  Building2,
  MapPin,
} from "lucide-react";
import type {
  AppError,
  DeviceFlowSession,
  GitHubAccount,
  GitHubProfile,
  GitHubRepo,
  GitHubRepoPage,
} from "../../types/ipc";
import { GithubIcon } from "../../components/common/GithubIcon";
import {
  githubBeginLogin,
  githubPollLogin,
  githubListAccounts,
  githubDisconnectAccount,
  githubListRepos,
  githubGetAccountProfile,
} from "../../lib/tauriCommands";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewState =
  | { kind: "accounts" }
  | { kind: "login-start"; session: DeviceFlowSession }
  | { kind: "login-polling"; session: DeviceFlowSession }
  | {
      kind: "profile";
      account: GitHubAccount;
      profile: GitHubProfile | null;
    }
  | {
      kind: "repos";
      account: GitHubAccount;
      page: GitHubRepoPage | null;
      currentPage: number;
    };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatError(err: AppError): string {
  switch (err.code) {
    case "AUTH_REQUIRED":
    case "AUTH_EXPIRED":
      return "Kimlik doğrulama gerekiyor. Lütfen tekrar bağlanın.";
    case "RATE_LIMITED":
      return "GitHub API istek sınırı aşıldı. Lütfen daha sonra tekrar deneyin.";
    case "PERMISSION_DENIED":
      return "Bu kaynak için izniniz yok veya kapsam yetersiz.";
    case "NOT_FOUND":
      return "Kaynak bulunamadı veya erişim izniniz yok.";
    case "CREDENTIAL_STORE_UNAVAILABLE":
      return "İşletim sistemi kimlik deposu kullanılamıyor. GitHub hesabı bağlanamaz.";
    case "DEVICE_FLOW_EXPIRED":
      return "Oturum süresi doldu. Lütfen tekrar başlatın.";
    case "NETWORK_ERROR":
      return "Ağ hatası. İnternet bağlantınızı kontrol edin.";
    case "SERVER_ERROR":
      return "GitHub sunucu hatası. Daha sonra tekrar deneyin.";
    default:
      return err.message || "Bilinmeyen hata.";
  }
}

// ---------------------------------------------------------------------------
// Sub-component: AccountCard
// ---------------------------------------------------------------------------

interface AccountCardProps {
  account: GitHubAccount;
  onViewRepos: (account: GitHubAccount) => void;
  onViewProfile: (account: GitHubAccount) => void;
  onDisconnect: (account: GitHubAccount) => void;
  disconnecting: boolean;
}

const AccountCard: React.FC<AccountCardProps> = ({
  account,
  onViewRepos,
  onViewProfile,
  onDisconnect,
  disconnecting,
}) => {
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const statusColor =
    account.connection_status === "connected"
      ? "text-emerald-400"
      : account.connection_status === "auth_expired"
        ? "text-amber-400"
        : "text-red-400";

  const statusLabel =
    account.connection_status === "connected"
      ? "Bağlı"
      : account.connection_status === "auth_expired"
        ? "Süresi Doldu"
        : "Kimlik Doğrulama Gerekiyor";

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 hover:border-slate-700 transition-colors">
      <div className="flex items-center gap-3">
        {account.avatar_url ? (
          <img
            src={account.avatar_url}
            alt={`${account.login} avatar`}
            className="w-10 h-10 rounded-full border border-slate-700 object-cover"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
            <GithubIcon className="w-5 h-5 text-slate-400" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">
            {account.display_name || account.login}
          </p>
          <p className="text-xs text-slate-400 truncate">@{account.login}</p>
        </div>
        <span className={`text-xs font-medium ${statusColor}`}>{statusLabel}</span>
      </div>

      <div className="flex gap-2">
        <button
          id={`view-repos-${account.id}`}
          type="button"
          onClick={() => onViewRepos(account)}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 text-sky-400 text-xs font-medium border border-sky-700/40 transition-colors focus:outline-none focus:ring-1 focus:ring-sky-400 cursor-pointer"
        >
          <GithubIcon className="w-3.5 h-3.5" />
          Repolar
        </button>

        <button
          id={`view-profile-${account.id}`}
          type="button"
          onClick={() => onViewProfile(account)}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-colors focus:outline-none focus:ring-1 focus:ring-slate-600 cursor-pointer"
        >
          <Building2 className="w-3.5 h-3.5" />
          Profil
        </button>

        {confirmDisconnect ? (
          <div className="flex gap-1.5">
            <button
              id={`confirm-disconnect-${account.id}`}
              type="button"
              onClick={() => onDisconnect(account)}
              disabled={disconnecting}
              aria-label="Evet, Ayır"
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 text-xs font-medium border border-red-700/40 transition-colors focus:outline-none focus:ring-1 focus:ring-red-400 cursor-pointer disabled:opacity-50"
            >
              {disconnecting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <LogOut className="w-3.5 h-3.5" />
              )}
              Ayır
            </button>
            <button
              type="button"
              onClick={() => setConfirmDisconnect(false)}
              aria-label="Vazgeç"
              className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs border border-slate-700 transition-colors focus:outline-none cursor-pointer"
            >
              İptal
            </button>
          </div>
        ) : (
          <button
            id={`disconnect-${account.id}`}
            type="button"
            onClick={() => setConfirmDisconnect(true)}
            title="Bağlantıyı Kes"
            aria-label="Bağlantıyı Kes"
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-red-900/20 text-slate-400 hover:text-red-400 text-xs font-medium border border-slate-700 hover:border-red-700/40 transition-colors focus:outline-none focus:ring-1 focus:ring-slate-600 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sub-component: ProfilePanel
// ---------------------------------------------------------------------------

interface ProfilePanelProps {
  account: GitHubAccount;
  profile: GitHubProfile | null;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onRetry: () => void;
}

function formatJoinDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("tr-TR", { year: "numeric", month: "long" });
}

const ProfileStat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="flex flex-col items-center px-4 py-2 rounded-lg bg-slate-900/80 border border-slate-800 min-w-20">
    <span className="text-lg font-bold text-white tabular-nums">
      {value.toLocaleString("tr-TR")}
    </span>
    <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
  </div>
);

const ProfilePanel: React.FC<ProfilePanelProps> = ({
  account,
  profile,
  loading,
  error,
  onBack,
  onRetry,
}) => {
  const joined = formatJoinDate(profile?.created_at ?? null);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
        <button
          id="back-from-profile"
          type="button"
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors focus:outline-none cursor-pointer"
          aria-label="Hesaplara dön"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <h2 className="text-sm font-semibold text-white">@{account.login} — Profil</h2>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <AlertCircle className="w-8 h-8 text-red-400 opacity-60" />
          <p className="text-sm text-slate-400">{error}</p>
          <button
            id="retry-profile"
            type="button"
            onClick={onRetry}
            className="text-xs text-sky-400 hover:text-sky-300 underline focus:outline-none cursor-pointer"
          >
            Tekrar dene
          </button>
        </div>
      ) : profile ? (
        <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-6 space-y-5">
          <div className="flex items-start gap-4">
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={`${profile.login} avatar`}
                className="w-20 h-20 rounded-full border-2 border-slate-700 object-cover"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-slate-800 border-2 border-slate-700 flex items-center justify-center">
                <GithubIcon className="w-9 h-9 text-slate-400" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-lg font-bold text-white truncate">
                {profile.name || profile.login}
              </p>
              <p className="text-sm text-slate-400 truncate">@{profile.login}</p>
              <a
                href={profile.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1.5 text-xs text-sky-400 hover:text-sky-300 transition-colors focus:outline-none"
              >
                github.com/{profile.login}
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {profile.bio && (
            <p className="text-sm text-slate-300 leading-relaxed">{profile.bio}</p>
          )}

          {(profile.company || profile.location || joined) && (
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-400">
              {profile.company && (
                <span className="inline-flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-slate-500" />
                  {profile.company}
                </span>
              )}
              {profile.location && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-slate-500" />
                  {profile.location}
                </span>
              )}
              {joined && (
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-500" />
                  Katılım: {joined}
                </span>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <ProfileStat label="Repo" value={profile.public_repos} />
            <ProfileStat label="Takipçi" value={profile.followers} />
            <ProfileStat label="Takip" value={profile.following} />
          </div>
        </div>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sub-component: DeviceFlowPanel
// ---------------------------------------------------------------------------

interface DeviceFlowPanelProps {
  session: DeviceFlowSession;
  polling: boolean;
  error: string | null;
  onStartPolling: () => void;
  onCancel: () => void;
  copied: boolean;
  onCopy: () => void;
}

const DeviceFlowPanel: React.FC<DeviceFlowPanelProps> = ({
  session,
  polling,
  error,
  onStartPolling,
  onCancel,
  copied,
  onCopy,
}) => (
  <div className="max-w-lg mx-auto space-y-6">
    <div className="text-center space-y-2">
      <div className="w-14 h-14 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mx-auto">
        <GithubIcon className="w-7 h-7 text-white" />
      </div>
      <h2 className="text-lg font-semibold text-white">GitHub ile Giriş Yap</h2>
      <p className="text-sm text-slate-400">
        Aşağıdaki kodu GitHub'da girin ve ardından "Doğrulamayı Başlat" düğmesine basın.
      </p>
    </div>

    {/* User code */}
    <div className="bg-slate-900/80 border border-slate-700 rounded-xl p-5 text-center space-y-3">
      <p className="text-xs text-slate-400 uppercase tracking-widest">Kullanıcı Kodu</p>
      <div className="flex items-center justify-center gap-3">
        <span className="text-3xl font-mono font-bold text-white tracking-[0.25em]">
          {session.user_code}
        </span>
        <button
          id="copy-user-code"
          type="button"
          onClick={onCopy}
          title="Kodu kopyala"
          className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors focus:outline-none focus:ring-1 focus:ring-sky-400 cursor-pointer"
        >
          {copied ? (
            <Check className="w-4 h-4 text-emerald-400" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </button>
      </div>
      <a
        id="open-github-verification"
        href={session.verification_uri}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 transition-colors"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        {session.verification_uri}
      </a>
    </div>

    {error && (
      <div className="flex items-start gap-2 p-3 rounded-lg bg-red-900/20 border border-red-700/40 text-sm text-red-300">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{error}</span>
      </div>
    )}

    <div className="flex gap-3">
      {polling ? (
        <div className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-slate-300">
          <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
          <span>Yetkilendirme bekleniyor…</span>
        </div>
      ) : (
        <button
          id="start-polling"
          type="button"
          onClick={onStartPolling}
          className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400 cursor-pointer"
        >
          <CheckCircle className="w-4 h-4" />
          Doğrulamayı Başlat
        </button>
      )}
      <button
        id="cancel-login"
        type="button"
        onClick={onCancel}
        className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm border border-slate-700 transition-colors focus:outline-none focus:ring-1 focus:ring-slate-600 cursor-pointer"
      >
        İptal
      </button>
    </div>

    <div className="flex items-center gap-2 text-xs text-slate-500">
      <Clock className="w-3.5 h-3.5 shrink-0" />
      <span>Bu kod {Math.ceil(session.expires_in / 60)} dakika içinde sona erecek.</span>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Sub-component: ReposPanel
// ---------------------------------------------------------------------------

interface ReposPanelProps {
  account: GitHubAccount;
  page: GitHubRepoPage | null;
  currentPage: number;
  loading: boolean;
  error: string | null;
  onNextPage: () => void;
  onPrevPage: () => void;
  onBack: () => void;
}

const ReposPanel: React.FC<ReposPanelProps> = ({
  account,
  page,
  currentPage,
  loading,
  error,
  onNextPage,
  onPrevPage,
  onBack,
}) => (
  <div className="space-y-4">
    <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
      <button
        id="back-to-accounts"
        type="button"
        onClick={onBack}
        className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors focus:outline-none cursor-pointer"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      {account.avatar_url && (
        <img
          src={account.avatar_url}
          alt=""
          className="w-6 h-6 rounded-full border border-slate-700"
        />
      )}
      <h2 className="text-sm font-semibold text-white">@{account.login} — Repolar</h2>
    </div>

    {error && (
      <div className="flex items-start gap-2 p-3 rounded-lg bg-red-900/20 border border-red-700/40 text-sm text-red-300">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{error}</span>
      </div>
    )}

    {loading ? (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
      </div>
    ) : page && page.repos.length > 0 ? (
      <div className="space-y-2">
        {page.repos.map((repo) => (
          <RepoRow key={repo.id} repo={repo} />
        ))}
      </div>
    ) : (
      !error && (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
          <GithubIcon className="w-8 h-8 opacity-40" />
          <p className="text-sm">Bu hesaba ait repo bulunamadı.</p>
        </div>
      )
    )}

    {page && (page.has_more || currentPage > 1) && (
      <div className="flex items-center justify-between pt-2 border-t border-slate-800">
        <button
          id="prev-page"
          type="button"
          onClick={onPrevPage}
          disabled={currentPage <= 1 || loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs border border-slate-700 transition-colors focus:outline-none disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Önceki
        </button>
        <span className="text-xs text-slate-500">Sayfa {currentPage}</span>
        <button
          id="next-page"
          type="button"
          onClick={onNextPage}
          disabled={!page?.has_more || loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs border border-slate-700 transition-colors focus:outline-none disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
        >
          Sonraki
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// Sub-component: RepoRow
// ---------------------------------------------------------------------------

const RepoRow: React.FC<{ repo: GitHubRepo }> = ({ repo }) => (
  <a
    href={repo.html_url}
    target="_blank"
    rel="noopener noreferrer"
    className="group flex items-start gap-3 p-3 rounded-lg bg-slate-900/60 hover:bg-slate-800/60 border border-slate-800 hover:border-slate-700 transition-colors"
    aria-label={`${repo.full_name} — ${repo.description || "Açıklama yok"}`}
  >
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-sm font-medium text-sky-400 group-hover:text-sky-300 transition-colors truncate">
          {repo.name}
        </span>
        {repo.private && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs bg-amber-900/30 text-amber-400 border border-amber-700/40">
            <Lock className="w-2.5 h-2.5" />
            Özel
          </span>
        )}
        {repo.fork && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs bg-slate-800 text-slate-400 border border-slate-700">
            <GitFork className="w-2.5 h-2.5" />
            Çatal
          </span>
        )}
      </div>
      {repo.description && (
        <p className="text-xs text-slate-400 mt-0.5 truncate">{repo.description}</p>
      )}
      <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
        {repo.language && <span>{repo.language}</span>}
        <span className="flex items-center gap-0.5">
          <Star className="w-3 h-3" />
          {repo.stargazers_count}
        </span>
        <span>{repo.default_branch}</span>
      </div>
    </div>
    <ExternalLink className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 transition-colors shrink-0 mt-0.5" />
  </a>
);

// ---------------------------------------------------------------------------
// Main component: GitHubView
// ---------------------------------------------------------------------------

export const GitHubView: React.FC = () => {
  const [accounts, setAccounts] = useState<GitHubAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewState>({ kind: "accounts" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [reposLoading, setReposLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Polling ref — so we can clear the interval when component unmounts or login is cancelled
  const pollIntervalRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Load accounts on mount
  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await githubListAccounts();
      setAccounts(data);
    } catch (err) {
      setError(formatError(err as AppError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    const timer = setTimeout(() => {
      if (!ignore) {
        void loadAccounts();
      }
    }, 0);
    return () => {
      ignore = true;
      clearTimeout(timer);
      stopPolling();
    };
  }, [loadAccounts, stopPolling]);

  // Begin device-flow login
  const handleBeginLogin = async () => {
    setActionError(null);
    try {
      const session = await githubBeginLogin();
      setView({ kind: "login-start", session });
    } catch (err) {
      setActionError(formatError(err as AppError));
    }
  };

  // Copy user_code to clipboard
  const handleCopy = useCallback(() => {
    if (view.kind === "login-start" || view.kind === "login-polling") {
      navigator.clipboard.writeText(view.session.user_code).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [view]);

  // Start polling after user clicks confirm
  const handleStartPolling = useCallback(() => {
    if (view.kind !== "login-start") return;

    const session = view.session;
    setView({ kind: "login-polling", session });
    setActionError(null);

    const intervalMs = (session.interval + 1) * 1000; // slight buffer over the recommended interval

    const pollOnce = async () => {
      try {
        const result = await githubPollLogin(session.session_token);
        if (result.status === "success") {
          stopPolling();
          await loadAccounts();
          setView({ kind: "accounts" });
        }
        // If pending, keep polling
      } catch (err) {
        stopPolling();
        const appErr = err as AppError;
        if (appErr.code === "OAUTH_STATE_MISMATCH" || appErr.code === "NO_ACTIVE_LOGIN") {
          // Another login window (e.g. Settings) consumed or replaced this
          // session. The account list is the source of truth now.
          await loadAccounts();
          setView({ kind: "accounts" });
          setActionError(
            "Bu giriş oturumu artık geçerli değil; başka bir pencere tamamlanmış olabilir. Hesap listesini kontrol edin."
          );
          return;
        }
        setView({ kind: "login-start", session });
        setActionError(formatError(appErr));
      }
    };

    pollOnce();
    pollIntervalRef.current = window.setInterval(pollOnce, intervalMs);
  }, [view, loadAccounts, stopPolling]);

  // Cancel login
  const handleCancelLogin = useCallback(() => {
    stopPolling();
    setView({ kind: "accounts" });
    setActionError(null);
  }, [stopPolling]);

  // View repos for an account
  const handleViewRepos = useCallback(async (account: GitHubAccount) => {
    setReposLoading(true);
    setActionError(null);
    setView({ kind: "repos", account, page: null, currentPage: 1 });
    try {
      const page = await githubListRepos(account.id, 1, 30);
      setView({ kind: "repos", account, page, currentPage: 1 });
    } catch (err) {
      setActionError(formatError(err as AppError));
    } finally {
      setReposLoading(false);
    }
  }, []);

  const handleRepoPageChange = useCallback(
    async (direction: "next" | "prev") => {
      if (view.kind !== "repos") return;
      const newPage = direction === "next" ? view.currentPage + 1 : view.currentPage - 1;
      if (newPage < 1) return;
      setReposLoading(true);
      setActionError(null);
      try {
        const page = await githubListRepos(view.account.id, newPage, 30);
        setView({ kind: "repos", account: view.account, page, currentPage: newPage });
      } catch (err) {
        setActionError(formatError(err as AppError));
      } finally {
        setReposLoading(false);
      }
    },
    [view]
  );

  // Disconnect account
  // View profile/overview for an account
  const handleViewProfile = useCallback(async (account: GitHubAccount) => {
    setProfileLoading(true);
    setProfileError(null);
    setActionError(null);
    setView({ kind: "profile", account, profile: null });
    try {
      const profile = await githubGetAccountProfile(account.id);
      setView({ kind: "profile", account, profile });
    } catch (err) {
      setProfileError(formatError(err as AppError));
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const handleRetryProfile = useCallback(() => {
    if (view.kind === "profile") {
      void handleViewProfile(view.account);
    }
  }, [view, handleViewProfile]);

  const handleDisconnect = useCallback(
    async (account: GitHubAccount) => {
      setDisconnecting(account.id);
      setActionError(null);
      try {
        await githubDisconnectAccount(account.id);
        await loadAccounts();
      } catch (err) {
        setActionError(formatError(err as AppError));
      } finally {
        setDisconnecting(null);
      }
    },
    [loadAccounts]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6 max-w-4xl mx-auto w-full">
      {/* Header */}
      <div className="pb-4 border-b border-slate-800 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <GithubIcon className="w-6 h-6 text-slate-300" />
            GitHub Hesapları
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            GitHub hesaplarını bağla, ayır ve repolarını listele.
          </p>
        </div>

        {view.kind === "accounts" && (
          <button
            id="add-github-account"
            type="button"
            onClick={handleBeginLogin}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 text-sky-400 text-xs font-medium border border-sky-700/40 transition-colors focus:outline-none focus:ring-1 focus:ring-sky-400 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Hesap Ekle
          </button>
        )}

        {view.kind === "accounts" && (
          <button
            id="refresh-accounts"
            type="button"
            onClick={loadAccounts}
            disabled={loading}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors focus:outline-none disabled:opacity-40 cursor-pointer"
            title="Yenile"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        )}
      </div>

      {/* Global action error */}
      {actionError && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-900/20 border border-red-700/40 text-sm text-red-300">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="ml-auto text-red-400 hover:text-red-200 focus:outline-none cursor-pointer"
            aria-label="Hata mesajını kapat"
          >
            ×
          </button>
        </div>
      )}

      {/* Content */}
      {view.kind === "accounts" && (
        <>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <AlertCircle className="w-8 h-8 text-red-400 opacity-60" />
              <p className="text-sm text-slate-400">{error}</p>
              <button
                type="button"
                onClick={loadAccounts}
                className="text-xs text-sky-400 hover:text-sky-300 underline focus:outline-none cursor-pointer"
              >
                Tekrar dene
              </button>
            </div>
          ) : accounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-16 h-16 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-center">
                <GithubIcon className="w-8 h-8 text-slate-500" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-slate-300">
                  GitHub hesabı bağlı değil
                </p>
                <p className="text-xs text-slate-500">
                  GitHub hesabı ekleyerek repolarınıza erişin.
                </p>
              </div>
              <button
                id="connect-first-account"
                type="button"
                onClick={handleBeginLogin}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                İlk Hesabı Ekle
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {accounts.map((account) => (
                <AccountCard
                  key={account.id}
                  account={account}
                  onViewRepos={handleViewRepos}
                  onViewProfile={handleViewProfile}
                  onDisconnect={handleDisconnect}
                  disconnecting={disconnecting === account.id}
                />
              ))}
            </div>
          )}
        </>
      )}

      {(view.kind === "login-start" || view.kind === "login-polling") && (
        <DeviceFlowPanel
          session={view.session}
          polling={view.kind === "login-polling"}
          error={actionError}
          onStartPolling={handleStartPolling}
          onCancel={handleCancelLogin}
          copied={copied}
          onCopy={handleCopy}
        />
      )}

      {view.kind === "profile" && (
        <ProfilePanel
          account={view.account}
          profile={view.profile}
          loading={profileLoading}
          error={profileError}
          onBack={() => setView({ kind: "accounts" })}
          onRetry={handleRetryProfile}
        />
      )}

      {view.kind === "repos" && (
        <ReposPanel
          account={view.account}
          page={view.page}
          currentPage={view.currentPage}
          loading={reposLoading}
          error={actionError}
          onNextPage={() => handleRepoPageChange("next")}
          onPrevPage={() => handleRepoPageChange("prev")}
          onBack={() => {
            setView({ kind: "accounts" });
            setActionError(null);
          }}
        />
      )}

      {/* Security note */}
      {view.kind === "accounts" && accounts.length > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-slate-900/40 border border-slate-800 text-xs text-slate-500">
          <Lock className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
          <span>
            GitHub tokenleri yalnızca işletim sistemi kimlik deposunda saklanır. Hiçbir
            token veritabanına veya loglara yazılmaz.
          </span>
        </div>
      )}
    </div>
  );
};
