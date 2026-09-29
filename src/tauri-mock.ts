/**
 * Browser stand-in for the Tauri modules this app imports.
 *
 * `vite.config.ts` aliases the `@tauri-apps/*` modules to this file when
 * `VITE_WEB_PREVIEW=true`, so the app can be opened in a plain browser for
 * design review without a Rust toolchain. Every export here is a no-op that
 * resolves, never rejects, so callers keep their normal code paths.
 *
 * The window-level Tauri internals are stubbed separately by
 * `src/utils/browserTauriMock.ts`, which is installed in `main.tsx`.
 */

const noop = () => {};

/** Mirrors the unlisten function that `listen` returns. */
const noopUnlisten = () => Promise.resolve(() => {});

/**
 * Delegates to the `__TAURI_INTERNALS__` shim that `main.tsx` installs, so the
 * preview gets the same stubbed command results as a normal browser run rather
 * than a bare null for everything.
 */
export const invoke = async (cmd: string, args?: unknown): Promise<unknown> => {
  if (import.meta.env.DEV) {
    console.debug(`[tauri-mock] invoke(${cmd})`);
  }

  const internals = (globalThis as { __TAURI_INTERNALS__?: { invoke?: unknown } })
    .__TAURI_INTERNALS__;
  const inner = internals?.invoke;

  if (typeof inner === 'function') {
    return (inner as (c: string, a?: unknown) => Promise<unknown>)(cmd, args);
  }
  return null;
};

export const emit = async (): Promise<void> => {};

export const listen = async (): Promise<() => void> => noopUnlisten;

export const once = async (): Promise<() => void> => noopUnlisten;

export const addPluginListener = async (): Promise<() => void> => noopUnlisten;

/**
 * The Tauri plugin packages import these from `@tauri-apps/api/core`, so the
 * alias has to satisfy them too or dependency optimisation fails.
 */
export class Channel<T> {
  onmessage: ((message: T) => void) | null = null;

  constructor(_handler?: (message: T) => void) {
    this.onmessage = _handler ?? null;
  }
}

export class Resource<T> {
  constructor(private readonly value: T) {}

  get data(): T {
    return this.value;
  }
}

export const getVersion = async (): Promise<string> => 'browser-preview';

export const isRegistered = async (): Promise<boolean> => false;

export const register = async (): Promise<boolean> => false;

export const unregister = async (): Promise<void> => {};

export const registerAll = async (): Promise<void> => {};

export const unregisterAll = async (): Promise<void> => {};

/**
 * Only the handful of methods the chrome actually calls are implemented; the
 * rest resolve as no-ops so an unmocked call cannot crash the preview.
 */
export const getCurrentWindow = () => ({
  startDragging: async () => {},
  minimize: async () => {},
  toggleMaximize: async () => {},
  close: async () => {},
  hide: async () => {},
  show: async () => {},
  setAlwaysOnTop: async () => {},
  setTitle: async () => {},
  isMaximized: async () => false,
  isFullscreen: async () => false,
  isFocused: async () => true,
  isVisible: async () => true,
  onResized: async () => noopUnlisten,
  onMoved: async () => noopUnlisten,
  listen: async () => noopUnlisten,
  addEventListener: noop,
});

export { noop as __noop };
