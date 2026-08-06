import * as React from 'react';
import { cn } from '../../lib/utils';

export const Input = React.forwardRef(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-xl border border-line bg-card/70 px-3.5 text-sm text-ink placeholder:text-muted transition-colors focus:border-ink/50 focus:outline-none',
        className
      )}
      {...props}
    />
  );
});
