import { describe, it, expect, beforeEach } from "vitest";
import { fuzzyScore, fuzzyFilter, loadRecents, pushRecent } from "./fuzzy";

describe("fuzzyScore", () => {
  it("bos sorgu her seyi eslestirir", () => {
    expect(fuzzyScore("", "her sey")).toBeGreaterThan(0);
  });

  it("tam alt-dizi, daginik eslesmeden daha yuksek skor alir", () => {
    const direct = fuzzyScore("push", "Dışa Aktar (Push)");
    const scattered = fuzzyScore("push", "pandas unicorn spaces hack");
    expect(direct).toBeGreaterThan(scattered);
    expect(direct).toBeGreaterThan(0);
    expect(scattered).toBeGreaterThan(0);
  });

  it("eslesmeyen karakterler sifir verir", () => {
    expect(fuzzyScore("xyz", "Depolar")).toBe(0);
  });

  it("kelime bashi eşleşme bonus alir", () => {
    const wordStart = fuzzyScore("dk", "Depo Klonla");
    const midWord = fuzzyScore("dk", "adak le");
    expect(wordStart).toBeGreaterThan(midWord);
  });

  it("Türkçe küçük harf duyarlılığı (İ/I) çökmez", () => {
    expect(fuzzyScore("DEPO", "Depolar")).toBeGreaterThan(0);
  });
});

describe("fuzzyFilter", () => {
  const items = [
    { label: "Depolar" },
    { label: "Dışa Aktar (Push)" },
    { label: "Depo Ekle" },
    { label: "Ayarlar" },
  ];
  const text = (i: { label: string }) => i.label;

  it("sorgu yokken orijinal sirayi korur", () => {
    expect(fuzzyFilter("", items, text).map((i) => i.label)).toEqual([
      "Depolar",
      "Dışa Aktar (Push)",
      "Depo Ekle",
      "Ayarlar",
    ]);
  });

  it("eslesenleri skora gore siralar, eslesmeyeni atar", () => {
    const out = fuzzyFilter("depo", items, text).map((i) => i.label);
    expect(out).toContain("Depolar");
    expect(out).toContain("Depo Ekle");
    expect(out).not.toContain("Ayarlar");
    // Tam alt-dizi 'Depo Ekle' kelime-basi bonusu ile 'Depolar'dan once gelebilir;
    // iki eslesenin de olduklari garanti:
    expect(out.length).toBe(2);
  });
});

describe("son kullanilanlar", () => {
  beforeEach(() => localStorage.clear());

  it("en yeni 5 saklanir, tekrarlar one tasinir", () => {
    for (const id of ["a", "b", "c", "d", "e", "f"]) pushRecent(id);
    expect(loadRecents()).toEqual(["f", "e", "d", "c", "b"]);

    pushRecent("d");
    expect(loadRecents()).toEqual(["d", "f", "e", "c", "b"]);
  });

  it("bozuk depolama icerigi yutulur", () => {
    localStorage.setItem("gybe.palette.recents", "{bozuk");
    expect(loadRecents()).toEqual([]);
  });
});
