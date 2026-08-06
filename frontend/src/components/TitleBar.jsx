import { useEffect, useState } from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';

const desktop = typeof window !== 'undefined' ? window.modeoWindow : null;

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    const off = desktop.onMaximizedChange(setMaximized);
    return () => off?.();
  }, []);
  if (!desktop) return null;

  return (
    <div className="drag-region flex h-9 shrink-0 select-none items-center justify-between border-b border-line bg-paper2/80 pl-4 pr-2">
      <span className="font-serif-display text-[11px] tracking-[0.3em] text-muted">M O D E O</span>
      <div className="no-drag flex items-center gap-0.5">
        <button
          onClick={desktop.minimize}
          className="flex h-7 w-10 items-center justify-center rounded-md text-muted transition-colors hover:bg-card hover:text-ink"
          aria-label="最小化"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={desktop.toggleMaximize}
          className="flex h-7 w-10 items-center justify-center rounded-md text-muted transition-colors hover:bg-card hover:text-ink"
          aria-label={maximized ? '还原' : '最大化'}
        >
          {maximized ? <Copy className="h-3 w-3" /> : <Square className="h-3 w-3" />}
        </button>
        <button
          onClick={desktop.close}
          className="flex h-7 w-10 items-center justify-center rounded-md text-muted transition-colors hover:bg-red-600 hover:text-white"
          aria-label="关闭"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
