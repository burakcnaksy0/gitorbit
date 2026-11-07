/**
 * v0.2 madde 9 — sürükle-bırak kancası: Tauri olay → overlay durumu + callback.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

type Handler = (event: { payload: { type: string; paths?: string[] } }) => void;

const plugin = vi.hoisted(() => ({
  registered: null as Handler | null,
  unlisten: vi.fn(),
  failNext: false,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => {
    if (plugin.failNext) throw new Error("no bridge");
    return {
      onDragDropEvent: async (handler: Handler) => {
        plugin.registered = handler;
        return plugin.unlisten;
      },
    };
  },
}));

import { useFolderDrop } from "./useFolderDrop";

beforeEach(() => {
  plugin.registered = null;
  vi.clearAllMocks();
});

describe("useFolderDrop", () => {
  it("enter/leave overlay durumunu acar/kapatir; drop yollari iletir", async () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useFolderDrop(onDrop));

    // handler asenkron kayit olur
    await act(async () => {
      await Promise.resolve();
    });
    expect(plugin.registered).toBeTypeOf("function");

    act(() => plugin.registered!({ payload: { type: "enter" } }));
    expect(result.current.isDragging).toBe(true);

    act(() => plugin.registered!({ payload: { type: "leave" } }));
    expect(result.current.isDragging).toBe(false);

    act(() =>
      plugin.registered!({
        payload: { type: "drop", paths: ["/home/user/proje", "/home/user/diger"] },
      })
    );
    expect(result.current.isDragging).toBe(false);
    expect(onDrop).toHaveBeenCalledWith(["/home/user/proje", "/home/user/diger"]);
  });

  it("köprü yoksa (API hatası) patlamaz", async () => {
    plugin.failNext = true;
    const { result } = renderHook(() => useFolderDrop(vi.fn()));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isDragging).toBe(false);
    plugin.failNext = false;
  });
});
