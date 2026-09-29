import {
  CircleAlert,
  ExternalLink,
  FileAudio,
  Link2,
  Play,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { useLanguage } from '../../../contexts/LanguageContext';
import type { MusicTrack } from '../../../stores/musicStore';
import { useMusicStore } from '../../../stores/musicStore';
import {
  AUDIO_FORMATS,
  bakeMedia,
  formatDuration,
  mediaSrc,
  PITCH_RANGE,
  SAMPLE_RATES,
  SPEED_RANGE,
} from '../../../utils/music';

export default function MusicView() {
  const { t } = useLanguage();
  const {
    tools,
    tracks,
    error,
    notice,
    refreshTools,
    addFromUrl,
    addFromFile,
    remove,
    update,
    setError,
    setNotice,
  } = useMusicStore();

  const [url, setUrl] = useState('');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    void refreshTools();
  }, [refreshTools]);

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

            {error && error !== 'yt-dlp-unavailable' && (
              <p className="text-sm text-danger" role="alert">
                {error}
              </p>
            )}
            {error === 'yt-dlp-unavailable' && (
              <p className="text-sm text-danger" role="alert">
                {t('music.ytdlpUnavailable')}
              </p>
            )}
            {notice && <p className="text-sm text-signal-live">{notice}</p>}
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
                    onExported={(path) => {
                      update(track.id, { exportedPath: path });
                      setNotice(t('music.exported'));
                    }}
                    onError={setError}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function TrackEditor({
  track,
  onRemove,
  onUpdate,
  onExported,
  onError,
}: {
  track: MusicTrack;
  onRemove: () => void;
  onUpdate: (edit: Partial<MusicTrack>) => void;
  onExported: (path: string) => void;
  onError: (message: string) => void;
}) {
  const { t } = useLanguage();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);

  const src = mediaSrc(track.exportedPath ?? track.path);
  const isEdited = track.speed !== 1 || track.semitones !== 0;

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

  const handleExport = async () => {
    setExporting(true);
    onError('');
    try {
      const result = await bakeMedia({
        path: track.path,
        title: track.title,
        speed: track.speed,
        semitones: track.semitones,
        format: track.format,
        sampleRate: track.sampleRate,
      });
      onExported(result.path);
    } catch (err) {
      onError(String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <li className="rounded-xl border border-border-subtle bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-text-primary">{track.title}</p>
          <p className="mt-0.5 text-xs text-text-muted">
            {formatDuration(track.info?.duration)}
            {track.uploader ? ` · ${track.uploader}` : ''}
            {track.exportedPath ? ` · ${t('music.exportedLabel')}` : ''}
          </p>
        </div>

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

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Control label={t('music.speed')} value={`${track.speed.toFixed(2)}x`}>
          <input
            type="range"
            className="theme-range"
            value={track.speed}
            min={SPEED_RANGE.min}
            max={SPEED_RANGE.max}
            step={SPEED_RANGE.step}
            aria-label={t('music.speed')}
            onChange={(e) => onUpdate({ speed: Number(e.target.value) })}
          />
        </Control>

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

        <Control label={t('music.format')}>
          <Select
            value={track.format}
            onValueChange={(value) => onUpdate({ format: value as MusicTrack['format'] })}
          >
            <SelectTrigger aria-label={t('music.format')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUDIO_FORMATS.map((format) => (
                <SelectItem key={format.value} value={format.value}>
                  {format.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Control>

        <Control label={t('music.sampleRate')}>
          <Select
            value={String(track.sampleRate)}
            onValueChange={(value) => onUpdate({ sampleRate: Number(value) })}
          >
            <SelectTrigger aria-label={t('music.sampleRate')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SAMPLE_RATES.map((rate) => (
                <SelectItem key={rate} value={String(rate)}>
                  {rate.toLocaleString()} Hz
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Control>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-text-muted">
          {isEdited ? t('music.editedNote') : t('music.untouchedNote')}
        </p>
        <Button onClick={() => void handleExport()} disabled={exporting || !track.info}>
          <Upload size={15} />
          {exporting ? t('music.exporting') : t('music.export')}
        </Button>
      </div>

      {isEdited && track.thumbnailUrl && (
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
