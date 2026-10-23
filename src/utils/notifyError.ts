import { invoke } from '@tauri-apps/api/core';

import { isTauriRuntime } from './tauriRuntime';

/**
 * The user-facing half of a backend error.
 *
 * Rust serialises `AppError` as a JSON string of `{ message, debug }`, so
 * rendering the raw value puts a debug blob on screen. This keeps the message
 * and sends the debug half to the console, where it is still available for a
 * bug report. Anything that is not that shape is passed through untouched.
 */
export function readableError(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.message) {
      if (parsed.debug) console.error('[Backend Error Context]', parsed.debug);
      return String(parsed.message);
    }
  } catch {}
  return raw;
}

export async function notifyError(title: string, message?: string) {
  let displayMessage = message ?? title;

  if (message) {
    try {
      const parsed = JSON.parse(message);
      if (parsed.message && parsed.debug) {
        displayMessage = parsed.message;
        console.error(`[Backend Error Context] ${title}`, parsed.debug);
      }
    } catch {}
  }

  const body = displayMessage !== title ? displayMessage : '';

  if (isTauriRuntime()) {
    try {
      await invoke('show_notification', { options: { title, body } });
      return;
    } catch {}
  }
  console.error(title, displayMessage);
}
