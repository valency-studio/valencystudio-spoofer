import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { open as openFilePicker } from '@tauri-apps/plugin-dialog';

// The command types come from the generated bindings so the two can never drift.
import type { AudioFormat, ImportedMedia, MediaInfo, MediaTools } from '../types/bindings';

export type { AudioFormat, ImportedMedia, MediaInfo, MediaTools };
export const AUDIO_FORMATS: { value: AudioFormat; label: string }[] = [
  { value: 'mp3', label: 'MP3' },
  { value: 'ogg', label: 'OGG' },
  { value: 'wav', label: 'WAV' },
];

export const SAMPLE_RATES = [22050, 44100, 48000];

export const SPEED_RANGE = { min: 0.25, max: 4, step: 0.05 } as const;
export const PITCH_RANGE = { min: -12, max: 12, step: 1 } as const;

const AUDIO_EXTENSIONS = ['mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac', 'webm', 'opus'];

export const checkMediaTools = () => invoke<MediaTools>('check_media_tools');

/**
 * Installs yt-dlp if it is missing and reports the final tool state.
 * Called from the splash screen so the Music view is ready on first paint.
 */
export const ensureMediaTools = () =>
  invoke<{ tools: MediaTools; ytdlpInstalled: boolean }>('ensure_media_tools');

export const probeMedia = (path: string) => invoke<MediaInfo>('probe_media', { path });

export const importMediaFromUrl = (url: string) =>
  invoke<ImportedMedia>('import_media_from_url', { url });

export const importLocalMedia = (path: string) =>
  invoke<ImportedMedia>('import_local_media', { path });

export interface BakedFile {
  name: string;
  path: string;
  bytes: number;
  outputDuration: number;
}

export interface BakedMedia {
  files: BakedFile[];
  totalDuration: number;
  wasSplit: boolean;
}

export interface SplitPlan {
  sourceStart: number;
  sourceEnd: number;
  outputDuration: number;
  name: string;
}

export interface SplitPreview {
  parts: SplitPlan[];
  outputDuration: number;
  needsSplit: boolean;
}

export const bakeMedia = (input: {
  path: string;
  title: string;
  speed: number;
  semitones: number;
  format: AudioFormat;
  sampleRate: number;
  sourceDuration?: number;
}) =>
  invoke<BakedMedia>('bake_media', {
    inputPath: input.path,
    outputName: input.title,
    speed: input.speed,
    semitones: input.semitones,
    // The Rust enum is serialised in camelCase, so the discriminant is lowercased.
    format: input.format,
    sampleRate: input.sampleRate,
    sourceDuration: input.sourceDuration,
  });

/** Works out how the track will be cut up without rendering anything. */
export const previewSplit = (input: {
  sourceDuration: number;
  speed: number;
  title: string;
  format: AudioFormat;
  sampleRate: number;
}) =>
  invoke<SplitPreview>('preview_split', {
    sourceDuration: input.sourceDuration,
    speed: input.speed,
    title: input.title,
    format: input.format,
    sampleRate: input.sampleRate,
  });

/** Opens the native picker and copies the chosen file into the app's media dir. */
export const pickLocalAudio = async (): Promise<string | null> => {
  const picked = await openFilePicker({
    multiple: false,
    directory: false,
    filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }],
  });

  const path = Array.isArray(picked) ? picked[0] : picked;
  return path ?? null;
};

/** Playable URL for a file that lives on disk. */
export const mediaSrc = (path: string) => convertFileSrc(path);

export const stripExtension = (name: string) => name.replace(/\.[^./\\]+$/, '');

export const formatDuration = (seconds: number | null | undefined) => {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--:--';
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};
