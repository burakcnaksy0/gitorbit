import React from "react";
import { AlertTriangle, Info, X } from "lucide-react";

interface ActionNoticeModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  actionName: string;
  /** Short context label (error code, feature area, ...). */
  targetPhase: string;
  details?: string;
  tone?: "info" | "error";
}

/**
 * Generic notice dialog used for errors and "not implemented yet" messages.
 *
 * It deliberately has no success state: success is only ever reported by a
 * component that received a successful backend response.
 */
export const ActionNoticeModal: React.FC<ActionNoticeModalProps> = ({
  isOpen,
  onClose,
  title,
  actionName,
  targetPhase,
  details,
  tone = "info",
}) => {
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isError = tone === "error";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
    >
      <div className="bg-slate-900 border border-slate-700/80 rounded-xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${
                isError
                  ? "bg-rose-950/80 text-rose-400 border-rose-800/60"
                  : "bg-sky-950/80 text-sky-400 border-sky-800/60"
              }`}
            >
              {isError ? (
                <AlertTriangle className="w-5 h-5" />
              ) : (
                <Info className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 id="modal-title" className="text-sm font-semibold text-slate-100">
                {title}
              </h3>
              <span
                className={`text-xs font-mono ${
                  isError ? "text-rose-400" : "text-sky-400"
                }`}
              >
                {targetPhase}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-md hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-400"
            aria-label="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="text-xs text-slate-300/90 leading-relaxed space-y-2 bg-slate-950/60 p-3.5 rounded-lg border border-slate-800">
          <p className="text-slate-200 font-medium break-words">{actionName}</p>
          {details && (
            <p className="text-slate-400 whitespace-pre-wrap break-words">{details}</p>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-400"
          >
            Anladım
          </button>
        </div>
      </div>
    </div>
  );
};
