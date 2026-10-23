import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';

/** The small uppercase caption that opens a settings/panel section. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('text-2xs font-bold uppercase tracking-widest text-text-muted', className)}>
      {children}
    </span>
  );
}
