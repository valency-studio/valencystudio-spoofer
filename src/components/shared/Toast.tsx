import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useEffect } from 'react';

import { useLanguage } from '../../contexts/LanguageContext';
import { cn } from '../../lib/utils';
import { useSpooferStore } from '../../stores/spooferStore';

export const Toast = () => {
  const { t } = useLanguage();
  const toast = useSpooferStore((s) => s.toast);
  const dismiss = useSpooferStore((s) => s.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toast, dismiss]);

  if (!toast) return null;

  const { level, message } = toast;
  const Icon = level === 'success' ? CheckCircle2 : level === 'error' ? XCircle : Info;
  const colour =
    level === 'success'
      ? 'border-signal-live/40 bg-signal-live/10 text-signal-live'
      : level === 'error'
        ? 'border-danger/40 bg-danger/10 text-danger'
        : 'border-signal-info/40 bg-signal-info/10 text-signal-info';

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[100] pointer-events-auto"
    >
      <div
        className={cn(
          'flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg max-w-sm',
          colour,
        )}
      >
        <Icon size={18} className="shrink-0 mt-0.5" />
        <p className="text-sm font-medium leading-snug flex-1">{message}</p>
        <button
          onClick={dismiss}
          className="opacity-60 hover:opacity-100 transition-opacity shrink-0"
          aria-label={t('common.dismiss')}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};
