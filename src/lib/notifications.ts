/**
 * v0.2 — OS (sistem) bildirimleri.
 *
 * Rahatsız etmeme ilkesi: bildirim YALNIZCA pencere odaksız/gizliyken gönderilir;
 * odaklıyken alt sağdaki toast yeterlidir. İzin yoksa veya Tauri köprüsü
 * yoksa (tarayıcı/test) sessizce düşer — asla kullanıcı akışını bozmaz.
 */
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let windowFocused = typeof document === "undefined" ? false : document.hasFocus();

if (typeof window !== "undefined") {
  window.addEventListener("focus", () => {
    windowFocused = true;
  });
  window.addEventListener("blur", () => {
    windowFocused = false;
  });
}

/** Pencere şu an kullanıcı tarafından görülüyor mu? (test edilebilir saf kontrol) */
export function isWindowFocused(): boolean {
  if (typeof document === "undefined") return false;
  return windowFocused && document.visibilityState === "visible";
}

/** Testlere açık: odak durumunu zorla ayarlar (yalnızca test amaçlı kullanın). */
export function __setWindowFocusedForTests(focused: boolean): void {
  windowFocused = focused;
}

/**
 * Uzun işlemler (clone/publish) veya dikkat gerektiren hatalar (push reddi)
 * için OS bildirimi gönderir. Bildirim gönderildiyse true döner.
 */
export async function notifySystem(title: string, body: string): Promise<boolean> {
  try {
    if (isWindowFocused()) return false;

    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (!granted) return false;

    sendNotification({ title, body });
    return true;
  } catch {
    // Tarayıcı önizlemesi, kapalı izin veya eklenti yok — sessiz düş.
    return false;
  }
}
