/**
 * CB-08 — merkezi hata gösterimi: recovery_hint HİÇBİR gösterim noktasında
 * kaybolmamalı; dost mesaj eşlemesi backend mesajının önüne geçebilmeli.
 */
import { describe, it, expect } from "vitest";
import { errorCode, errorMessage, errorHint, friendlyError } from "./errors";

describe("lib/errors (CB-08)", () => {
  it("recovery_hint gösterilen metne her zaman eklenir", () => {
    const err = {
      code: "REMOTE_REJECTED",
      message: "non-fast-forward reddi",
      recovery_hint: "Önce git pull yapın.",
      recoverable: true,
      retryable: true,
      correlation_id: "x",
    };
    const text = friendlyError(err);
    expect(text).toContain("non-fast-forward reddi");
    expect(text).toContain("Önce git pull yapın.");
  });

  it("bilinen kod dost mesaja eşlenir, hint korunur", () => {
    const err = {
      code: "AUTH_EXPIRED",
      message: "raw backend text",
      recovery_hint: "GitHub ekranından yeniden bağlanın.",
      recoverable: true,
      retryable: false,
      correlation_id: "x",
    };
    const text = friendlyError(err);
    expect(text).toContain("kimlik doğrulaması geçersiz");
    expect(text).not.toContain("raw backend text");
    expect(text).toContain("GitHub ekranından yeniden bağlanın.");
  });

  it("hint yoksa yalnızca mesaj/dost metin döner", () => {
    expect(friendlyError({ code: "WEIRD", message: "yalnızca bu" })).toBe("yalnızca bu");
  });

  it("bilinmeyen yapı jenerik karşılanır, kod/mesaj/hint güvenle çözülür", () => {
    expect(errorCode(null)).toBe("INTERNAL_ERROR");
    expect(errorMessage("string hata")).toBe("Beklenmeyen bir hata oluştu.");
    expect(errorHint(undefined)).toBeUndefined();
  });
});
