/**
 * CB-09/CB-10 — useDialogA11y sözleşme testleri.
 *
 * Kancanın 4 görevi: açılışta odak diyaloga girer, Escape kapatır, Tab/Shift+Tab
 * diyalog içinde döner (tuzak), kapanışta odak tetikleyici butona döner.
 */
import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useDialogA11y } from "./useDialogA11y";

function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  // Kapanış hem iç state'i düşürür hem dışarı bildirilir (gerçek kullanım:
  // setOpen(false) doğrudan state kapatıcısıdır).
  const dialogRef = useDialogA11y(open, () => {
    setOpen(false);
    onClose();
  });
  return (
    <div>
      <button onClick={() => setOpen(true)}>Tetikleyici</button>
      {open && (
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Test diyaloğu">
          <button>İptal</button>
          <input aria-label="Alan" />
          <button>Tamam</button>
        </div>
      )}
      <button onClick={() => setOpen(false)}>Dışarıdan kapat</button>
    </div>
  );
}

/** Kullanıcının butona basıp diyaloğu açmasını simüle eder (jsdom'da click
 * odak taşımaz — gerçek tarayıcıda tıklanan buton odak alır, onu ver). */
function openDialog() {
  const trigger = screen.getByRole("button", { name: "Tetikleyici" });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}

describe("useDialogA11y", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("açılışta odağı diyalogun ilk etkili alanına taşır", () => {
    render(<Harness onClose={() => {}} />);
    openDialog();
    expect(screen.getByRole("button", { name: "İptal" })).toHaveFocus();
  });

  it("Escape diyalogu kapatır ve odağı tetikleyiciye geri verir", () => {
    render(<Harness onClose={() => {}} />);
    const trigger = openDialog();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("onClose her çağrıda güncel closure'ı görür (effect yeniden kurulmadan)", () => {
    const fn = vi.fn();
    render(<Harness onClose={fn} />);
    openDialog();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("Tab son alandan ilk alana, Shift+Tab ilk alandan son alana sarar", () => {
    render(<Harness onClose={() => {}} />);
    openDialog();
    const first = screen.getByRole("button", { name: "İptal" });
    const last = screen.getByRole("button", { name: "Tamam" });

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("odak diyalog dışına kaçarsa Tab onu geri getirir (tuzağın özü)", () => {
    render(<Harness onClose={() => {}} />);
    openDialog();
    const outside = screen.getByRole("button", { name: "Dışarıdan kapat" });
    const first = screen.getByRole("button", { name: "İptal" });

    outside.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();
  });

  it("kapalıyken Escape dinleyicisi yoktur", () => {
    const onClose = vi.fn();
    function Closed() {
      const ref = useDialogA11y(false, onClose);
      return <div ref={ref} />;
    }
    render(<Closed />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
