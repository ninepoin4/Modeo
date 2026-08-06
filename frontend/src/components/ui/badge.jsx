import * as React from 'react';
import { cn } from '../../lib/utils';

export function Badge({ className, ...props }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-line bg-card/70 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-ink-soft',
        className
      )}
      {...props}
    />
  );
}
