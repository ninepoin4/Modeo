import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink/40 disabled:pointer-events-none disabled:opacity-45 select-none',
  {
    variants: {
      variant: {
        default: 'bg-ink text-paper hover:bg-ink-soft active:scale-[0.98]',
        outline: 'border border-line bg-transparent text-ink hover:bg-paper2 active:scale-[0.98]',
        ghost: 'text-ink-soft hover:bg-paper2 hover:text-ink',
        subtle: 'bg-paper2 text-ink hover:bg-line-soft active:scale-[0.98]',
      },
      size: {
        sm: 'h-8 px-3 rounded-lg text-[13px]',
        md: 'h-10 px-5 rounded-xl',
        icon: 'h-9 w-9 rounded-lg',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  }
);

export const Button = React.forwardRef(function Button({ className, variant, size, ...props }, ref) {
  return <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
