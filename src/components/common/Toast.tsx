/**
 * Gybe — sağ alt köşe bilgi bildirimi (toast) altyapısı.
 *
 * Başarılı git işlemlerinden sonra (commit, push, pull, branch, yayın…)
 * kullanıcıya kısa özetli, kendini temizleyen geri bildirim verir.
 * Hatalar eskisi gibi ActionNoticeModal ile gösterilmeye devam eder;
 * toast'lar yalnızca "oldu" bilgisidir (hata toast'ı da desteklenir).
 *
 * `useNotify()` sağlayıcı olmadan da çağrılabilir (no-op) — böylece
 * testlerde tek tek render edilen bileşenler patlamaz.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from "lucide-react";

export type ToastTone = "success" | "error" | "info" | "warning";

export interface ToastApi {
  notify: (options: {
    title: string;
    description?: string;
    tone?: ToastTone;
    durationMs?: number;
  }) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
}

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

const DEFAULT_DURATION_MS = 6000;
const MAX_VISIBLE = 5;

const ToastContext = createContext<ToastApi | null>(null);

const NOOP_API: ToastApi = {
  notify: () => {},
  success: () => {},
  error: () => {},
  info: () => {},
  warning: () => {},
};

/** Kısa sha gösterimi: tam hash yerine 7 karakter. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const notify = useCallback<ToastApi["notify"]>(
    ({ title, description, tone = "info", durationMs = DEFAULT_DURATION_MS }) => {
      const id = nextId.current++;
      setToasts((prev) => [
        ...prev.slice(-(MAX_VISIBLE - 1)),
        { id, tone, title, description },
      ]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), durationMs)
      );
    },
    [dismiss]
  );

  // Sayfa değişirken askıda kalan timer'ları temizle.
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      notify,
      success: (title, description) => notify({ title, description, tone: "success" }),
      error: (title, description) =>
        notify({ title, description, tone: "error", durationMs: 9000 }),
      info: (title, description) => notify({ title, description, tone: "info" }),
      warning: (title, description) =>
        notify({ title, description, tone: "warning", durationMs: 9000 }),
    }),
    [notify]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        role="status"
        className="fixed bottom-11 right-3 z-50 flex flex-col items-end gap-2 pointer-events-none"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

const TONE_STYLES: Record<
  ToastTone,
  { icon: React.ReactNode; border: string; iconColor: string }
> = {
  success: {
    icon: <CheckCircle2 className="w-4 h-4" />,
    border: "border-emerald-500/40",
    iconColor: "text-emerald-400",
  },
  error: {
    icon: <AlertCircle className="w-4 h-4" />,
    border: "border-red-500/40",
    iconColor: "text-red-400",
  },
  warning: {
    icon: <TriangleAlert className="w-4 h-4" />,
    border: "border-amber-500/40",
    iconColor: "text-amber-400",
  },
  info: {
    icon: <Info className="w-4 h-4" />,
    border: "border-sky-500/40",
    iconColor: "text-sky-400",
  },
};

const ToastCard: React.FC<{ toast: ToastItem; onDismiss: () => void }> = ({
  toast,
  onDismiss,
}) => {
  const tone = TONE_STYLES[toast.tone];
  return (
    <div
      className={`animate-toast-in pointer-events-auto flex items-start gap-2.5 max-w-sm rounded-lg border ${tone.border} bg-slate-900/95 backdrop-blur px-3.5 py-2.5 shadow-xl shadow-black/40`}
    >
      <span className={`mt-0.5 shrink-0 ${tone.iconColor}`}>{tone.icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-slate-100">{toast.title}</p>
        {toast.description && (
          <p className="mt-0.5 text-xs text-slate-400 break-words">{toast.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Bildirimi kapat"
        className="ml-1 shrink-0 rounded p-0.5 text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Sağ alt köşe bildirim API'si. Sağlayıcı yoksa sessiz no-op döner. */
export function useNotify(): ToastApi {
  return useContext(ToastContext) ?? NOOP_API;
}
