import React from "react";
import { Loader2 } from "lucide-react";

interface LoadingStateProps {
  message?: string;
  description?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  message = "Yükleniyor...",
  description = "Veriler okunuyor, lütfen bekleyin.",
}) => {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center p-12 text-center text-slate-400"
    >
      <Loader2 className="w-8 h-8 text-sky-400 animate-spin mb-4" aria-hidden="true" />
      <div className="text-sm font-semibold text-slate-200">{message}</div>
      {description && (
        <div className="text-xs text-slate-500 mt-1 max-w-sm">{description}</div>
      )}
    </div>
  );
};
