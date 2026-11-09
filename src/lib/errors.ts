/**
 * CB-08 — merkezi hata gösterim katmanı.
 *
 * Kural: backend'in ÜRETTİĞİ `message` ve `recovery_hint` kullanıcıya her
 * gösterim noktasında birlikte ulaşır. Kod-eşlemeli "dost" mesajlar burada
 * toplanır; view'lar kendi kopyalarını yazmaz (hint kaybı buradan doğardı).
 */
import type { AppError } from "../types/ipc";

export function errorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as AppError).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return "INTERNAL_ERROR";
}

/** Backend'in düz mesajı (yoksa jenerik düşüş). */
export function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as AppError).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "Beklenmeyen bir hata oluştu.";
}

/** Backend recovery_hint'i (yoksa undefined). */
export function errorHint(err: unknown): string | undefined {
  if (err && typeof err === "object" && "recovery_hint" in err) {
    const hint = (err as AppError).recovery_hint;
    if (typeof hint === "string" && hint.length > 0) return hint;
  }
  return undefined;
}

/**
 * Kod bazlı kullanıcı-dostu karşılıklar. Eşleşme yoksa backend mesajı
 * olduğu gibi kullanılır (dürüstlük ilkesi: uydurma mesaj yok).
 */
const FRIENDLY: Record<string, string> = {
  AUTH_REQUIRED: "Kimlik doğrulama gerekiyor. Lütfen tekrar bağlanın.",
  AUTH_EXPIRED:
    "GitHub kimlik doğrulaması geçersiz. GitHub ekranından hesabınızı yeniden bağlayın.",
  RATE_LIMITED: "GitHub API istek sınırı aşıldı. Lütfen biraz bekleyip tekrar deneyin.",
  PERMISSION_DENIED: "Bu kaynak için izniniz yok veya kapsam yetersiz.",
  NOT_FOUND: "Kaynak bulunamadı veya erişim izniniz yok.",
  CREDENTIAL_STORE_UNAVAILABLE:
    "İşletim sistemi kimlik deposu kullanılamıyor. GitHub hesabı bağlanamaz.",
  DEVICE_FLOW_EXPIRED: "Oturum süresi doldu. Lütfen tekrar başlatın.",
  NETWORK_ERROR: "Ağ hatası. İnternet bağlantınızı kontrol edin.",
  SERVER_ERROR: "GitHub sunucu hatası. Daha sonra tekrar deneyin.",
  REMOTE_EXISTS:
    "Bu depo zaten bir remote'a (origin) bağlı. Gönderim için alt bardaki Dışa Aktar butonunu kullanın.",
  REPO_NAME_INVALID:
    "Depo adı geçersiz: boş olamaz ve yalnızca harf, rakam, '-', '_', '.' içerebilir.",
};

/**
 * Gösterime hazır metin: dost mesaj (veya backend mesajı) + recovery_hint.
 * Satırları birleştirir; hint varsa AYRICA görünür — eski formatError'ların
 * ipucu yutma hatası burada kapalı.
 */
export function friendlyError(err: unknown): string {
  const code = errorCode(err);
  const base = FRIENDLY[code] ?? errorMessage(err);
  const hint = errorHint(err);
  return [base, hint].filter(Boolean).join("\n");
}
