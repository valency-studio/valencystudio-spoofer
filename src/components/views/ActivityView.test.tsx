import { invoke } from '@tauri-apps/api/core';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as ConfigContext from '../../contexts/ConfigContext';
import * as LanguageContext from '../../contexts/LanguageContext';
import * as ConfigStore from '../../stores/configStore';
import ActivityView from './ActivityView';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../../contexts/LanguageContext', () => ({
  useLanguage: vi.fn(),
}));

vi.mock('../../contexts/ConfigContext', () => ({
  useConfig: vi.fn(),
}));

vi.mock('../../stores/spooferStore', () => ({
  useSpooferStore: vi.fn(),
}));

vi.mock('../../stores/configStore', () => ({
  useConfigStore: vi.fn(),
}));

globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe('ActivityView', () => {
  const mockT = vi.fn((key) => key);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(LanguageContext.useLanguage).mockReturnValue({ t: mockT } as any);
    vi.mocked(ConfigContext.useConfig).mockReturnValue({
      config: { ui: { transparency: true } },
    } as any);
    vi.mocked(ConfigStore.useConfigStore).mockReturnValue({} as any);
  });

  it('renders history correctly', async () => {
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === 'get_upload_history') return Promise.resolve([]);
      return Promise.resolve([
        {
          id: '1',
          status: 'successful',
          startTime: '12:00:00',
          endTime: '12:01:00',
          durationMs: 60000,
          account: { id: '1', name: 'TestUser', avatarUrl: '' },
          assetResults: [{ id: '123', name: 'TestFile.rbxlx', success: true }],
          config: { assets: '[]', spoofSounds: false, downloadOnly: false },
          logFilePath: '',
        },
      ]);
    });

    render(<ActivityView />);

    expect(await screen.findByText('activity.spoofedTo')).toBeInTheDocument();
  });

  it('renders music upload history alongside jobs', async () => {
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === 'get_upload_history') {
        return Promise.resolve([
          {
            id: 'rec-1',
            title: 'My Song',
            uploadedAt: '2026-01-01T00:00:00Z',
            wasSplit: false,
            totalBytes: 1024,
            playbackSpeed: 2.3,
            pieces: [{ name: 'My Song', path: '/tmp/a.mp3', bytes: 1024, status: 'accepted' }],
          },
        ]);
      }
      return Promise.resolve([]);
    });

    render(<ActivityView />);

    expect(await screen.findByText('My Song')).toBeInTheDocument();
    expect(screen.getByText('music.history')).toBeInTheDocument();
    // The baked speed is on the row, so the PlaybackSpeed hint renders.
    expect(screen.getByText('music.robloxSpeedSnippet')).toBeInTheDocument();
  });
});
