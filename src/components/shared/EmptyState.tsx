import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';

interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Extra content below the copy, e.g. the primary call to action. */
  children?: ReactNode;
  className?: string;
}

/** Centred icon + copy block shared by every "nothing here yet" surface. */
export function EmptyState({ icon, title, description, children, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center text-text-muted space-y-3',
        className,
      )}
    >
      {icon}
      <div className="space-y-1">
        <p className="text-base font-semibold text-foreground">{title}</p>
        {description && <p className="text-xs text-text-muted max-w-sm">{description}</p>}
      </div>
      {children}
    </div>
  );
}
