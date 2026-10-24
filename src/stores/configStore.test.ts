import * as tauriCore from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppConfigSchema, DEFAULT_APP_CONFIG, useConfigStore } from './configStore';

vi.mock('../utils/tauriRuntime', () => ({
  isTauriRuntime: vi.fn().mockReturnValue(true),
}));

describe('configStore', () => {
  const storeData: Record<string, string> = {};
  const mockLocalStorage = {
    getItem: vi.fn((key: string) => storeData[key] || null),
    setItem: vi.fn((key: string, val: string) => {
      storeData[key] = val;
    }),
    clear: vi.fn(() => {
      for (const k of Object.keys(storeData)) delete storeData[k];
    }),
  };

  beforeEach(() => {
    vi.stubGlobal('localStorage', mockLocalStorage);
    localStorage.clear();
    useConfigStore.getState().resetConfig();
    vi.clearAllMocks();
  });

  it('initializes with default config', () => {
    const { config } = useConfigStore.getState();
    expect(config).toEqual(DEFAULT_APP_CONFIG);
  });

  it('updates a specific config value', () => {
    useConfigStore.getState().updateConfig('general', 'desktopNotifications', false);
    const { config } = useConfigStore.getState();
    expect(config.general.desktopNotifications).toBe(false);
  });

  it('updates an entire category', () => {
    useConfigStore
      .getState()
      .updateCategory('spoofing', { cookie: 'test_cookie', apiKey: 'test_key' });
    const { config } = useConfigStore.getState();
    expect(config.spoofing.cookie).toBe('test_cookie');
    expect(config.spoofing.apiKey).toBe('test_key');
  });

  it('resets to default config', () => {
    useConfigStore.getState().updateConfig('general', 'desktopNotifications', false);
    useConfigStore.getState().resetConfig();
    const { config } = useConfigStore.getState();
    expect(config.general.desktopNotifications).toBe(true);
  });

  it('loads secrets from backend', async () => {
    const invokeMock = (tauriCore.invoke as any).mockResolvedValueOnce({
      cookie: 'backend_cookie',
      apiKey: 'backend_key',
    });

    await useConfigStore.getState().loadSecrets();
    const { config } = useConfigStore.getState();

    expect(invokeMock).toHaveBeenCalledWith('load_profile_secrets');
    expect(config.spoofing.cookie).toBe('backend_cookie');
    expect(config.spoofing.apiKey).toBe('backend_key');
  });

  it('saves secrets to backend', async () => {
    const invokeMock = (tauriCore.invoke as any).mockResolvedValueOnce(undefined);

    useConfigStore.setState({ secretsLoaded: true });

    useConfigStore
      .getState()
      .updateCategory('spoofing', { cookie: 'new_cookie', apiKey: 'new_key' });
    await useConfigStore.getState().saveSecrets();

    expect(invokeMock).toHaveBeenCalledWith('save_profile_secrets', {
      data: {
        cookie: 'new_cookie',
        apiKey: 'new_key',
        groupApiKey: '',
        profileCookies: {},
        accountSecrets: {},
      },
    });
  });

  it('does not save secrets before the initial load completes', async () => {
    const invokeMock = (tauriCore.invoke as any).mockResolvedValueOnce(undefined);
    useConfigStore.setState({ secretsLoaded: false });

    useConfigStore
      .getState()
      .updateCategory('spoofing', { cookie: 'race_cookie', apiKey: 'race_key' });
    await useConfigStore.getState().saveSecrets();

    expect(invokeMock).not.toHaveBeenCalled();
  });

  // Existing installs still carry the keys this schema no longer declares. They must be
  // dropped silently on load, never fail validation, and never resurrect a removed slice.
  it('migrates a saved config containing removed keys to defaults', async () => {
    const parsed = AppConfigSchema.safeParse({
      ...DEFAULT_APP_CONFIG,
      spoofing: {
        ...DEFAULT_APP_CONFIG.spoofing,
        enableSpoofing: true,
        animation: false,
        images: false,
        meshes: false,
        videos: false,
        scriptRefs: false,
      },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.spoofing).not.toHaveProperty('enableSpoofing');

    const legacy = {
      general: { desktopNotifications: false },
      advanced: { enablePluginSpoofing: true, forcePlaceIds: '123456789' },
      spoofing: {
        animation: false,
        images: false,
        meshes: false,
        videos: false,
        scriptRefs: false,
        enableSpoofing: true,
        audio: false,
      },
      ui: {
        homeUpdateSections: ['changelog', 'announcements'],
        settingsSections: ['account'],
        configSections: ['credentials'],
        spoofingSections: ['targets'],
      },
      accounts: [],
    };
    mockLocalStorage.setItem('ValencyStudio - Spoofer_Config', JSON.stringify(legacy));

    vi.resetModules();
    const fresh = await import('./configStore');
    const { config } = fresh.useConfigStore.getState();

    expect(config.general.desktopNotifications).toBe(false);
    expect(config.advanced).toEqual(fresh.DEFAULT_APP_CONFIG.advanced);
    expect(config.ui).toEqual(fresh.DEFAULT_APP_CONFIG.ui);
    expect(config.spoofing).toEqual({
      ...fresh.DEFAULT_APP_CONFIG.spoofing,
      audio: false,
      cookie: '',
      apiKey: '',
      groupApiKey: '',
    });
    for (const removed of [
      'animation',
      'images',
      'meshes',
      'videos',
      'scriptRefs',
      'enableSpoofing',
    ]) {
      expect(config.spoofing).not.toHaveProperty(removed);
    }
    expect(config.advanced).not.toHaveProperty('enablePluginSpoofing');
    expect(config.advanced).not.toHaveProperty('forcePlaceIds');
    for (const removed of [
      'homeUpdateSections',
      'settingsSections',
      'configSections',
      'spoofingSections',
    ]) {
      expect(config.ui).not.toHaveProperty(removed);
    }
  });
});
