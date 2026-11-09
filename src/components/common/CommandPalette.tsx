/**
 * v0.2 madde 5 — Komut Paleti (Ctrl+K / Ctrl+Shift+P).
 *
 * Genel bileşen: komut listesi dışarıdan gelir (Shell kurar), bileşen yalnız
 * arama + klavye navigasyonu + son kullanılanlar sıralamasını yönetir.
 *
 * Açılış/kapanış sözleşmesi (WP-10a): bileşen YALNIZCA açıkken monte edilir —
 * parent koşullu render eder. "Açılışta sıfırla" taze mount'un doğal
 * sonucudur; eski `open` prop'u + reset-effect deseni, React'in
 * effect-anti-pattern kapısından (react-hooks/set-state-in-effect) geçtiği
 * için bırakıldı. Kapanış odağı parent'ın (Shell) sorumluluğundadır.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import { fuzzyFilter, loadRecents, pushRecent } from "../../lib/fuzzy";

export interface PaletteItem {
  /** kararlı kimlik (son kullanılanlar için). */
  id: string;
  label: string;
  section: string;
  /** İkincil açıklama (eşleşme metnine dahil edilir). */
  hint?: string;
  icon?: React.ReactNode;
  run: () => void;
}

interface CommandPaletteProps {
  items: PaletteItem[];
  onClose: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ items, onClose }) => {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [recents, setRecents] = useState<string[]>(() => loadRecents());
  const inputRef = useRef<HTMLInputElement>(null);

  // Mount olur olmaz (palet açılınca) inputa odak — DOM sistemi, effect'in işi.
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, []);

  const visible = useMemo(() => {
    const matched = fuzzyFilter(query, items, (i) =>
      query.trim() ? `${i.label} ${i.hint ?? ""}` : i.label
    );
    if (query.trim().length > 0) return matched;
    // Boş sorguda son kullanılanlar en üstte, kendi sıralarıyla.
    const recentItems = recents
      .map((id) => matched.find((i) => i.id === id))
      .filter((i): i is PaletteItem => Boolean(i));
    const rest = matched.filter((i) => !recents.includes(i.id));
    return [...recentItems, ...rest];
  }, [items, query, recents]);

  // Pencere düzeyinde Esc: odak input dışında olsa bile paleti kapatır.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const runItem = (item: PaletteItem) => {
    setRecents(pushRecent(item.id));
    onClose();
    item.run();
  };

  // Bölüm başlıklarıyla çizilecek sıralı satırlar.
  const rows = useMemo(() => {
    const out: Array<
      | { kind: "header"; section: string }
      | { kind: "item"; item: PaletteItem; index: number }
    > = [];
    let lastSection: string | null = null;
    visible.forEach((item, index) => {
      if (item.section !== lastSection) {
        out.push({ kind: "header", section: item.section });
        lastSection = item.section;
      }
      out.push({ kind: "item", item, index });
    });
    return out;
  }, [visible]);

  // Seçim taşarsa okurken sınırla (türetilmiş değer — eski clamp-effect'in
  // birebir karşılığı; sorgu/depo değişiminde otomatik geçerli).
  const selectedSafe = visible.length === 0 ? 0 : Math.min(selected, visible.length - 1);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) =>
        visible.length === 0 ? 0 : (Math.min(s, visible.length - 1) + 1) % visible.length
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) =>
        visible.length === 0
          ? 0
          : (Math.min(s, visible.length - 1) - 1 + visible.length) % visible.length
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = visible[selectedSafe];
      if (item) runItem(item);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 pt-[12vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Komut paleti"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 border-b border-slate-800">
          <Search className="w-4 h-4 text-slate-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sekme, depo, dal veya komut ara…"
            className="flex-1 bg-transparent py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
            aria-label="Komut ara"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-listbox"
          />
          <kbd className="text-[10px] text-slate-500 border border-slate-700 rounded px-1.5 py-0.5">
            Esc
          </kbd>
        </div>

        <ul
          id="palette-listbox"
          role="listbox"
          className="max-h-[50vh] overflow-y-auto py-1"
        >
          {visible.length === 0 && (
            <li className="px-4 py-6 text-center text-xs text-slate-500">
              Eşleşen komut yok.
            </li>
          )}
          {rows.map((row, rowIndex) => {
            if (row.kind === "header") {
              return (
                <li
                  key={`h-${row.section}-${rowIndex}`}
                  role="presentation"
                  className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-slate-500 font-bold"
                >
                  {row.section}
                </li>
              );
            }
            const { item, index } = row;
            const isSelected = index === selectedSafe;
            return (
              <li
                key={item.id}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setSelected(index)}
                onClick={() => runItem(item)}
                className={`mx-1 flex items-center gap-2.5 rounded-lg px-3 py-2 cursor-pointer text-xs ${
                  isSelected
                    ? "bg-sky-600/25 text-sky-100"
                    : "text-slate-300 hover:bg-slate-800"
                }`}
              >
                {item.icon && (
                  <span className="shrink-0 text-slate-400">{item.icon}</span>
                )}
                <span className="flex-1 min-w-0">
                  <span className="block truncate font-medium">{item.label}</span>
                  {item.hint && (
                    <span className="block truncate text-[10px] text-slate-500">
                      {item.hint}
                    </span>
                  )}
                </span>
                {isSelected && (
                  <CornerDownLeft className="w-3 h-3 text-sky-400 shrink-0" />
                )}
              </li>
            );
          })}
        </ul>

        <div className="border-t border-slate-800 px-3 py-1.5 flex items-center gap-3 text-[10px] text-slate-500">
          <span>↑↓ gez</span>
          <span>Enter çalıştır</span>
          <span>Esc kapat</span>
        </div>
      </div>
    </div>
  );
};
