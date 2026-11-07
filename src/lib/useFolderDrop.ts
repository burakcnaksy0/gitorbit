/**
 * v0.2 madde 9 — klasör sürükle-bırak ile depo ekleme.
 *
 * Tauri pencere olaylarını dinler; tarayıcı önizlemesinde (API yok) sessizce
 * devre dışı kalır. Bırakılan tüm yollar geri çağrıya verilir — ilk klasörü
 * seçme kararı çağırana (Shell/openRepository) aittir.
 */
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type FolderDropHandler = (paths: string[]) => void;

export function useFolderDrop(onDrop: FolderDropHandler): {
  isDragging: boolean;
} {
  const [isDragging, setIsDragging] = useState(false);

  const handlerRef = useRef(onDrop);
  useEffect(() => {
    handlerRef.current = onDrop;
  }, [onDrop]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void (async () => {
      try {
        const fn = await getCurrentWindow().onDragDropEvent((event) => {
          switch (event.payload.type) {
            case "enter":
            case "over":
              setIsDragging(true);
              break;
            case "drop":
              setIsDragging(false);
              handlerRef.current(event.payload.paths);
              break;
            case "leave":
              setIsDragging(false);
              break;
          }
        });
        if (disposed) fn();
        else unlisten = fn;
      } catch {
        // Tauri köprüsü yok (vitest/tarayıcı) — özellik sessizce kapalı.
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return { isDragging };
}
