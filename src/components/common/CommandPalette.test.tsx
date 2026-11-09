/**
 * v0.2 madde 5 — Komut Paleti: klavye navigasyonu, calistirma, son
 * kullanilanlar siralamasi, bos sonuc.
 */
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommandPalette, type PaletteItem } from "./CommandPalette";

function items(): PaletteItem[] {
  return [
    { id: "tab.changes", section: "Sekmeler", label: "Değişiklikler", run: vi.fn() },
    { id: "tab.settings", section: "Sekmeler", label: "Ayarlar", run: vi.fn() },
    {
      id: "repo.r1",
      section: "Depolar",
      label: "demo",
      hint: "/repos/demo",
      run: vi.fn(),
    },
    { id: "branch.r1.fx", section: "Dallar", label: "Dala geç: feature-x", run: vi.fn() },
    { id: "action.push", section: "İşlemler", label: "Dışa Aktar (Push)", run: vi.fn() },
  ];
}

beforeEach(() => localStorage.clear());

describe("CommandPalette", () => {
  // WP-10a sözleşme değişti: kapalıyken bileşen hiç monte edilmez (koşullu
  // render parent'ın işi) — eskiden open={false} ile "hiçbir şey çizmez"di.
  it("acikken ogeleri bolum basliklariyla listeler", () => {
    render(<CommandPalette items={items()} onClose={() => {}} />);
    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getByText("Değişiklikler")).toBeInTheDocument();
    expect(within(listbox).getByText("Sekmeler")).toBeInTheDocument();
    expect(within(listbox).getByText("Dala geç: feature-x")).toBeInTheDocument();
  });

  it("sorgu ile filtreler; Enter secili komutu calistirir ve kapatir", () => {
    const onClose = vi.fn();
    const list = items();
    const push = list.find((i) => i.id === "action.push")!;
    render(<CommandPalette items={list} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("Komut ara"), { target: { value: "push" } });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });

    expect(push.run).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("ok tuşları seçimi taşır (wrap-around)", () => {
    const list = items();
    render(<CommandPalette items={list} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");

    // İlk seçim: birinci oge (Deği̇şiklikler) secili
    const option = () =>
      screen
        .getAllByRole("option")
        .find((el) => el.getAttribute("aria-selected") === "true");
    expect(option()?.textContent).toContain("Değişiklikler");

    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    expect(option()?.textContent).toContain("Ayarlar");

    fireEvent.keyDown(dialog, { key: "ArrowUp" });
    expect(option()?.textContent).toContain("Değişiklikler");
  });

  it("Esc kapatir", () => {
    const onClose = vi.fn();
    render(<CommandPalette items={items()} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("son calistirilan komut bos sorguda en ustte görünür", () => {
    const list = items();
    const settings = list.find((i) => i.id === "tab.settings")!;
    const { rerender } = render(<CommandPalette items={list} onClose={() => {}} />);
    // Ayarlar'i calistir
    fireEvent.click(screen.getByText("Ayarlar"));

    rerender(<CommandPalette items={items()} onClose={() => {}} />);
    const options = screen.getAllByRole("option");
    expect(options[0].textContent).toContain("Ayarlar");
    expect(settings.run).toHaveBeenCalled();
  });

  it("eslesme yoksa dürüst boş durum", () => {
    render(<CommandPalette items={items()} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Komut ara"), { target: { value: "qqqzzz" } });
    expect(screen.getByText("Eşleşen komut yok.")).toBeInTheDocument();
  });
});
