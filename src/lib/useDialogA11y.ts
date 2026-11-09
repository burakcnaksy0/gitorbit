/**
 * CB-09/CB-10 — diyalog erişilebilirliği (odak yönetimi + Escape + odak tuzağı).
 *
 * Uygulamadaki tüm modal'lar role="dialog"/aria-modal taşısada ODAK YÖNETİMİ
 * YOKTU: açılışta odak arka planda kalıyor, Tab diyalogdan kaçıyor, Escape
 * (ortak iki modal hariç) çalışmıyordu. Ekran okuyucu ve klavye kullanıcıları
 * için modal'lar birer tuzaktı.
 *
 * Kanca diyalog PANELİNE ref olarak bağlanır; koşullu render'ın (`{open && ...}`)
 * hemen üstünde, bileşen gövdesinde KOŞULSUZ çağrılır.
 */
import { useEffect, useRef } from "react";

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function useDialogA11y<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose: () => void
) {
  const ref = useRef<T>(null);
  // onClose her render'da tazelenir — effect'i yeniden kurmadan güncel kalır.
  // (Yazma effect içinde: render sırasında ref'e yazmak saf değildir.)
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Escape yalnızca TIKLANABİLİR değil, ODAKLANABİLİR de olsun (panelin
    // programatik odağı için).
    if (el && el.tabIndex < 0) el.tabIndex = -1;

    const focusables = (): HTMLElement[] =>
      Array.from(el?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (f) => !f.hasAttribute("disabled")
      );

    // Açılış odağı: ilk etkili alan (formu olmayan diyalogda panelin kendisi).
    const initial = focusables()[0] ?? el;
    initial?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        el.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && el.contains(active);
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };

    // Capture-phase: Escape'i alt bileşenler yutmadan yakala (CommandPalette
    // ile eşzamanlı açıklık pratikte olmaz; yutma sırası modal'ınki öncelikli).
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      // CB-11: kapanışta odak tetikleyici butona dönsün — ekran okuyucu
      // bağlamını kaybetmesin.
      previouslyFocused?.focus?.();
    };
  }, [open]);

  return ref;
}
