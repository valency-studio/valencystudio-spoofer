import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { open as openFilePicker } from '@tauri-apps/plugin-dialog';

export type AudioFormat = 'mp3' | 'ogg' | 'wav';

export interface MediaTools {
  ffmpeg: boolean;
  ffprobe: boolean;
  ytdlp: boolean;
}

export interface MediaInfo {
  duration: number | null;
  sampleRate: number | null;
  channels: number | null;
  bitRate: number | null;
  formatName: string;
}

export interface ImportedMedia {
  path: string;
  title: string;
  uploader: string | null;
  thumbnailUrl: string | null;
  sourceUrl: string;
}

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

export const probeMedia = (path: string) => invoke<MediaInfo>('probe_media', { path });

export const importMediaFromUrl = (url: string) =>
  invoke<ImportedMedia>('import_media_from_url', { url });

export const importLocalMedia = (path: string) =>
  invoke<ImportedMedia>('import_local_media', { path });

export const bakeMedia = (input: {
  path: string;
  title: string;
  speed: number;
  semitones: number;
  format: AudioFormat;
  sampleRate: number;
}) =>
  invoke<ImportedMedia>('bake_media', {
    inputPath: input.path,
    outputName: input.title,
    speed: input.speed,
    semitones: input.semitones,
    // The Rust enum is serialised in camelCase, so the discriminant is lowercased.
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
