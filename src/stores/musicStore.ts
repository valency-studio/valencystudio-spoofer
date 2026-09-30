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
  resumePendingValidations,
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

/**
 * How far an upload has got.
 *
 * The backend now blocks until Roblox returns a definitive answer, so there is
 * never a `pending` state. Every upload lands as either `accepted` or
 * `rejected`, and the result goes straight into upload history.
 */
export type UploadStatus =
  | { kind: 'sent'; recordId: string }
  | { kind: 'rejected'; reason: 'no-account' | 'failed'; message: string };

interface MusicState {
  tools: MediaTools | null;
  tracks: MusicTrack[];
  /** Import failures only. An upload that is refused is an `UploadStatus`. */
  error: string | null;
  status: UploadStatus | null;
  toolError: string | null;
  quota: AudioQuota | null;
  history: UploadRecord[];
  progress: UploadProgress | null;
  uploading: boolean;

  refreshTools: () => Promise<void>;
  refreshSplit: (id: string) => Promise<void>;
  installMissingTools: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  /**
   * Re-reads the history and asks the backend to pick up validation that a
   * previous session left unfinished.
   */
  resumeValidation: () => Promise<void>;
  refreshQuota: () => Promise<void>;
  /**
   * Uploads the track and hands it to the history.
   *
   * `uploading` is set before anything is sent and cleared in a `finally`, so a
   * rejected upload can never leave the row stuck showing a spinner. The bytes
   * going to Roblox is the only thing this waits for; Roblox's own validation
   * is tracked on the history row instead of here.
   */
  uploadTrack: (id: string) => Promise<void>;
  deleteRecord: (id: string) => Promise<void>;
  addFromUrl: (url: string) => Promise<void>;
  addFromFile: () => Promise<void>;
  remove: (id: string) => void;
  update: (id: string, edit: TrackEdit) => void;
  rename: (id: string, title: string) => void;
  setError: (message: string | null) => void;
  setStatus: (status: UploadStatus | null) => void;
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
  status: null,
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

  resumeValidation: async () => {
    // History first, so a row that is about to change already exists on screen
    // and the update lands on it rather than appearing from nowhere.
    await get().refreshHistory();
    try {
      await resumePendingValidations();
    } catch {
      // Losing the resume is not worth blocking the view over: the rows still
      // show whatever was last written, and the next launch tries again.
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
    // Guards a double click: the row is disabled while this runs, and this
    // second guard covers a click that lands before React re-renders.
    if (get().uploading) return;

    const userId = uploaderUserId();
    if (!userId) {
      set({ status: { kind: 'rejected', reason: 'no-account', message: '' } });
      return;
    }

    set({ uploading: true, progress: null, error: null, status: null });
    try {
      const summary = await uploadAudioParts(
        track.exportedFiles.map((file) => file.path),
        track.exportedFiles.map((file) => file.displayName),
        userId,
      );

      // The bytes are with Roblox. Validation continues in the background, so
      // the track leaves the queue now and the history row takes over.
      set({ status: { kind: 'sent', recordId: summary.recordId } });
      set((state) => ({
        tracks: state.tracks.filter((candidate) => candidate.id !== id),
      }));

      // The backend writes the row before it returns, so this only has to pick
      // it up; the event stream keeps it live from here.
      await get().refreshHistory();
      await get().refreshQuota();
    } catch (err) {
      // The track stays in the queue so the upload can be tried again without
      // re-importing and re-rendering it.
      set({ status: { kind: 'rejected', reason: 'failed', message: String(err) } });
    } finally {
      // Clearing progress here is what stops a settled upload from sitting on
      // a progress bar: the bar is scoped to `uploading`, so this ends it.
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
  setStatus: (status) => set({ status }),
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

/**
 * Replaces a history row whenever the backend reports on one.
 *
 * The backend owns the row's state, because it is the only side that can see
 * Roblox's answer. Merging here rather than patching individual fields is what
 * keeps the view from drifting: whatever the backend says wins, so a piece can
 * never render "validating" after it was already accepted.
 */
export const bindUploadStatus = () => {
  const unlisten = listen<UploadRecord>('music-upload-status', (event) => {
    const record = event.payload;
    useMusicStore.setState((state) => ({
      history: [record, ...state.history.filter((existing) => existing.id !== record.id)],
    }));
  });

  return () => {
    void unlisten.then((stop) => stop());
  };
};
