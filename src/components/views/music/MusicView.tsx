import {
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  FileAudio,
  Info,
  Link2,
  Pencil,
  Play,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { useLanguage } from '../../../contexts/LanguageContext';
import { cn } from '../../../lib/utils';
import type { MusicTrack } from '../../../stores/musicStore';
import type { UploadStatus as UploadStatusState } from '../../../stores/musicStore';
import { bindUploadProgress, bindUploadStatus, useMusicStore } from '../../../stores/musicStore';
import type { BakedMedia, UploadProgress, UploadRecord } from '../../../utils/music';
import {
  activeSpeedPreset,
  bakeMedia,
  formatBytes,
  formatDuration,
  formatUploadDate,
  GAIN_RANGE,
  mediaSrc,
  PITCH_RANGE,
  QUALITY_RANGE,
  qualityBitrateKbps,
  recordStatus,
  robloxPlaybackSpeed,
  SPEED_PRESETS,
  SPEED_RANGE,
} from '../../../utils/music';

export default function MusicView() {
  const { t } = useLanguage();
  const {
    tools,
    tracks,
    error,
    status,
    quota,
    history,
    progress,
    uploading,
    refreshTools,
    refreshQuota,
    resumeValidation,
    uploadTrack,
    deleteRecord,
    addFromUrl,
    addFromFile,
    remove,
    update,
    rename,
    setStatus,
  } = useMusicStore();

  const [url, setUrl] = useState('');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    void refreshTools();
    // Resumes validation left unfinished by a previous session, so a row is
    // never frozen on "validating" just because the app was closed.
    void resumeValidation();
    void refreshQuota();
    // Both listeners are bound here and torn down together; leaving the status
    // one attached would keep writing into a store the view no longer reads.
    const stopProgress = bindUploadProgress();
    const stopStatus = bindUploadStatus();
    return () => {
      stopProgress();
      stopStatus();
    };
    // These are stable store actions, so this runs once on mount.
  }, [refreshTools, resumeValidation, refreshQuota]);

  const handleImportUrl = async () => {
    if (!url.trim() || importing) return;
    setImporting(true);
    await addFromUrl(url.trim());
    setUrl('');
    setImporting(false);
  };

  // Only ffmpeg is warned about. yt-dlp installs itself on first run, so a
  // missing one means the install failed and is worth surfacing with a retry.
  const missing = tools
    ? [
        !tools.ffmpeg ? t('music.missingFfmpeg') : null,
        !tools.ytdlp ? t('music.missingYtDlp') : null,
      ].filter(Boolean)
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border-subtle px-6 py-4">
        <h1 className="text-lg font-semibold leading-snug text-text-primary">{t('music.title')}</h1>
        <p className="mt-1 text-sm text-text-secondary">{t('music.subtitle')}</p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
          {missing.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-signal-warn/30 bg-signal-warn/10 p-3">
              <CircleAlert size={15} className="mt-0.5 shrink-0 text-signal-warn" />
              <div className="text-sm text-text-secondary">
                {missing.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </div>
          )}

          {quota && quota.limit > 0 && (
            <p className="text-xs text-text-muted">
              {t('music.quotaLeft')
                .replace('{remaining}', String(quota.remaining))
                .replace('{limit}', String(quota.limit))}
            </p>
          )}

          {/* One place for the whole upload lifecycle. It used to be split across
              a bar, a success line and a second line inside the import section,
              which showed the same outcome twice. */}
          {(uploading || status) && (
            <UploadStatus status={status} progress={uploading ? progress : null} busy={uploading} />
          )}

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-text-primary">{t('music.addTrack')}</h2>

            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Link2
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
                />
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleImportUrl();
                  }}
                  placeholder={t('music.urlPlaceholder')}
                  aria-label={t('music.urlPlaceholder')}
                  className="pl-9"
                />
              </div>
              <Button
                onClick={() => void handleImportUrl()}
                disabled={!url.trim() || importing || !tools?.ytdlp}
              >
                {t('music.importUrl')}
              </Button>
            </div>

            <div>
              <Button
                variant="outline"
                onClick={() => void addFromFile()}
                disabled={!tools?.ffprobe}
              >
                <FileAudio size={16} />
                {t('music.importLocal')}
              </Button>
            </div>

            {error && (
              <p className="text-sm text-danger" role="alert">
                {error === 'yt-dlp-unavailable' ? t('music.ytdlpUnavailable') : error}
              </p>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-text-primary">{t('music.queue')}</h2>
              <span className="text-xs text-text-muted tabular-nums">
                {t('music.trackCount').replace('{count}', String(tracks.length))}
              </span>
            </div>

            {tracks.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border-subtle p-8 text-center text-sm text-text-muted">
                {t('music.empty')}
              </p>
            ) : (
              <ul className="flex flex-col gap-4">
                {tracks.map((track) => (
                  <TrackEditor
                    key={track.id}
                    track={track}
                    onRemove={() => remove(track.id)}
                    onUpdate={(edit) => update(track.id, edit)}
                    onRename={(title) => rename(track.id, title)}
                    onUpload={() => void uploadTrack(track.id)}
                    // Every track shares one upload slot, so while an upload is
                    // in flight this is true for the row that owns it. The row
                    // disables itself; the store guards the actual call.
                    sending={uploading}
                    onExported={(result) => {
                      update(track.id, {
                        exportedPath: result.files[0]?.path ?? null,
                        exportedFiles: result.files,
                      });
                    }}
                    onFailure={(message) =>
                      setStatus(
                        message === null ? null : { kind: 'rejected', reason: 'failed', message },
                      )
                    }
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-text-primary">{t('music.history')}</h2>
              {history.length > 0 && (
                <span className="text-xs text-text-muted tabular-nums">
                  {t('music.historyCount').replace('{count}', String(history.length))}
                </span>
              )}
            </div>

            {history.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border-subtle p-6 text-center text-sm text-text-muted">
                {t('music.historyEmpty')}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {history.map((record) => (
                  <HistoryRow key={record.id} record={record} onDelete={deleteRecord} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * The one place an upload's state is shown.
 *
 * Sending the bytes, Roblox checking them and Roblox accepting the asset are
 * three moments, and only the last one is a success. Rendering them separately
 * is how the same outcome ended up on screen twice, so the whole lifecycle goes
 * through this one component.
 */
/**
 * One upload in the history: name, asset id and status.
 *
 * A split track shows its parts as indented rows under a parent row, because
 * each part is a separate Roblox asset with its own id and its own verdict, and
 * collapsing them would hide which part went wrong.
 *
 * The id appears as soon as Roblox reveals it, which is before validation ends.
 * That is the point of moving uploads here immediately: the id is the thing the
 * user came for, and making them wait for a verdict to see it was the problem.
 */
function HistoryRow({
  record,
  onDelete,
}: {
  record: UploadRecord;
  onDelete: (id: string) => void;
}) {
  const { t } = useLanguage();
  const overall = recordStatus(record);
  // A single-piece upload has no parent row to hang parts off, so it renders as
  // one line rather than a header plus a child.
  const split = record.wasSplit && record.pieces.length > 1;

  return (
    <li className="overflow-hidden rounded-lg border border-border-subtle bg-card">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text-primary">{record.title}</p>
          <p className="mt-0.5 text-xs text-text-muted">
            {formatUploadDate(record.uploadedAt)} · {formatBytes(record.totalBytes)}
            {split ? ` · ${t('music.parts').replace('{count}', String(record.pieces.length))}` : ''}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <AssetId value={record.pieces[0]?.assetId} />
          <StatusPill status={overall} />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void onDelete(record.id)}
            aria-label={t('music.removeRecord')}
          >
            <Trash2 size={15} />
          </Button>
        </div>
      </div>

      {split && (
        <ul className="border-t border-border-subtle">
          {record.pieces.map((piece, index) => (
            <li
              key={`${piece.name}-${index}`}
              className="flex items-center gap-3 border-b border-border-subtle px-3 py-2 last:border-b-0"
            >
              {/* Indentation plus a rail is what marks these as belonging to the
                  parent rather than being uploads of their own. */}
              <span className="flex min-w-0 flex-1 items-center gap-2 pl-4">
                <span className="h-3 w-px shrink-0 bg-border-subtle" aria-hidden />
                <span className="truncate text-xs text-text-secondary">{piece.name}</span>
              </span>
              <AssetId value={piece.assetId} />
              <StatusPill status={piece.status} detail={piece.message} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** The asset id, or a placeholder while Roblox has not handed one over yet. */
function AssetId({ value }: { value?: number | null }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  if (value === undefined || value === null) {
    return (
      <span className="w-24 shrink-0 text-right text-xs text-text-muted tabular-nums">
        {t('music.idWaiting')}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void navigator.clipboard.writeText(String(value))}
      className="w-24 shrink-0 truncate rounded border border-border-subtle px-1.5 py-0.5 text-right font-mono text-xs text-text-muted hover:text-text-primary"
      title={t('music.copyId')}
    >
      {copied ? t('music.copied') : value}
    </button>
  );
}

/** The verdict for a piece or a whole row. */
function StatusPill({ status, detail }: { status: string; detail?: string }) {
  const { t } = useLanguage();

  const tone = {
    accepted: 'border-signal-live/30 bg-signal-live/10 text-signal-live',
    validating: 'border-primary/30 bg-primary/10 text-primary',
    rejected: 'border-danger/30 bg-danger/10 text-danger',
    uploading: 'border-border-subtle bg-bg-elevated text-text-muted',
  }[status];

  const label = {
    accepted: t('music.statusAccepted'),
    validating: t('music.statusValidating'),
    rejected: t('music.statusRejected'),
    uploading: t('music.statusUploading'),
  }[status];

  // An unrecognised status would render as undefined, which reads as a bug in
  // the row rather than as a state. Falling back to the raw value keeps it
  // honest if the backend ever grows a status the view does not know.
  const text = label ?? status;

  return (
    <span
      className={cn(
        'flex w-28 shrink-0 items-center justify-center gap-1 rounded border px-1.5 py-0.5 text-xs',
        tone ?? 'border-border-subtle bg-bg-elevated text-text-muted',
      )}
      title={detail}
    >
      {status !== 'accepted' && status !== 'rejected' && (
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-current" />
      )}
      <span className="truncate">{text}</span>
    </span>
  );
}

/**
 * The one place an upload's own progress is shown.
 *
 * This is scoped strictly to the bytes going to Roblox. Roblox's validation used
 * to be reported here too, on a timer, and that is exactly what left a settled
 * upload sitting on a progress bar: the bar outlived the thing it was measuring.
 * Validation now lives on the history row, where the backend owns it, so this
 * panel has nothing left to keep in sync and can only show work that is real.
 */
function UploadStatus({
  status,
  progress,
  busy,
}: {
  status: UploadStatusState | null;
  progress: UploadProgress | null;
  busy: boolean;
}) {
  const { t } = useLanguage();
  const [dismissed, setDismissed] = useState<UploadStatusState | null>(null);

  // A dismissal belongs to one outcome. The next upload produces a new object,
  // which clears it, so the panel reappears instead of staying hidden.
  useEffect(() => {
    if (status && status !== dismissed) setDismissed(null);
  }, [status, dismissed]);

  // While the bytes are moving. `busy` is cleared in a `finally` on the store,
  // so a failed upload lands in the outcome branch below rather than here.
  if (busy) {
    return (
      <div className="flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-card p-3">
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <span className="truncate text-text-secondary">
            {progress && progress.total > 1
              ? t('music.uploadingPiece')
                  .replace('{index}', String(progress.index + 1))
                  .replace('{total}', String(progress.total))
              : t('music.uploading')}
          </span>
          <span className="shrink-0 text-text-muted tabular-nums">{percentOf(progress)}%</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-bg-elevated">
          <div
            className="h-full bg-primary transition-all duration-200"
            style={{ width: `${percentOf(progress)}%` }}
          />
        </div>
      </div>
    );
  }

  if (!status || status === dismissed) return null;

  if (status.kind === 'sent') {
    return (
      <Outcome
        tone="live"
        icon={<Check size={15} />}
        title={t('music.sentTitle')}
        detail={t('music.sentNote')}
        onDismiss={() => setDismissed(status)}
      />
    );
  }

  return (
    <Outcome
      tone="danger"
      icon={<CircleAlert size={15} />}
      title={
        status.reason === 'no-account' ? t('music.noUploaderAccount') : t('music.rejectedTitle')
      }
      detail={status.reason === 'no-account' ? undefined : status.message}
      onDismiss={() => setDismissed(status)}
    />
  );
}

function Outcome({
  tone,
  icon,
  title,
  detail,
  onDismiss,
}: {
  tone: 'live' | 'warn' | 'danger';
  icon: React.ReactNode;
  title: string;
  detail?: string;
  onDismiss: () => void;
}) {
  const { t } = useLanguage();
  const tones = {
    live: 'border-signal-live/30 bg-signal-live/10 text-signal-live',
    warn: 'border-signal-warn/30 bg-signal-warn/10 text-signal-warn',
    danger: 'border-danger/30 bg-danger/10 text-danger',
  } as const;

  return (
    <div
      className={cn('flex items-start gap-2 rounded-lg border p-3', tones[tone])}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {detail && <p className="mt-0.5 break-words text-xs opacity-90">{detail}</p>}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onDismiss}
        aria-label={t('music.dismiss')}
        className="shrink-0 text-current hover:bg-current/10"
      >
        <X size={15} />
      </Button>
    </div>
  );
}

function percentOf(progress: UploadProgress | null) {
  if (!progress || progress.stage !== 'uploading' || progress.bytes <= 0) return 0;
  return Math.min(100, Math.round((progress.sent / progress.bytes) * 100));
}

function TrackEditor({
  track,
  onRemove,
  onUpdate,
  onRename,
  onUpload,
  onExported,
  onFailure,
  sending: sendingFromStore,
}: {
  track: MusicTrack;
  onRemove: () => void;
  onUpdate: (edit: Partial<MusicTrack>) => void;
  onRename: (title: string) => void;
  onUpload: () => void;
  onExported: (result: BakedMedia) => void;
  onFailure: (message: string | null) => void;
  /** True while this track's bytes are on their way to Roblox. */
  sending: boolean;
}) {
  const { t } = useLanguage();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  // Rendering with ffmpeg and sending the result are separate steps, and only
  // the second one is an upload, so the button says which one is happening.
  const [baking, setBaking] = useState(false);
  const [sending, setSending] = useState(false);
  // The store owns the real flag; the local one only covers the render between
  // the click and the store updating. Either one means the row is busy.
  const busy = baking || sending || sendingFromStore;
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(track.title);

  const src = mediaSrc(track.exportedPath ?? track.path);
  const isEdited = track.speed !== 1 || track.semitones !== 0 || track.gainDb !== 0;
  const preset = activeSpeedPreset(track.speed);
  // Roblox divides the baked speed back out, so the hint has to follow the
  // slider rather than a stored default.
  const playbackSpeed = robloxPlaybackSpeed(track.speed);
  // Web Audio gives an instant preview of the edits without touching the file.
  // The uploaded/baked copy is produced separately by bakeMedia.
  useEffect(() => {
    const audio = new Audio(src);
    audioRef.current = audio;

    const stop = () => setPlaying(false);
    audio.addEventListener('ended', stop);
    audio.addEventListener('pause', stop);
    audio.addEventListener('error', stop);

    return () => {
      audio.pause();
      audio.removeEventListener('ended', stop);
      audio.removeEventListener('pause', stop);
      audio.removeEventListener('error', stop);
      audioRef.current = null;
    };
  }, [src]);

  // playbackRate shifts speed; preserving pitch needs the same correction ffmpeg
  // performs, and the browser has no built-in detune for that, so the preview
  // deliberately lets pitch follow speed.
  const applyRate = useCallback((rate: number) => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, []);

  useEffect(() => {
    applyRate(track.speed);
  }, [track.speed, applyRate]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
        setPlaying(true);
      } catch {
        setPlaying(false);
      }
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  const handleUpload = async () => {
    // A failure clears any previous message rather than pushing an empty one
    // into the panel, which used to render as a bare error border with no text.
    onFailure(null);
    setBaking(true);
    try {
      if (track.exportedFiles.length === 0) {
        const result = await bakeMedia({
          path: track.path,
          title: track.title,
          speed: track.speed,
          semitones: track.semitones,
          gainDb: track.gainDb,
          quality: track.quality,
          format: track.format,
          sampleRate: track.sampleRate,
          sourceDuration: track.info?.duration ?? undefined,
        });
        onExported(result);
      }
      setBaking(false);
      setSending(true);
      await onUpload();
    } catch (err) {
      onFailure(String(err));
    } finally {
      // Both flags clear here as well as in the store's own `finally`, so the
      // row cannot be left showing "uploading" if the store call throws.
      setBaking(false);
      setSending(false);
    }
  };

  const commitRename = () => {
    // Enter commits and then the field blurs, so the second call has to be a
    // no-op rather than a second rename.
    if (!renaming) return;
    onRename(draftTitle);
    setRenaming(false);
  };

  const cancelRename = () => {
    if (!renaming) return;
    setDraftTitle(track.title);
    setRenaming(false);
  };

  return (
    <li
      className={cn(
        'rounded-xl border border-border-subtle bg-card p-4 transition-opacity',
        // A row that is uploading is inert: dimmed, and every control inside it
        // is disabled below. Renaming or re-rendering mid-upload would act on a
        // file that is already on its way to Roblox.
        busy && 'pointer-events-none opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <Input
              autoFocus
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitRename();
                }
                if (e.key === 'Escape') cancelRename();
              }}
              aria-label={t('music.renameTitle')}
              className="h-8 text-sm font-semibold"
            />
          ) : (
            <p className="truncate text-sm font-semibold text-text-primary">{track.title}</p>
          )}
          <p className="mt-0.5 text-xs text-text-muted">
            {formatDuration(track.info?.duration)}
            {track.uploader ? ` · ${track.uploader}` : ''}
            {track.exportedPath ? ` · ${t('music.exportedLabel')}` : ''}
          </p>
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            setDraftTitle(track.title);
            setRenaming((value) => !value);
          }}
          disabled={renaming || busy}
          aria-label={t('music.rename')}
          title={t('music.renameHint')}
        >
          <Pencil size={15} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void togglePlay()}
          aria-label={t(playing ? 'music.stop' : 'music.play')}
        >
          {playing ? <Square size={15} /> : <Play size={15} />}
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label={t('music.remove')}>
          <Trash2 size={15} />
        </Button>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <Control
          label={t('music.speed')}
          value={
            preset
              ? `${t(preset.labelKey)} · ${track.speed.toFixed(2)}x`
              : `${track.speed.toFixed(2)}x`
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {SPEED_PRESETS.map((option) => {
              const active = preset?.value === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onUpdate({ speed: option.value })}
                  aria-pressed={active}
                  className={cn(
                    'rounded-md border px-2 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border-subtle text-text-secondary hover:border-primary/50 hover:text-text-primary',
                  )}
                >
                  {t(option.labelKey)}
                </button>
              );
            })}
          </div>
          <input
            type="range"
            className="theme-range mt-1"
            value={track.speed}
            min={SPEED_RANGE.min}
            max={SPEED_RANGE.max}
            step={SPEED_RANGE.step}
            aria-label={t('music.speed')}
            onChange={(e) => onUpdate({ speed: Number(e.target.value) })}
          />
        </Control>

        <div className="grid gap-4 sm:grid-cols-2">
          <Control label={t('music.pitch')} value={semitoneLabel(track.semitones)}>
            <input
              type="range"
              className="theme-range"
              value={track.semitones}
              min={PITCH_RANGE.min}
              max={PITCH_RANGE.max}
              step={PITCH_RANGE.step}
              aria-label={t('music.pitch')}
              onChange={(e) => onUpdate({ semitones: Number(e.target.value) })}
            />
          </Control>

          <Control
            label={t('music.amplification')}
            value={track.gainDb > 0 ? `+${track.gainDb} dB` : `${track.gainDb} dB`}
          >
            <input
              type="range"
              className="theme-range"
              value={track.gainDb}
              min={GAIN_RANGE.min}
              max={GAIN_RANGE.max}
              step={GAIN_RANGE.step}
              aria-label={t('music.amplification')}
              onChange={(e) => onUpdate({ gainDb: Number(e.target.value) })}
            />
          </Control>

          <Control
            label={t('music.quality')}
            value={`${track.quality}/${QUALITY_RANGE.max} · ${qualityBitrateKbps(track.quality)} kbps`}
          >
            <input
              type="range"
              className="theme-range"
              value={track.quality}
              min={QUALITY_RANGE.min}
              max={QUALITY_RANGE.max}
              step={QUALITY_RANGE.step}
              aria-label={t('music.quality')}
              onChange={(e) => onUpdate({ quality: Number(e.target.value) })}
            />
          </Control>

          <Control label={t('music.outputFormat')} value={track.format.toUpperCase()}>
            <p className="text-xs leading-relaxed text-text-muted">{t('music.outputFormatNote')}</p>
          </Control>
        </div>
      </div>

      <RobloxHint
        playbackSpeed={playbackSpeed}
        hint={t('music.robloxSpeedHint').replace('{value}', playbackSpeed)}
        snippet={t('music.robloxSpeedSnippet').replace('{value}', playbackSpeed)}
      />

      <div className="mt-4 flex items-center justify-between gap-3">
        {/* Rendering with ffmpeg is not an upload, so it says so here rather
            than borrowing the upload wording. */}
        <p className="text-xs text-text-muted">
          {baking
            ? t('music.rendering')
            : track.split?.needsSplit
              ? t('music.willSplit').replace('{count}', String(track.split.parts.length))
              : isEdited
                ? t('music.editedNote')
                : t('music.untouchedNote')}
        </p>
        <Button onClick={() => void handleUpload()} disabled={busy || !track.info}>
          <Upload size={15} />
          {baking ? t('music.rendering') : busy ? t('music.uploading') : t('music.upload')}
        </Button>
      </div>

      {track.exportedFiles.length > 1 && (
        <ul className="mt-3 flex flex-col gap-1 border-t border-border-subtle pt-3">
          {track.exportedFiles.map((file) => (
            <li key={file.path} className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate text-text-secondary">{file.displayName}</span>
              <span className="shrink-0 text-text-muted tabular-nums">
                {formatDuration(file.outputDuration)} · {(file.bytes / 1024 / 1024).toFixed(1)} MB
              </span>
            </li>
          ))}
        </ul>
      )}

      {track.thumbnailUrl && (
        <a
          href={track.sourceUrl ?? track.thumbnailUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <ExternalLink size={12} />
          {t('music.openSource')}
        </a>
      )}
    </li>
  );
}

/**
 * The value a track needs on `Sound.PlaybackSpeed` in Roblox.
 *
 * The render bakes the speed in, so the game has to divide it back out. This is
 * the one number a user has to copy by hand, so it is shown as a snippet and can
 * be copied in one click.
 */
function RobloxHint({
  playbackSpeed,
  hint,
  snippet,
}: {
  playbackSpeed: string;
  hint: string;
  snippet: string;
}) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="mt-4 flex items-start gap-2 rounded-lg border border-border-subtle bg-bg-elevated/50 p-3">
      <Info size={15} className="mt-0.5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-text-secondary">{t('music.robloxSettings')}</p>
        <p className="mt-0.5 text-xs text-text-muted">{hint}</p>
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-bg-elevated px-2 py-1 font-mono text-xs text-text-primary">
            {snippet}
          </code>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              void navigator.clipboard.writeText(playbackSpeed);
              setCopied(true);
            }}
            aria-label={t('music.copyPlaybackSpeed')}
            title={t('music.copyPlaybackSpeed')}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Control({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-text-secondary">{label}</span>
        {value && <span className="text-xs text-text-muted tabular-nums">{value}</span>}
      </div>
      {children}
    </div>
  );
}

function semitoneLabel(semitones: number) {
  if (semitones === 0) return '0 st';
  return `${semitones > 0 ? '+' : ''}${semitones} st`;
}
