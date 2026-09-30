import { beforeEach, describe, expect, it } from 'vitest';

import {
  activeSpeedPreset,
  DEFAULT_GAIN_DB,
  DEFAULT_QUALITY,
  DEFAULT_SPEED,
  qualityBitrateKbps,
  robloxPlaybackSpeed,
} from '../utils/music';
import { useMusicStore } from './musicStore';

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
