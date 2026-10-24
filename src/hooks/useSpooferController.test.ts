import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as ConfigContext from '../contexts/ConfigContext';
import * as LanguageContext from '../contexts/LanguageContext';
import * as StudioConnectionContext from '../contexts/StudioConnectionContext';
import { useSpooferController } from './useSpooferController';

vi.mock('../contexts/LanguageContext', () => ({ useLanguage: vi.fn() }));
vi.mock('../contexts/ConfigContext', () => ({ useConfig: vi.fn() }));
vi.mock('../contexts/StudioConnectionContext', () => ({ useStudioConnectionState: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: vi.fn().mockResolvedValue(''),
}));

const emptyConfig = {
  accounts: [],
  ui: {},
  spoofing: {
    selectedUser: 'none',
    selectedGroup: 'none',
    cookie: '',
    apiKey: '',
    groupApiKey: '',
    audio: false,
    extraAssetIds: '',
    uploadTypes: [],
    downloadOnly: false,
    downloadPath: '',
    preserveMetadata: false,
  },
  advanced: {
    clipboardMonitoring: false,
    concurrentSpoofing: 1,
    concurrentDownloading: 1,
    maxConcurrency: 1,
    maxDownloadConcurrency: 1,
    skipOwned: false,
    excludedUserIds: '',
    excludedGroupIds: '',
    enableArchiveRecovery: false,
    proxyUrl: '',
    operationPollIntervalMs: 250,
    discoveryConcurrency: 30,
  },
};

describe('useSpooferController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(LanguageContext.useLanguage).mockReturnValue({
      t: vi.fn((key: string) => key),
      lang: 'en',
      setLang: vi.fn(),
    } as never);
    vi.mocked(ConfigContext.useConfig).mockReturnValue({
      config: emptyConfig,
      updateConfig: vi.fn(),
      updateCategory: vi.fn(),
    } as never);
    vi.mocked(StudioConnectionContext.useStudioConnectionState).mockReturnValue({
      studioConnected: false,
      studioPlaceId: null,
    } as never);
  });

  // The AssetExplorer is the only thing that can open these modals, and it does
  // so by dispatching a document event. If the wiring breaks, the paste/sheet
  // entry points silently do nothing.
  it('opens the paste-ids and scan-options overlays from document events', () => {
    const { result } = renderHook(() => useSpooferController());

    expect(result.current.pasteIdsOpen).toBe(false);
    expect(result.current.scanOptionsOpen).toBe(false);

    act(() => {
      document.dispatchEvent(new CustomEvent('ValencyStudio-open-paste-ids'));
      document.dispatchEvent(new CustomEvent('ValencyStudio-open-scan-options'));
    });

    expect(result.current.pasteIdsOpen).toBe(true);
    expect(result.current.scanOptionsOpen).toBe(true);
  });
});
