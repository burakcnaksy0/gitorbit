/**
 * Toast altyapısı birim testleri: gösterim, ton metni, elle kapatma,
 * otomatik kapanma ve sağlayıcısız kullanımın (test bileşenleri) güvenli
 * no-op olması.
 */
import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider, useNotify } from "./Toast";

const Probe: React.FC = () => {
  const notify = useNotify();
  return (
    <button
      type="button"
      onClick={() => notify.success("Commit atıldı", "a1b2c3d · main")}
    >
      tetikle
    </button>
  );
};

describe("ToastProvider", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("başarılı bildirimi gösterir ve süre sonunda kapatır", () => {
    render(
      <ToastProvider>
        <Probe />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "tetikle" }));

    expect(screen.getByText("Commit atıldı")).toBeInTheDocument();
    expect(screen.getByText("a1b2c3d · main")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByText("Commit atıldı")).not.toBeInTheDocument();
  });

  it("elle kapatma bildirimi kaldırır", () => {
    render(
      <ToastProvider>
        <Probe />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "tetikle" }));
    fireEvent.click(screen.getByLabelText("Bildirimi kapat"));
    expect(screen.queryByText("Commit atıldı")).not.toBeInTheDocument();
  });

  it("sağlayıcı yoksa useNotify sessiz no-op döner", () => {
    render(<Probe />);
    fireEvent.click(screen.getByRole("button", { name: "tetikle" }));
    // Patlamadı — tek buton hâlâ orada.
    expect(screen.getAllByRole("button", { name: "tetikle" })).toHaveLength(1);
  });
});
