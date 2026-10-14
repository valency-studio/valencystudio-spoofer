import { emit } from '@tauri-apps/api/event';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigProvider } from '../../../contexts/ConfigContext';
import { useConfigStore } from '../../../stores/configStore';
import { useMusicStore } from '../../../stores/musicStore';
import * as music from '../../../utils/music';
import MusicView from './MusicView';

vi.mock('../../../utils/music', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/music')>();
  return {
    ...actual,
    checkMediaTools: vi.fn(),
    fetchAudioQuota: vi.fn().mockResolvedValue(null),
    getUploadHistory: vi.fn().mockResolvedValue([]),
    installFfmpeg: vi.fn(),
    resumePendingValidations: vi.fn().mockResolvedValue(0),
  };
});

const renderMusicView = () =>
  render(
    <ConfigProvider>
      <MusicView />
    </ConfigProvider>,
  );

describe('MusicView FFmpeg requirement', () => {
  beforeEach(() => {
    useMusicStore.setState({
      tools: null,
      tracks: [],
      error: null,
      status: null,
      toolError: null,
      quota: null,
      history: [],
      progress: null,
      uploading: false,
    });
    useConfigStore.getState().updateConfig('ui', 'activeTab', 'music');
    vi.mocked(music.checkMediaTools).mockResolvedValue({
      ffmpeg: false,
      ffprobe: false,
      ytdlp: true,
    });
  });

  it('requires the user to install FFmpeg before using Music', async () => {
    renderMusicView();

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'FFmpeg belum terpasang' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install FFmpeg' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kembali ke Spoofer' })).toBeInTheDocument();
  });

  it('returns to Spoofer when the user chooses not to install FFmpeg', async () => {
    renderMusicView();
    await screen.findByRole('dialog');

    screen.getByRole('button', { name: 'Kembali ke Spoofer' }).click();

    await waitFor(() => {
      expect(useConfigStore.getState().config.ui.activeTab).toBe('spoofing');
    });
  });

  it('shows Winget output and a restart notice after installation', async () => {
    vi.mocked(music.installFfmpeg).mockImplementation(async () => {
      await emit('ffmpeg-install-output', 'Successfully installed FFmpeg');
    });
    renderMusicView();
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Install FFmpeg' }));

    expect(await screen.findByRole('log')).toHaveTextContent('Successfully installed FFmpeg');
    expect(await screen.findByText(/Buka ulang aplikasi/)).toBeInTheDocument();
  });

  it('shows a useful error when Winget cannot install FFmpeg', async () => {
    vi.mocked(music.installFfmpeg).mockRejectedValue(new Error('Winget is unavailable'));
    renderMusicView();
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Install FFmpeg' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Winget gagal memasang FFmpeg');
    expect(screen.getByRole('alert')).toHaveTextContent('Winget is unavailable');
  });

  it('lets the user enter Music when FFmpeg is already installed', async () => {
    vi.mocked(music.checkMediaTools).mockResolvedValue({
      ffmpeg: true,
      ffprobe: true,
      ytdlp: true,
    });

    renderMusicView();

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Tambah lagu')).toBeInTheDocument();
  });
});
