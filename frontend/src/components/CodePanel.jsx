import { motion, AnimatePresence } from 'framer-motion';
import { Undo2, TerminalSquare, Bot } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';

export default function CodePanel({ toolLog, onUndo }) {
  const hasCheckpoint = toolLog.some((e) => e.type === 'checkpoint');
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-line bg-paper2/60">
      <div className="flex items-center justify-between px-4 py-3.5">
        <span className="font-serif-display text-[13px] tracking-[0.2em] text-muted">工具活动</span>
        <Button size="sm" variant="outline" data-testid="undo" onClick={onUndo} disabled={!hasCheckpoint}>
          <Undo2 className="h-3.5 w-3.5" />
          撤销
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-2.5 px-3 pb-4">
          <AnimatePresence initial={false}>
            {toolLog.map((e, i) => (
              <motion.div
                key={e.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="rounded-xl border border-line bg-card p-3 shadow-paper"
              >
                {e.type === 'checkpoint' ? (
                  <>
                    <div className="flex items-center gap-1.5 text-xs font-medium text-ink">
                      <span className="h-1.5 w-1.5 rounded-full bg-ink" />
                      已创建快照
                    </div>
                    <p className="mt-1 break-all text-[11px] text-muted">{e.label}</p>
                  </>
                ) : e.type === 'subagent' ? (
                  <>
                    <div className="flex items-center gap-1.5 text-xs font-medium text-ink">
                      <Bot className="h-3.5 w-3.5 text-accent" />
                      子代理{e.state === 'running' ? '运行中' : '完成'}
                    </div>
                    <p className="mt-1 break-all text-[11px] text-muted">{e.description}</p>
                    {e.state === 'running' && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="h-1 w-1 animate-pulse rounded-full bg-accent" />
                        <span className="h-1 w-1 animate-pulse rounded-full bg-accent [animation-delay:150ms]" />
                        <span className="h-1 w-1 animate-pulse rounded-full bg-accent [animation-delay:300ms]" />
                      </div>
                    )}
                    {e.state === 'done' && e.result && (
                      <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-paper2/70 p-2 font-mono text-[11px] text-ink-soft">
                        {String(e.result).slice(0, 4000)}
                      </pre>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-ink">{e.toolCall?.name}</span>
                      {e.result?.isError && <Badge className="border-ink/30 bg-ink/5 text-ink">错误</Badge>}
                    </div>
                    {e.toolCall?.args && Object.keys(e.toolCall.args).length > 0 && (
                      <pre className="mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-paper2/70 p-2 font-mono text-[11px] text-ink-soft">
                        {JSON.stringify(e.toolCall.args, null, 2)}
                      </pre>
                    )}
                    {e.result && (
                      <pre className="mt-1.5 max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-paper2/70 p-2 font-mono text-[11px] text-ink-soft">
                        {String(e.result.output || '').slice(0, 6000)}
                      </pre>
                    )}
                  </>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
          {!toolLog.length && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <TerminalSquare className="h-6 w-6 text-line" />
              <p className="text-xs text-muted">工具调用与快照记录会显示在这里</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
