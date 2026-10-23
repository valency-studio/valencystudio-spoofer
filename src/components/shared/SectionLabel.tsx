import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';

/** The small caption that opens a settings/panel section. Weight and colour
    separate it from the content; it is deliberately not set in caps, which
    made every panel read as a generic dashboard. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('text-2xs font-semibold text-text-muted', className)}>{children}</span>
  );
}
