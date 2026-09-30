import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';

import type {
  AudioFormat,
  AudioQuota,
  BakedFile,
  MediaInfo,
  MediaTools,
  SplitPreview,
  UploadProgress,
  UploadRecord,
} from '../utils/music';
import {
  checkMediaTools,
  DEFAULT_FORMAT,
  DEFAULT_GAIN_DB,
  DEFAULT_QUALITY,
  DEFAULT_SAMPLE_RATE,
  DEFAULT_SPEED,
  deleteUploadRecord,
  ensureMediaTools,
  fetchAudioQuota,
  getUploadHistory,
  importLocalMedia,
  importMediaFromUrl,
  pickLocalAudio,
  previewSplit,
  probeMedia,
  stripAudioExtension,
  stripExtension,
  uploadAudioParts,
} from '../utils/music';
import { useConfigStore } from './configStore';

/** Longest name Roblox accepts on an asset. */
const MAX_TITLE_LENGTH = 100;

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
  /** Level change applied to the render, in decibels. */
  gainDb: number;
  /** Encoder quality step, 0 (smallest) to 10 (best). */
  quality: number;
  format: AudioFormat;
  sampleRate: number;

  /** Path of the last rendered file, if the track has been exported. */
  exportedPath: string | null;
  /** Every rendered piece, when the track had to be split. */
  exportedFiles: BakedFile[];
  /** How the track will be cut up, refreshed as the edits change. */
  split: SplitPreview | null;
  busy: boolean;
}

export type TrackEdit = Partial<
  Pick<
    MusicTrack,
    | 'title'
    | 'speed'
    | 'semitones'
    | 'gainDb'
    | 'quality'
    | 'format'
    | 'sampleRate'
    | 'exportedPath'
    | 'exportedFiles'
  >
>;

/** Edits that change the rendered audio, so a previous bake no longer applies. */
const RENDER_EDIT_KEYS: (keyof TrackEdit)[] = [
  'title',
  'speed',
  'semitones',
  'gainDb',
  'quality',
  'format',
  'sampleRate',
];

interface MusicState {
  tools: MediaTools | null;
  tracks: MusicTrack[];
  error: string | null;
  notice: string | null;
  toolError: string | null;
  quota: AudioQuota | null;
  history: UploadRecord[];
  progress: UploadProgress | null;
  uploading: boolean;

  refreshTools: () => Promise<void>;
  refreshSplit: (id: string) => Promise<void>;
  installMissingTools: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  refreshQuota: () => Promise<void>;
  uploadTrack: (id: string) => Promise<void>;
  deleteRecord: (id: string) => Promise<void>;
  addFromUrl: (url: string) => Promise<void>;
  addFromFile: () => Promise<void>;
  remove: (id: string) => void;
  update: (id: string, edit: TrackEdit) => void;
  rename: (id: string, title: string) => void;
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
}

let counter = 0;
const nextId = () => {
  counter += 1;
  return `track-${Date.now()}-${counter}`;
};

/** The Roblox user id uploads are created against; "none" means no account. */
const uploaderUserId = (): number => {
  const selected = useConfigStore.getState().config.spoofing?.selectedUser;
  if (!selected || selected === 'none') return 0;
  const parsed = Number(selected);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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
  speed: DEFAULT_SPEED,
  semitones: 0,
  gainDb: DEFAULT_GAIN_DB,
  quality: DEFAULT_QUALITY,
  format: DEFAULT_FORMAT,
  sampleRate: DEFAULT_SAMPLE_RATE,
  exportedPath: null,
  exportedFiles: [],
  split: null,
  busy: false,
});

export const useMusicStore = create<MusicState>((set, get) => ({
  tools: null,
  tracks: [],
  error: null,
  notice: null,
  toolError: null,
  quota: null,
  history: [],
  progress: null,
  uploading: false,

  refreshHistory: async () => {
    try {
      set({ history: await getUploadHistory() });
    } catch {
      set({ history: [] });
    }
  },

  refreshQuota: async () => {
    const userId = uploaderUserId();
    if (!userId) {
      set({ quota: null });
      return;
    }
    try {
      set({ quota: await fetchAudioQuota(userId) });
    } catch {
      set({ quota: null });
    }
  },

  deleteRecord: async (id) => {
    try {
      await deleteUploadRecord(id);
      await get().refreshHistory();
    } catch (err) {
      set({ error: String(err) });
    }
  },

  uploadTrack: async (id) => {
    const track = get().tracks.find((candidate) => candidate.id === id);
    if (!track || track.exportedFiles.length === 0) return;

    const userId = uploaderUserId();
    if (!userId) {
      set({ error: 'no-uploader-account' });
      return;
    }

    set({ uploading: true, progress: null, error: null });
    try {
      const summary = await uploadAudioParts(
        track.exportedFiles.map((file) => file.path),
        track.exportedFiles.map((file) => file.displayName),
        userId,
      );
      set({ notice: summary.wasSplit ? 'split' : 'single' });
      await get().refreshHistory();
      await get().refreshQuota();
    } catch (err) {
      set({ error: String(err) });
    } finally {
      set({ uploading: false, progress: null });
    }
  },

  refreshTools: async () => {
    try {
      set({ tools: await checkMediaTools() });
    } catch {
      set({ tools: null });
    }
  },

  /**
   * Re-checks, installing yt-dlp on the spot when it is missing. The splash
   * screen normally does this first; this is the manual retry.
   */
  installMissingTools: async () => {
    set({ toolError: null });
    try {
      const { tools } = await ensureMediaTools();
      set({ tools });
    } catch (err) {
      set({ toolError: String(err) });
    }
  },

  addFromUrl: async (url) => {
    set({ error: null });
    const tools = get().tools;
    if (tools && !tools.ytdlp) {
      // One retry that installs it, rather than leaving the user with a
      // permanently disabled button after a failed splash-time attempt.
      await get().installMissingTools();
      if (get().tools && !get().tools?.ytdlp) {
        set({ error: 'yt-dlp-unavailable' });
        return;
      }
    }

    try {
      const media = await importMediaFromUrl(url);
      let info: MediaInfo | null = null;
      try {
        info = await probeMedia(media.path);
      } catch {
        // Metadata is a nicety; the track is still usable without it.
      }
      const track = toTrack(media, 'url', info);
      set((state) => ({ tracks: [...state.tracks, track] }));
      void get().refreshSplit(track.id);
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
      const track = toTrack(media, 'local', info);
      set((state) => ({ tracks: [...state.tracks, track] }));
      void get().refreshSplit(track.id);
    } catch (err) {
      set({ error: String(err) });
    }
  },

  remove: (id) => set((state) => ({ tracks: state.tracks.filter((track) => track.id !== id) })),

  update: (id, edit) => {
    set((state) => ({
      tracks: state.tracks.map((track) => {
        if (track.id !== id) return track;

        // A bake is only valid for the settings it was rendered with. Keeping a
        // stale one would make the next upload send the previous render while
        // the sliders show something else, so it is dropped here instead.
        const stale = RENDER_EDIT_KEYS.some((key) => key in edit);
        return stale
          ? { ...track, ...edit, exportedPath: null, exportedFiles: [] }
          : { ...track, ...edit };
      }),
    }));
    // The split depends on the edited length, so recompute after every change.
    void get().refreshSplit(id);
  },

  rename: (id, title) => {
    // Roblox shows the name as typed, and it already knows the format, so the
    // extension a user naturally types back in is dropped here rather than in
    // three different places. Only a real audio extension goes: "Mr. Blue Sky"
    // is a title, not a file name.
    const clean = stripAudioExtension(title).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH);
    const track = get().tracks.find((candidate) => candidate.id === id);
    // An empty field means the user cleared it to retype, not that the track
    // should lose its name.
    if (!track || !clean) return;
    // Opening the field and closing it again is not a rename, and must not throw
    // away a render that is still valid.
    if (clean === track.title) return;
    get().update(id, { title: clean });
  },

  refreshSplit: async (id) => {
    const track = get().tracks.find((candidate) => candidate.id === id);
    if (!track?.info?.duration) return;

    try {
      const split = await previewSplit({
        sourceDuration: track.info.duration,
        speed: track.speed,
        title: track.title,
        quality: track.quality,
        format: track.format,
        sampleRate: track.sampleRate,
      });
      // The track may have been edited or removed while this was in flight.
      if (!get().tracks.some((candidate) => candidate.id === id)) return;
      set((state) => ({
        tracks: state.tracks.map((candidate) =>
          candidate.id === id ? { ...candidate, split } : candidate,
        ),
      }));
    } catch {
      // Without a preview the export still works; it just renders in one go.
    }
  },

  setError: (message) => set({ error: message }),
  setNotice: (message) => set({ notice: message }),
}));

/**
 * Routes backend progress events into the store, so the Music view can render a
 * live bar without every component subscribing to the event bus itself.
 */
export const bindUploadProgress = () => {
  const unlisten = listen<UploadProgress>('music-upload-progress', (event) => {
    useMusicStore.setState({ progress: event.payload });
  });

  return () => {
    void unlisten.then((stop) => stop());
  };
};
