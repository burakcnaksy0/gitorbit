/**
 * v0.2 madde 12 — ilk çalıştırma onboarding'i.
 *
 * Yalnızca `onboarding_completed == false && reposizlık` durumunda
 * (Shell kararını verir) WelcomeView'ın üstünde görünür. Üç adım:
 * GitHub bağla → depo aç → ilk işlem. "Şimdilik atla" ayarı kalıcı olarak
 * kapatır; Ayarlar'dan yeniden açılabilir.
 */
import React, { useEffect, useState } from "react";
import {
  Check,
  FolderGit2,
  Link2,
  ListChecks,
  Sparkles,
} from "lucide-react";
import { githubListAccounts } from "../../lib/tauriCommands";

interface OnboardingCardsProps {
  /** Adım 2 göstergesi: en az bir kayıtlı depo var mı? */
  hasRepositories: boolean;
  onConnectGitHub: () => void;
  onAddRepository: () => void;
  onStartFirstTask: () => void;
  /** Ayarı `true` yapar — bir daha gösterilmemek üzere kapatır. */
  onDismiss: () => void;
}

function StepBadge({ done, index }: { done: boolean; index: number }) {
  return done ? (
    <span
      className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-950/80 border border-emerald-700 text-emerald-400 shrink-0"
      title="Tamamlandı"
    >
      <Check className="w-3.5 h-3.5" />
    </span>
  ) : (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-[11px] font-bold shrink-0">
      {index}
    </span>
  );
}

export const OnboardingCards: React.FC<OnboardingCardsProps> = ({
  hasRepositories,
  onConnectGitHub,
  onAddRepository,
  onStartFirstTask,
  onDismiss,
}) => {
  // Adım 1'in ✓'si gerçek hesaplardan gelir — kendimiz sorarız, uydurmayız.
  const [hasGitHubAccount, setHasGitHubAccount] = useState<boolean | null>(null);

  useEffect(() => {
    let ignore = false;
    void (async () => {
      try {
        const accounts = await githubListAccounts();
        if (!ignore) setHasGitHubAccount(accounts.length > 0);
      } catch {
        if (!ignore) setHasGitHubAccount(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  const step1Done = hasGitHubAccount === true;
  const step2Done = hasRepositories;

  const step3 = () => {
    // İlk işlem sekmesine geçerken akışı tamamlanmış sayıyoruz.
    onDismiss();
    onStartFirstTask();
  };

  return (
    <div
      className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-4"
      role="region"
      aria-label="Hoş geldin adımları"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-sky-400 shrink-0" />
          <h2 className="text-sm font-bold text-slate-100">
            Kurulumu tamamla — 3 kısa adım
          </h2>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[11px] text-slate-400 hover:text-slate-200 underline-offset-2 hover:underline transition-colors cursor-pointer"
        >
          Şimdilik atla
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Adım 1 */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <Link2 className="w-4 h-4 text-slate-300" />
            <StepBadge done={step1Done} index={1} />
          </div>
          <p className="text-xs font-semibold text-slate-200">GitHub&apos;ını bağla</p>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Cihaz koduyla giriş yap; token yalnızca sistem anahtarlığında saklanır.
          </p>
          <button
            type="button"
            onClick={onConnectGitHub}
            className="w-full py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
          >
            {step1Done ? "Hesapları gör" : "GitHub sekmesine git"}
          </button>
        </div>

        {/* Adım 2 */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <FolderGit2 className="w-4 h-4 text-slate-300" />
            <StepBadge done={step2Done} index={2} />
          </div>
          <p className="text-xs font-semibold text-slate-200">Bir depo aç</p>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Yerel bir klasör ekle ya da GitHub&apos;dan klonla; uçbirim gerekmez.
          </p>
          <button
            type="button"
            onClick={onAddRepository}
            className="w-full py-1.5 rounded-lg text-[11px] font-semibold bg-sky-600 hover:bg-sky-500 text-white transition-colors cursor-pointer"
          >
            Yerel depo aç
          </button>
        </div>

        {/* Adım 3 */}
        <div
          className={`rounded-xl border border-slate-800 bg-slate-950/50 p-4 space-y-2 ${
            step2Done ? "" : "opacity-60"
          }`}
        >
          <div className="flex items-center justify-between">
            <Sparkles className="w-4 h-4 text-slate-300" />
            <StepBadge done={false} index={3} />
          </div>
          <p className="text-xs font-semibold text-slate-200">İlk işlemini yap</p>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Değişiklikler sekmesinde sahnele, diff&apos;i gör, ilk commit&apos;ini at.
          </p>
          <button
            type="button"
            onClick={step3}
            disabled={!step2Done}
            className="w-full py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            title={step2Done ? undefined : "Önce bir depo ekleyin"}
          >
            Değişiklikler&apos;e git
          </button>
        </div>
      </div>
    </div>
  );
};
