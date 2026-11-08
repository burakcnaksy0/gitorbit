/**
 * GitOrbit — dialogs for the "folder is not a Git repository" flow and for
 * publishing a local repository to GitHub.
 *
 * - `NotGitChoiceModal`: asked when a plain folder is added. The user chooses
 *   local `git init`, publishing to GitHub (which implies init first), or
 *   cancels without touching anything.
 * - `PublishRepoModal`: form for `github_publish_repository` (account, name,
 *   description, visibility). Also reachable later for repos that have no
 *   `origin` yet.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ExternalLink,
  FolderGit2,
  Loader2,
  Rocket,
  X,
} from "lucide-react";
import type { GitHubAccount, GitHubPublishResult } from "../../types/ipc";
import { friendlyError } from "../../lib/errors";
import { githubListAccounts, githubPublishRepository } from "../../lib/tauriCommands";
import { GithubIcon } from "../../components/common/GithubIcon";
import { useDialogA11y } from "../../lib/useDialogA11y";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// CB-08: kod-eşlemeleri ve recovery_hint gösterimi merkezi lib/errors'ta.
const errorMessage = friendlyError;

// ---------------------------------------------------------------------------
// NotGitChoiceModal
// ---------------------------------------------------------------------------

export interface NotGitChoiceModalProps {
  path: string;
  busy: boolean;
  onInitLocal: () => void;
  onInitAndPublish: () => void;
  onClose: () => void;
}

export const NotGitChoiceModal: React.FC<NotGitChoiceModalProps> = ({
  path,
  busy,
  onInitLocal,
  onInitAndPublish,
  onClose,
}) => {
  // CB-09/CB-10: ebeveyn bunu yalnızca açıkken mount eder — açık kabul et.
  const dialogRef = useDialogA11y(true, onClose);
  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="not-git-title"
    >
    <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <FolderGit2 className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
          <div>
            <h2 id="not-git-title" className="text-sm font-bold text-slate-100">
              Bu klasör bir Git deposu değil
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Ne yapmak istersiniz? Klasör içeriğine dokunulmaz; yalnızca{" "}
              <code className="text-slate-300">git init</code> çalıştırılır.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="Kapat"
          className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="bg-slate-950 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 border border-slate-800 break-all">
        {path}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        <button
          id="init-local"
          type="button"
          onClick={onInitLocal}
          disabled={busy}
          className="flex flex-col items-start gap-1.5 p-4 rounded-xl bg-slate-800/70 hover:bg-slate-700/70 border border-slate-700 hover:border-slate-500 text-left transition-colors disabled:opacity-50 cursor-pointer"
        >
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-100">
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FolderGit2 className="w-4 h-4 text-sky-400" />
            )}
            Git deposu olarak başlat
          </span>
          <span className="text-[11px] text-slate-400">
            Yerel bir depoya dönüştürülür ve normal şekilde kullanılır. GitHub'a sonra da
            yayınlayabilirsiniz.
          </span>
        </button>

        <button
          id="init-and-publish"
          type="button"
          onClick={onInitAndPublish}
          disabled={busy}
          className="flex flex-col items-start gap-1.5 p-4 rounded-xl bg-sky-950/40 hover:bg-sky-900/40 border border-sky-800/50 hover:border-sky-600 text-left transition-colors disabled:opacity-50 cursor-pointer"
        >
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-sky-300">
            <Rocket className="w-4 h-4" />
            Başlat ve GitHub'da yayınla
          </span>
          <span className="text-[11px] text-slate-400">
            Önce <code>git init</code>, ardından GitHub'da yeni bir depo oluşturup ilk
            gönderim yapılır.
          </span>
        </button>
      </div>

      <button
        type="button"
        onClick={onClose}
        disabled={busy}
        className="w-full py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors disabled:opacity-50 cursor-pointer"
      >
        Vazgeç
      </button>
    </div>
  </div>
  );
};

// ---------------------------------------------------------------------------
// PublishRepoModal
// ---------------------------------------------------------------------------

export interface PublishRepoModalProps {
  repoId: string;
  defaultName: string;
  onClose: () => void;
  /** Called after a successful publish so the shell can refresh state. */
  onPublished: (result: GitHubPublishResult) => void;
}

type Phase = "loading" | "accounts-empty" | "form" | "publishing" | "done";

export const PublishRepoModal: React.FC<PublishRepoModalProps> = ({
  repoId,
  defaultName,
  onClose,
  onPublished,
}) => {
  const [phase, setPhase] = useState<Phase>("loading");
  const [accounts, setAccounts] = useState<GitHubAccount[]>([]);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string>("");
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GitHubPublishResult | null>(null);

  // Deferred load (setTimeout(…, 0) convention): keeps the effect body free
  // of synchronous setState cascades.
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const list = await githubListAccounts();
        const connected = list.filter((a) => a.connection_status === "connected");
        setAccounts(connected);
        if (connected.length === 0) {
          setPhase("accounts-empty");
        } else {
          setAccountId(connected[0].id);
          setPhase("form");
        }
      } catch (err) {
        setAccountsError(errorMessage(err));
        setPhase("accounts-empty");
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!accountId || !name.trim()) return;
    setPhase("publishing");
    setError(null);
    try {
      const res = await githubPublishRepository(
        accountId,
        repoId,
        name.trim(),
        description.trim() || null,
        isPrivate
      );
      setResult(res);
      setPhase("done");
      onPublished(res);
    } catch (err) {
      setError(errorMessage(err));
      setPhase("form");
    }
  }, [accountId, repoId, name, description, isPrivate, onPublished]);

  // CB-09/CB-10: ebeveyn bunu yalnızca açıkken mount eder — açık kabul et.
  const dialogRef = useDialogA11y(true, onClose);

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-repo-title"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Rocket className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
            <div>
              <h2 id="publish-repo-title" className="text-sm font-bold text-slate-100">
                GitHub'da Yayınla
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Seçtiğiniz hesap altında yeni bir depo oluşturulur, <code>origin</code>{" "}
                olarak eklenir ve mevcut dal gönderilir.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {phase === "loading" && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-sky-400" />
          </div>
        )}

        {phase === "accounts-empty" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <GithubIcon className="w-8 h-8 text-slate-500" />
            <p className="text-sm text-slate-300">Bağlı bir GitHub hesabı yok.</p>
            <p className="text-xs text-slate-500 max-w-sm">
              {accountsError ??
                "Yayınlamadan önce GitHub ekranından bir hesap bağlamanız gerekiyor."}
            </p>
          </div>
        )}

        {(phase === "form" || phase === "publishing") && (
          <div className="space-y-3">
            {accounts.length > 1 && (
              <label className="block text-xs text-slate-400 space-y-1">
                Hesap
                <span className="relative block">
                  <select
                    id="publish-account"
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    className="w-full appearance-none rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 pr-9 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-400"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id} className="bg-slate-900 text-slate-100">
                        @{a.login}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                </span>
              </label>
            )}

            <label className="block text-xs text-slate-400 space-y-1">
              Depo adı *
              <input
                id="publish-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="proje-adi"
                maxLength={100}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-sky-400"
              />
              <span className="block text-[10px] text-slate-500">
                Harf, rakam, '-', '_', '.' — boşluk ve Türkçe karakter kullanmayın.
              </span>
            </label>

            <label className="block text-xs text-slate-400 space-y-1">
              Açıklama (isteğe bağlı)
              <textarea
                id="publish-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Bu depo ne yapıyor?"
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-400 resize-none"
              />
            </label>

            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
              <input
                id="publish-private"
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                className="rounded border-slate-600 bg-slate-950 accent-sky-500"
              />
              Özel depo (private)
            </label>

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-900/20 border border-red-700/40 text-xs text-red-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={phase === "publishing"}
                className="flex-1 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors disabled:opacity-50 cursor-pointer"
              >
                İptal
              </button>
              <button
                id="publish-submit"
                type="button"
                onClick={() => void handleSubmit()}
                disabled={phase === "publishing" || !name.trim()}
                className="flex-1 inline-flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-50 cursor-pointer"
              >
                {phase === "publishing" ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Yayınlanıyor...
                  </>
                ) : (
                  <>
                    <Rocket className="w-3.5 h-3.5" />
                    Yayınla
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {phase === "done" && result && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-900/20 border border-emerald-700/40 text-sm text-emerald-300">
              <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold">Depo GitHub'da oluşturuldu.</p>
                {result.pushed ? (
                  <p className="text-xs">
                    Mevcut dal gönderildi (origin olarak ayarlandı).
                  </p>
                ) : (
                  <p className="text-xs text-amber-300">
                    {result.warning ??
                      "Commit'ler henüz gönderilmedi — ilk commit'ten sonra alt bardaki Dışa Aktar butonunu kullanın."}
                  </p>
                )}
              </div>
            </div>
            <a
              href={result.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 transition-colors"
            >
              {result.html_url}
              <ExternalLink className="w-3 h-3" />
            </a>
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer"
            >
              Kapat
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
