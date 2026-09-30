import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  activeSpeedPreset,
  DEFAULT_GAIN_DB,
  DEFAULT_QUALITY,
  DEFAULT_SPEED,
  qualityBitrateKbps,
  robloxPlaybackSpeed,
  uploadAudioParts,
} from '../utils/music';
import { useConfigStore } from './configStore';
import { useMusicStore } from './musicStore';

vi.mock('../utils/music', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/music')>();
  return { ...actual, uploadAudioParts: vi.fn() };
});

const mockedUpload = vi.mocked(uploadAudioParts);

/** Puts one track in the store and returns its id. */
const seedTrack = () => {
  const id = 'track-test';
  useMusicStore.setState({
    tracks: [
      {
        id,
        title: 'Original',
        path: 'C:/media/original.mp3',
        source: 'local',
        sourceUrl: null,
        uploader: null,
        thumbnailUrl: null,
        info: { duration: 300, sampleRate: 44100, channels: 2, bitRate: 320000, formatName: 'mp3' },
        speed: DEFAULT_SPEED,
        semitones: 0,
        gainDb: DEFAULT_GAIN_DB,
        quality: DEFAULT_QUALITY,
        format: 'mp3',
        sampleRate: 44100,
        exportedPath: 'C:/media/original.mp3',
        exportedFiles: [
          {
            name: 'original',
            displayName: 'Original',
            path: 'C:/media/original.mp3',
            bytes: 1024,
            outputDuration: 300,
          },
        ],
        split: null,
        busy: false,
      },
    ],
  });
  return id;
};

const track = (id: string) => useMusicStore.getState().tracks.find((item) => item.id === id);

describe('musicStore defaults', () => {
  it('starts a track on the Default preset, not Normal', () => {
    // Normal is a special case, so the useful value has to be the default.
    expect(DEFAULT_SPEED).toBe(2.3);
    expect(activeSpeedPreset(DEFAULT_SPEED)?.labelKey).toBe('music.presetDefault');
  });

  it('ships the documented defaults', () => {
    expect(DEFAULT_GAIN_DB).toBe(-4);
    expect(DEFAULT_QUALITY).toBe(5);
  });
});

describe('rename', () => {
  let id: string;
  beforeEach(() => {
    id = seedTrack();
  });

  it('strips an audio extension the user types back in', () => {
    useMusicStore.getState().rename(id, 'My Song.mp3');
    expect(track(id)?.title).toBe('My Song');
  });

  it('keeps a dot that is part of the title', () => {
    useMusicStore.getState().rename(id, 'Mr. Blue Sky');
    expect(track(id)?.title).toBe('Mr. Blue Sky');
  });

  it('collapses whitespace and trims', () => {
    useMusicStore.getState().rename(id, '  Spaced   Out  ');
    expect(track(id)?.title).toBe('Spaced Out');
  });

  it('ignores an empty name instead of losing the title', () => {
    useMusicStore.getState().rename(id, '   ');
    expect(track(id)?.title).toBe('Original');
  });

  it('cuts a name at the length Roblox accepts', () => {
    useMusicStore.getState().rename(id, 'n'.repeat(250));
    expect(track(id)?.title).toHaveLength(100);
  });

  it('drops a bake that was rendered under the old name', () => {
    useMusicStore.getState().rename(id, 'Renamed');
    expect(track(id)?.exportedFiles).toEqual([]);
    expect(track(id)?.exportedPath).toBeNull();
  });

  it('keeps the bake when the name comes back unchanged', () => {
    useMusicStore.getState().rename(id, 'Original');
    expect(track(id)?.exportedFiles).toHaveLength(1);
  });
});

describe('edit invalidation', () => {
  let id: string;
  beforeEach(() => {
    id = seedTrack();
  });

  const expectBakeDropped = (label: string) => {
    const current = track(id);
    expect(current?.exportedFiles, label).toEqual([]);
    expect(current?.exportedPath, label).toBeNull();
  };

  it('drops the bake when the render settings change', () => {
    for (const edit of [
      { speed: 2.5 },
      { semitones: 3 },
      { gainDb: -8 },
      { quality: 8 },
      { sampleRate: 48000 },
    ]) {
      useMusicStore.getState().update(id, edit);
      expectBakeDropped(JSON.stringify(edit));
    }
  });

  it('keeps the bake when a render is recorded', () => {
    // Recording the result is not an edit: wiping it here would make every
    // upload drop the file it just produced.
    useMusicStore.getState().update(id, {
      exportedPath: 'C:/media/other.mp3',
      exportedFiles: [
        {
          name: 'other',
          displayName: 'Other',
          path: 'C:/media/other.mp3',
          bytes: 2048,
          outputDuration: 150,
        },
      ],
    });
    expect(track(id)?.exportedFiles).toHaveLength(1);
    expect(track(id)?.exportedPath).toBe('C:/media/other.mp3');
  });
});

describe('robloxPlaybackSpeed', () => {
  it('divides the baked speed back out', () => {
    // The value the Music view shows for the default preset.
    expect(robloxPlaybackSpeed(2.3)).toBe('0.435');
    expect(robloxPlaybackSpeed(1)).toBe('1.000');
    expect(robloxPlaybackSpeed(2)).toBe('0.500');
  });

  it('falls back to neutral rather than dividing by zero', () => {
    expect(robloxPlaybackSpeed(0)).toBe('1.000');
    expect(robloxPlaybackSpeed(Number.NaN)).toBe('1.000');
  });
});

describe('qualityBitrateKbps', () => {
  it('follows the same ladder as the encoder', () => {
    expect(qualityBitrateKbps(0)).toBe(64);
    expect(qualityBitrateKbps(5)).toBe(160);
    expect(qualityBitrateKbps(10)).toBe(320);
  });

  it('clamps out of range steps instead of returning undefined', () => {
    expect(qualityBitrateKbps(-3)).toBe(64);
    expect(qualityBitrateKbps(99)).toBe(320);
  });
});

describe('activeSpeedPreset', () => {
  it('recognises a preset exactly', () => {
    expect(activeSpeedPreset(2.3)?.value).toBe(2.3);
    expect(activeSpeedPreset(1)?.value).toBe(1);
  });

  it('has no preset for a custom speed', () => {
    // One slider step away from a preset is a custom speed in its own right.
    expect(activeSpeedPreset(2.31)).toBeUndefined();
    expect(activeSpeedPreset(1.77)).toBeUndefined();
  });
});

describe('uploadTrack status', () => {
  let id: string;
  beforeEach(() => {
    vi.clearAllMocks();
    id = seedTrack();
    useConfigStore.setState((state) => ({
      config: { ...state.config, spoofing: { ...state.config.spoofing, selectedUser: '12345' } },
    }));
    useMusicStore.setState({ status: null, uploading: false, error: null });
    useMusicStore.getState().refreshHistory = vi.fn().mockResolvedValue(undefined);
    useMusicStore.getState().refreshQuota = vi.fn().mockResolvedValue(undefined);
  });

  it('reports the upload as sent as soon as the bytes are with Roblox', async () => {
    // Validation is deliberately not waited on here. The call returns once the
    // bytes land, and the history row carries the verdict from then on.
    mockedUpload.mockResolvedValue({ recordId: 'rec-1', accepted: [], wasSplit: false });

    await useMusicStore.getState().uploadTrack(id);

    expect(useMusicStore.getState().status).toEqual({ kind: 'sent', recordId: 'rec-1' });
  });

  it('leaves the track out of the queue even when no id exists yet', async () => {
    // A split track has no ids at all by the time the call returns, because
    // Roblox validates afterwards. The track still belongs in the history, so it
    // still leaves the queue.
    mockedUpload.mockResolvedValue({ recordId: 'rec-2', accepted: [], wasSplit: true });

    await useMusicStore.getState().uploadTrack(id);

    expect(useMusicStore.getState().status).toEqual({ kind: 'sent', recordId: 'rec-2' });
    expect(useMusicStore.getState().tracks.some((track) => track.id === id)).toBe(false);
  });

  it('clears the track out of the queue so it cannot be uploaded twice', async () => {
    // The queue only holds tracks still waiting to be sent. Once the bytes are
    // gone the track belongs to the history section, and a second click on it
    // would spend quota re-uploading audio Roblox already has.
    mockedUpload.mockResolvedValue({ recordId: 'rec-3', accepted: [], wasSplit: false });

    expect(useMusicStore.getState().tracks.some((track) => track.id === id)).toBe(true);
    await useMusicStore.getState().uploadTrack(id);

    expect(useMusicStore.getState().tracks.some((track) => track.id === id)).toBe(false);
  });

  it('clears the progress bar once the upload settles', async () => {
    // The reported bug: an upload Roblox had accepted still sat on a progress
    // bar. The bar is scoped to `uploading`, which is cleared in a `finally`, so
    // it cannot outlive the call it was measuring.
    mockedUpload.mockResolvedValue({ recordId: 'rec-6', accepted: [], wasSplit: false });
    useMusicStore.setState({
      progress: {
        file: 'Original',
        index: 0,
        total: 1,
        sent: 10,
        bytes: 10,
        stage: 'uploading',
        processingElapsedSecs: 0,
      },
    });

    await useMusicStore.getState().uploadTrack(id);

    expect(useMusicStore.getState().uploading).toBe(false);
    expect(useMusicStore.getState().progress).toBeNull();
  });

  it('clears the progress bar when the upload fails too', async () => {
    // A failed upload is the case that used to leave the bar up forever, because
    // the clear only happened on the success path.
    mockedUpload.mockRejectedValue('nope');
    useMusicStore.setState({
      progress: {
        file: 'Original',
        index: 0,
        total: 1,
        sent: 5,
        bytes: 10,
        stage: 'uploading',
        processingElapsedSecs: 0,
      },
    });

    await useMusicStore.getState().uploadTrack(id);

    expect(useMusicStore.getState().uploading).toBe(false);
    expect(useMusicStore.getState().progress).toBeNull();
  });

  it('refuses a second upload while one is already in flight', async () => {
    // The queue row is disabled, but a second call can still arrive before React
    // re-renders. Without this guard the user would spend quota twice.
    let release: (() => void) | undefined;
    mockedUpload.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ recordId: 'rec-7', accepted: [], wasSplit: false });
        }),
    );

    const first = useMusicStore.getState().uploadTrack(id);
    await useMusicStore.getState().uploadTrack(id);
    release?.();
    await first;

    expect(mockedUpload).toHaveBeenCalledTimes(1);
  });

  it('keeps the track in the queue when the upload fails', async () => {
    // Removing the track on failure would throw away the rendered file the user
    // needs to retry with, forcing a re-import and a re-render.
    mockedUpload.mockRejectedValue('Roblox rejected the upload (HTTP 400): nope');

    await useMusicStore.getState().uploadTrack(id);

    expect(useMusicStore.getState().tracks.some((track) => track.id === id)).toBe(true);
  });

  it('refreshes history so the confirmed asset ids are findable', async () => {
    // A definitive result is only useful if the user can get back to the asset
    // id afterwards, which is what the history list is for.
    mockedUpload.mockResolvedValue({ recordId: 'rec-4', accepted: [], wasSplit: false });

    await useMusicStore.getState().uploadTrack(id);

    expect(useMusicStore.getState().refreshHistory).toHaveBeenCalled();
    expect(useMusicStore.getState().refreshQuota).toHaveBeenCalled();
  });

  it('reports a refused upload as rejected', async () => {
    mockedUpload.mockRejectedValue('Roblox rejected the upload (HTTP 400): nope');

    await useMusicStore.getState().uploadTrack(id);

    expect(useMusicStore.getState().status).toEqual({
      kind: 'rejected',
      reason: 'failed',
      message: 'Roblox rejected the upload (HTTP 400): nope',
    });
  });

  it('sends the name chosen in the editor, not the file name', async () => {
    mockedUpload.mockResolvedValue({ recordId: 'rec-5', accepted: [], wasSplit: false });

    await useMusicStore.getState().uploadTrack(id);

    expect(mockedUpload).toHaveBeenCalledWith(['C:/media/original.mp3'], ['Original'], 12345);
  });

  it('clears a previous outcome before starting again', async () => {
    useMusicStore.setState({ status: { kind: 'sent', recordId: 'old' } });
    let release: (() => void) | undefined;
    mockedUpload.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ recordId: 'new', accepted: [], wasSplit: false });
        }),
    );

    const pending = useMusicStore.getState().uploadTrack(id);
    expect(useMusicStore.getState().status).toBeNull();
    release?.();
    await pending;
  });

  it('does not call Roblox without an account', async () => {
    useConfigStore.setState((state) => ({
      config: { ...state.config, spoofing: { ...state.config.spoofing, selectedUser: 'none' } },
    }));

    await useMusicStore.getState().uploadTrack(id);

    expect(mockedUpload).not.toHaveBeenCalled();
    expect(useMusicStore.getState().status).toMatchObject({
      kind: 'rejected',
      reason: 'no-account',
    });
  });
});
