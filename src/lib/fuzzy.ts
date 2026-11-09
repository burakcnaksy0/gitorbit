/**
 * v0.2 madde 5 — komut paleti eşleştirme yardımcıları (bağımlılıksız, testli).
 */

export interface FuzzyResult {
  /** Eşleşme skoru; 0 eşleşmediği anlamına gelir. Yüksek daha iyi. */
  score: number;
}

/**
 * Basit karakter-sıralı alt-dizi eşleştirici: query'nin karakterleri hedefte
 * sıra ile geçiyor mu? Bonuslar: ardışık eşleşme, kelime başı eşleşme, tam
 * alt-dizi. Küçük boyutlar için yeterli; deps gerektirmez.
 */
export function fuzzyScore(query: string, target: string): number {
  const q = query.trim().toLocaleLowerCase("tr");
  const t = target.toLocaleLowerCase("tr");
  if (q.length === 0) return 1;
  if (t.includes(q)) {
    // Tam alt-dizi: başlangıç konumuna göre küçük bonus (öne yakın iyidir).
    return 1000 - Math.min(t.indexOf(q), 99) * 2;
  }

  let score = 0;
  let ti = 0;
  let consecutive = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return 0;
    score += 10;
    if (found === ti && consecutive > 0) score += consecutive * 2;
    consecutive = found === ti ? consecutive + 1 : 1;
    if (found === 0 || /[\s\-_/.:]/.test(t[found - 1] ?? "")) score += 8;
    ti = found + 1;
  }
  return score;
}

/** Skora göre azalan, eşitlikte orijinal sırayı koruyan filtreleme. */
export function fuzzyFilter<T>(
  query: string,
  items: T[],
  getText: (item: T) => string
): T[] {
  if (query.trim().length === 0) return [...items];
  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(query, getText(item)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}

// ---------------------------------------------------------------------------
// Son kullanılanlar (localStorage, en yeni 5)
// ---------------------------------------------------------------------------

const RECENT_KEY = "gybe.palette.recents";
const RECENT_LIMIT = 5;

export function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === "string")
      .slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

export function pushRecent(id: string): string[] {
  const next = [id, ...loadRecents().filter((x) => x !== id)].slice(0, RECENT_LIMIT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Depolama yoksa (gizli mod vb.) sessizce düş — palette erişilebilirlik önemli.
  }
  return next;
}
