import * as React from 'react';
import { cn } from '../../lib/utils';

export const Textarea = React.forwardRef(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-xl border border-line bg-card/70 px-3.5 py-2.5 text-sm text-ink placeholder:text-muted transition-colors focus:border-ink/50 focus:outline-none',
        className
      )}
      {...props}
    />
  );
});
