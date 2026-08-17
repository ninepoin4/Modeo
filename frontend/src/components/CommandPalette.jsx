import { useEffect, useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { Search } from 'lucide-react';
import { cn } from '../lib/utils';

export default function CommandPalette({ open, onClose, commands }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => `${c.label} ${c.hint || ''} ${c.keywords || ''}`.toLowerCase().includes(q));
  }, [query, commands]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => setIndex(0), [query]);

  const run = (c) => {
    c.run();
    onClose();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-ink/20 backdrop-blur-[2px] animate-fade-in" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[18vh] z-[70] w-[min(560px,92vw)] -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-paper shadow-lift animate-scale-in focus:outline-none"
        >
          <div className="flex items-center gap-2.5 border-b border-line px-4">
            <Search className="h-4 w-4 shrink-0 text-muted" />
            <input
              ref={inputRef}
              data-testid="cmd-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setIndex((i) => Math.min(i + 1, filtered.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setIndex((i) => Math.max(i - 1, 0));
                } else if (e.key === 'Enter' && !e.nativeEvent.isComposing && filtered[index]) {
                  e.preventDefault();
                  run(filtered[index]);
                }
              }}
              placeholder="输入命令…（↑↓ 选择，Enter 执行）"
              className="h-12 w-full bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none"
            />
          </div>
          <div className="max-h-[320px] overflow-y-auto p-1.5">
            <AnimatePresence initial={false}>
              {filtered.map((c, i) => {
                const Icon = c.icon;
                return (
                  <motion.button
                    key={c.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15, delay: Math.min(i * 0.02, 0.2) }}
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => run(c)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                      i === index ? 'bg-card shadow-paper' : 'hover:bg-card/50'
                    )}
                  >
                    {Icon && <Icon className="h-4 w-4 shrink-0 text-muted" />}
                    <span className="flex-1 text-sm text-ink">{c.label}</span>
                    {c.hint && <span className="text-[11px] text-muted">{c.hint}</span>}
                  </motion.button>
                );
              })}
            </AnimatePresence>
            {!filtered.length && <p className="px-3 py-6 text-center text-xs text-muted">没有匹配的命令</p>}
          </div>
          <div className="border-t border-line px-4 py-2 text-[10px] text-muted">
            Ctrl/⌘ K 打开 · ↑↓ 选择 · Enter 执行 · Esc 关闭
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
