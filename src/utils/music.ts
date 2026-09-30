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

export const SPEED_RANGE = { min: 0.25, max: 4, step: 0.01 } as const;
export const PITCH_RANGE = { min: -12, max: 12, step: 1 } as const;
export const GAIN_RANGE = { min: -40, max: 20, step: 1 } as const;
export const QUALITY_RANGE = { min: 0, max: 10, step: 1 } as const;

/**
 * A track starts on Default rather than Normal.
 *
 * The editor exists to push a track's tempo, and Normal would be a special case
 * rather than the useful one. `DEFAULT_SPEED` is the value the Roblox hint is
 * derived from, so the two can never drift.
 */
export const DEFAULT_SPEED = 2.3;
export const DEFAULT_GAIN_DB = -4;
export const DEFAULT_QUALITY = 5;
export const DEFAULT_SAMPLE_RATE = 44100;

/** The output format the editor always renders. Roblox takes all three. */
export const DEFAULT_FORMAT: AudioFormat = 'mp3';

export interface SpeedPreset {
  value: number;
  /** Translation key, so the chip labels follow the selected language. */
  labelKey: string;
}

export const SPEED_PRESETS: SpeedPreset[] = [
  { value: 1, labelKey: 'music.presetNormal' },
  { value: 2.1, labelKey: 'music.presetSlow' },
  { value: 2.3, labelKey: 'music.presetDefault' },
  { value: 2.5, labelKey: 'music.presetFast' },
  { value: 2.7, labelKey: 'music.presetFaster' },
  { value: 2.9, labelKey: 'music.presetUltra' },
];

/** True when a speed is one of the presets, within slider rounding. */
export const activeSpeedPreset = (speed: number) =>
  SPEED_PRESETS.find((preset) => Math.abs(preset.value - speed) < 0.005);

/**
 * The `Sound.PlaybackSpeed` that plays a rendered track back at its own tempo.
 *
 * The render bakes the speed in, so Roblox has to divide it back out: a 2.3x
 * track needs 0.435. The value is what the Music view shows and copies, so the
 * two never disagree.
 */
export const robloxPlaybackSpeed = (speed: number) => {
  if (!Number.isFinite(speed) || speed <= 0) return '1.000';
  return (1 / speed).toFixed(3);
};

/** Encoded kbps for an MP3 at a quality step; mirrors the Rust ladder. */
const MP3_KBPS_BY_QUALITY = [64, 80, 96, 112, 128, 160, 192, 224, 256, 285, 320];

export const qualityBitrateKbps = (quality: number) =>
  MP3_KBPS_BY_QUALITY[Math.min(QUALITY_RANGE.max, Math.max(0, Math.round(quality)))];

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
  /** File name on disk, sanitised for the file system. */
  name: string;
  /** The name Roblox shows, exactly as the user typed it. */
  displayName: string;
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
  gainDb: number;
  quality: number;
  format: AudioFormat;
  sampleRate: number;
  sourceDuration?: number;
}) =>
  invoke<BakedMedia>('bake_media', {
    inputPath: input.path,
    outputName: input.title,
    speed: input.speed,
    semitones: input.semitones,
    gainDb: input.gainDb,
    quality: input.quality,
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
  quality: number;
  format: AudioFormat;
  sampleRate: number;
}) =>
  invoke<SplitPreview>('preview_split', {
    sourceDuration: input.sourceDuration,
    speed: input.speed,
    title: input.title,
    quality: input.quality,
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

/**
 * Removes a trailing audio extension from a name the user typed.
 *
 * Unlike {@link stripExtension} this only removes extensions Roblox recognises,
 * so a title that happens to contain a dot ("Mr. Blue Sky") survives a rename.
 * Mirrors `strip_audio_extension` on the Rust side, which sees the same name.
 */
export const stripAudioExtension = (name: string) => {
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  return AUDIO_EXTENSIONS.reduce(
    (kept, extension) =>
      lower.endsWith(`.${extension}`) ? trimmed.slice(0, -(extension.length + 1)) : kept,
    trimmed,
  );
};

export const formatDuration = (seconds: number | null | undefined) => {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--:--';
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export interface UploadedAsset {
  name: string;
  assetId: number;
  path: string;
  bytes: number;
}

export interface UploadSummary {
  /** Pieces Roblox has finished validating. */
  assets: UploadedAsset[];
  /** Accepted by Roblox but still being validated, so no asset id yet. */
  pending: string[];
  wasSplit: boolean;
}

export interface UploadProgress {
  file: string;
  index: number;
  total: number;
  sent: number;
  bytes: number;
  stage: string;
  /** Seconds the operation has been processing, so the UI can show a live
   *  elapsed counter instead of a frozen spinner. */
  processingElapsedSecs: number;
}

export interface AudioQuota {
  remaining: number;
  limit: number;
}

export interface RecordedAsset {
  name: string;
  assetId: number;
  path: string;
  bytes: number;
}

export interface UploadRecord {
  id: string;
  title: string;
  uploadedAt: string;
  wasSplit: boolean;
  totalBytes: number;
  assets: RecordedAsset[];
}

/**
 * Uploads rendered pieces in order.
 *
 * The names are sent separately because the file on disk has been through
 * sanitising and carries an extension, and neither belongs in a Roblox asset
 * name.
 */
export const uploadAudioParts = (paths: string[], names: string[], creatorUserId: number) =>
  invoke<UploadSummary>('upload_audio_parts', { paths, names, creatorUserId });

export const fetchAudioQuota = (creatorUserId: number) =>
  invoke<AudioQuota>('fetch_open_cloud_audio_quota', { creatorUserId });

export const getUploadHistory = () => invoke<UploadRecord[]>('get_upload_history');

export const deleteUploadRecord = (id: string) => invoke<boolean>('delete_upload_record', { id });

export const clearUploadHistory = () => invoke<boolean>('clear_upload_history');

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export const formatUploadDate = (iso: string) => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};
