import { invoke } from '@tauri-apps/api/core';
import {
  ArrowUpRight,
  Globe,
  Heart,
  Info,
  MessageCircle,
  MessagesSquare,
  Music4,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import appIcon from '../../assets/app_icon.png';
import { useLanguage } from '../../contexts/LanguageContext';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { Button } from '../ui/button';

/** Runtime facts gathered once, each shown as "unknown" rather than hidden. */
interface RuntimeInfo {
  appVersion: string;
  platform: string;
  arch: string;
  runtime: string;
}

const EMPTY: RuntimeInfo = { appVersion: '', platform: '', arch: '', runtime: '' };

interface LinkRow {
  icon: React.ReactNode;
  label: string;
  hint: string;
  url: string;
}

export default function AboutView() {
  const { t } = useLanguage();
  const [info, setInfo] = useState<RuntimeInfo>(EMPTY);

  useEffect(() => {
    let cancelled = false;

    const read = async () => {
      const next: RuntimeInfo = { ...EMPTY };
      try {
        next.appVersion = await invoke<string>('get_app_version');
      } catch {
        // Version stays empty and the row below shows a dash instead.
      }
      try {
        const runtime = await invoke<Record<string, string>>('get_runtime_info');
        next.platform = runtime?.platform ?? '';
        next.arch = runtime?.arch ?? '';
        next.runtime = runtime?.runtime ?? '';
      } catch {
        // Same: partial info still renders.
      }
      if (!cancelled) setInfo(next);
    };

    void read();
    return () => {
      cancelled = true;
    };
  }, []);

  const links: LinkRow[] = [
    {
      icon: <Globe size={15} />,
      label: t('about.website'),
      hint: t('about.websiteHint'),
      url: 'https://valencystudio.dpdns.org',
    },
    {
      icon: <MessagesSquare size={15} />,
      label: t('about.github'),
      hint: t('about.githubHint'),
      url: 'https://github.com/valency-studio/valencystudio-spoofer',
    },
    {
      icon: <MessageCircle size={15} />,
      label: t('about.discord'),
      hint: t('about.discordHint'),
      url: 'https://discord.gg/6RHuXU9DCv',
    },
  ];

  const facts: [string, string][] = [
    [t('about.version'), info.appVersion || '—'],
    [t('about.platform'), info.platform || '—'],
    [t('about.architecture'), info.arch || '—'],
    [t('about.runtime'), info.runtime || '—'],
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border-subtle px-6 py-4">
        <h1 className="text-lg font-semibold leading-snug text-text-primary">{t('about.title')}</h1>
        <p className="mt-1 text-sm text-text-secondary">{t('about.subtitle')}</p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
          <section className="flex flex-col items-start gap-4 rounded-xl border border-border-subtle bg-card p-6 sm:flex-row sm:items-center">
            <img
              src={appIcon}
              alt=""
              className="h-16 w-16 shrink-0 select-none shadow-xs"
              draggable={false}
            />
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold tracking-tight text-text-primary">
                ValencyStudio - Spoofer
              </h2>
              <p className="mt-1 text-sm text-text-secondary">{t('about.blurb')}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-border-subtle bg-bg-elevated px-2 py-0.5 font-mono text-xs text-text-secondary">
                  {info.appVersion ? `v${info.appVersion}` : '—'}
                </span>
                <span className="rounded-md border border-border-subtle bg-bg-elevated px-2 py-0.5 text-xs text-text-secondary">
                  {t('about.license')}
                </span>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-text-primary">{t('about.highlights')}</h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {[
                { icon: <Sparkles size={15} />, text: t('about.highlightSpoofer') },
                { icon: <Music4 size={15} />, text: t('about.highlightMusic') },
                { icon: <ShieldCheck size={15} />, text: t('about.highlightPrivacy') },
                { icon: <Heart size={15} />, text: t('about.highlightFree') },
              ].map((item) => (
                <li
                  key={item.text}
                  className="flex items-start gap-2 rounded-lg border border-border-subtle bg-card p-3 text-sm text-text-secondary"
                >
                  <span className="mt-0.5 shrink-0 text-primary">{item.icon}</span>
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-text-primary">{t('about.details')}</h2>
            <dl className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-card">
              {facts.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between px-3 py-2">
                  <dt className="text-xs text-text-muted">{label}</dt>
                  <dd className="font-mono text-xs text-text-secondary tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-text-primary">{t('about.community')}</h2>
            <ul className="flex flex-col gap-2">
              {links.map((link) => (
                <li key={link.url}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => {
                      // In the desktop app the browser is not involved, so the
                      // URL is handed to the OS instead.
                      if (isTauriRuntime()) {
                        event.preventDefault();
                        void invoke('open_external', { url: link.url }).catch(() => {});
                      }
                    }}
                    className="flex items-center gap-3 rounded-lg border border-border-subtle bg-card p-3 transition-colors hover:border-primary/50"
                  >
                    <span className="shrink-0 text-primary">{link.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-text-primary">
                        {link.label}
                      </span>
                      <span className="block text-xs text-text-muted">{link.hint}</span>
                    </span>
                    <ArrowUpRight size={14} className="shrink-0 text-text-muted" />
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-text-primary">{t('about.openSource')}</h2>
            <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-card p-4 text-sm text-text-secondary">
              <p>{t('about.openSourceNote')}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!isTauriRuntime()) return;
                    void invoke('open_external', {
                      url: 'https://github.com/valency-studio/valencystudio-spoofer/blob/main/LICENSE',
                    }).catch(() => {});
                  }}
                >
                  <Info size={14} />
                  {t('about.viewSource')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (!isTauriRuntime()) return;
                    void invoke('open_external', {
                      url: 'https://github.com/valency-studio/valencystudio-spoofer/releases/latest',
                    }).catch(() => {});
                  }}
                >
                  <Info size={14} />
                  {t('about.changelog')}
                </Button>
              </div>
            </div>
          </section>

          <p className="pb-4 text-center text-xs text-text-muted">
            {t('about.madeWith').replace('{team}', 'Valency Studio')}
          </p>
        </div>
      </div>
    </div>
  );
}
