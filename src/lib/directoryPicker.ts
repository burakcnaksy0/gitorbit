/**
 * Native directory picker helpers.
 *
 * The dialog plugin is imported lazily so that unit tests and non-Tauri
 * builds that never open a picker do not pay for the module (and do not
 * crash when the plugin bridge is unavailable).
 */

import type { AppError } from "../types/ipc";

function asPickerError(err: unknown): AppError {
  return {
    code: "IO_ERROR",
    message: err instanceof Error ? err.message : "Klasör seçici açılamadı.",
    recoverable: true,
    retryable: true,
  };
}

/**
 * Opens the OS directory picker.
 *
 * @returns the selected absolute path, or `null` when the user cancels.
 */
export async function pickDirectory(title?: string): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
      title,
    });
    return typeof selected === "string" ? selected : null;
  } catch (err) {
    if (err instanceof Error && /cancel/i.test(err.message)) return null;
    throw asPickerError(err);
  }
}

/** Opens the OS file picker for a single file (e.g. an SSH key). */
export async function pickFile(title?: string): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: false,
      multiple: false,
      title,
    });
    return typeof selected === "string" ? selected : null;
  } catch (err) {
    if (err instanceof Error && /cancel/i.test(err.message)) return null;
    throw asPickerError(err);
  }
}
