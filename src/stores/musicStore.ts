import { create } from 'zustand';

import type { AudioFormat, MediaInfo, MediaTools } from '../utils/music';
import {
  checkMediaTools,
  importLocalMedia,
  importMediaFromUrl,
  pickLocalAudio,
  probeMedia,
  stripExtension,
} from '../utils/music';

export interface MusicTrack {
  /** Stable client id; the file path can change after a bake. */
  id: string;
  title: string;
  path: string;
  source: 'local' | 'url';
  sourceUrl: string | null;
  uploader: string | null;
  thumbnailUrl: string | null;
  info: MediaInfo | null;

  // Edit state. The source file is never touched; edits describe the export.
  speed: number;
  semitones: number;
  format: AudioFormat;
  sampleRate: number;

  /** Path of the last rendered file, if the track has been exported. */
  exportedPath: string | null;
  busy: boolean;
}

export type TrackEdit = Partial<
  Pick<MusicTrack, 'speed' | 'semitones' | 'format' | 'sampleRate' | 'exportedPath'>
>;

interface MusicState {
  tools: MediaTools | null;
  tracks: MusicTrack[];
  error: string | null;
  notice: string | null;

  refreshTools: () => Promise<void>;
  addFromUrl: (url: string) => Promise<void>;
  addFromFile: () => Promise<void>;
  remove: (id: string) => void;
  update: (id: string, edit: TrackEdit) => void;
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
}

let counter = 0;
const nextId = () => {
  counter += 1;
  return `track-${Date.now()}-${counter}`;
};

const toTrack = (
  media: Awaited<ReturnType<typeof importMediaFromUrl>>,
  source: MusicTrack['source'],
  info: MediaInfo | null,
): MusicTrack => ({
  id: nextId(),
  title: stripExtension(media.title),
  path: media.path,
  source,
  sourceUrl: media.sourceUrl || null,
  uploader: media.uploader,
  thumbnailUrl: media.thumbnailUrl,
  info,
  speed: 1,
  semitones: 0,
  format: 'mp3',
  sampleRate: 44100,
  exportedPath: null,
  busy: false,
});

export const useMusicStore = create<MusicState>((set, get) => ({
  tools: null,
  tracks: [],
  error: null,
  notice: null,

  refreshTools: async () => {
    try {
      set({ tools: await checkMediaTools() });
    } catch {
      set({ tools: null });
    }
  },

  addFromUrl: async (url) => {
    set({ error: null });
    const tools = get().tools;
    if (tools && !tools.ytdlp) {
      set({ error: 'yt-dlp-not-installed' });
      return;
    }

    try {
      const media = await importMediaFromUrl(url);
      let info: MediaInfo | null = null;
      try {
        info = await probeMedia(media.path);
      } catch {
        // Metadata is a nicety; the track is still usable without it.
      }
      set((state) => ({ tracks: [...state.tracks, toTrack(media, 'url', info)] }));
    } catch (err) {
      set({ error: String(err) });
    }
  },

  addFromFile: async () => {
    set({ error: null });
    try {
      const picked = await pickLocalAudio();
      if (!picked) return;

      const media = await importLocalMedia(picked);
      let info: MediaInfo | null = null;
      try {
        info = await probeMedia(media.path);
      } catch {
        // Same as above: a track without probe data is still importable.
      }
      set((state) => ({ tracks: [...state.tracks, toTrack(media, 'local', info)] }));
    } catch (err) {
      set({ error: String(err) });
    }
  },

  remove: (id) => set((state) => ({ tracks: state.tracks.filter((track) => track.id !== id) })),

  update: (id, edit) =>
    set((state) => ({
      tracks: state.tracks.map((track) => (track.id === id ? { ...track, ...edit } : track)),
    })),

  setError: (message) => set({ error: message }),
  setNotice: (message) => set({ notice: message }),
}));
