/**
 * v0.2 madde 11 — OS bildirim kuralları: yalnızca pencere odaksızken gönder,
 * odaklıysa sessiz düş; izin yoksa akışı bozma.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const plugin = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-notification", () => plugin);

import { notifySystem, __setWindowFocusedForTests } from "./notifications";

beforeEach(() => {
  vi.clearAllMocks();
  plugin.sendNotification.mockImplementation(() => {});
});

describe("notifySystem (odak + izin kuralları)", () => {
  it("pencere odaklıyken bildirim GÖNDERMEZ (toast yeter)", async () => {
    __setWindowFocusedForTests(true);
    plugin.isPermissionGranted.mockResolvedValue(true);

    const sent = await notifySystem("Clone bitti", "repo");
    expect(sent).toBe(false);
    expect(plugin.sendNotification).not.toHaveBeenCalled();
  });

  it("pencere odaksız ve izin varken gönderir", async () => {
    __setWindowFocusedForTests(false);
    plugin.isPermissionGranted.mockResolvedValue(true);

    const sent = await notifySystem("Clone bitti", "repo");
    expect(sent).toBe(true);
    expect(plugin.sendNotification).toHaveBeenCalledWith({
      title: "Clone bitti",
      body: "repo",
    });
  });

  it("izin yoksa talep eder; reddedilirse sessizce düşer", async () => {
    __setWindowFocusedForTests(false);
    plugin.isPermissionGranted.mockResolvedValue(false);
    plugin.requestPermission.mockResolvedValue("denied");

    const sent = await notifySystem("Push reddedildi", "remote rejected");
    expect(plugin.requestPermission).toHaveBeenCalled();
    expect(sent).toBe(false);
    expect(plugin.sendNotification).not.toHaveBeenCalled();
  });

  it("izin talep edilip verilirse gönderir", async () => {
    __setWindowFocusedForTests(false);
    plugin.isPermissionGranted.mockResolvedValue(false);
    plugin.requestPermission.mockResolvedValue("granted");

    const sent = await notifySystem("Yayınlandı", "url");
    expect(sent).toBe(true);
    expect(plugin.sendNotification).toHaveBeenCalled();
  });

  it("köprü hatası akışı BOZMAZ — false döner", async () => {
    __setWindowFocusedForTests(false);
    plugin.isPermissionGranted.mockRejectedValue(new Error("no bridge"));

    await expect(notifySystem("Başlık", "gövde")).resolves.toBe(false);
  });
});
