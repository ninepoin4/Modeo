import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, Send, Copy, Check, Square, ArrowDown } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Tooltip } from './ui/tooltip';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';
import Markdown from './Markdown';

const SLASH_COMMANDS = [
  { id: 'goal', names: ['goal'], needsArg: true, hint: '设置会话目标（注入提示词，可在透明面板查看）' },
  { id: 'compress', names: ['压缩', 'compact'], needsArg: false, hint: '压缩历史为摘要' },
  { id: 'clear', names: ['clear', '清空'], needsArg: false, hint: '清空会话历史' },
  { id: 'mode', names: ['模式', 'mode'], needsArg: true, hint: '切换模式：chat / code / roleplay' },
  { id: 'new', names: ['new', '新建'], needsArg: false, hint: '新建会话' },
  { id: 'help', names: ['help', '帮助'], needsArg: false, hint: '查看全部命令' },
];

function ToolChips({ toolCalls }) {
  if (!toolCalls?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {toolCalls.map((tc) => (
        <Badge key={tc.id || tc.name}>{tc.name}</Badge>
      ))}
    </div>
  );
}

function Bubble({ m, streaming, delay }) {
  const [copied, setCopied] = useState(false);
  if (m.role === 'system' || m.role === 'notice') {
    return (
      <div className="flex justify-center py-1">
        <span className="max-w-[80%] text-center text-xs text-muted">{m.content}</span>
      </div>
    );
  }
  const isUser = m.role === 'user';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(m.content || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: delay || 0, ease: [0.22, 1, 0.36, 1] }}
      className={cn('flex', isUser ? 'justify-end' : 'justify-start')}
    >
      <div
        className={cn(
          'group/msg relative max-w-[78%] rounded-2xl px-4 py-3 shadow-paper',
          isUser ? 'msg-user' : 'msg-assistant',
          isUser ? 'rounded-br-md bg-ink text-paper' : 'rounded-bl-md border border-line bg-card'
        )}
      >
        {!isUser && m.content && (
          <button
            data-testid="copy-msg"
            onClick={copy}
            className="absolute right-2 top-2 rounded-md p-1 text-muted opacity-0 transition-opacity hover:bg-paper2 hover:text-ink group-hover/msg:opacity-100"
            title="复制"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        )}
        {isUser ? (
          <p className="text-[14.5px] leading-relaxed">{m.content}</p>
        ) : (
          <div className="msg-prose break-words">
            {streaming && !m.content && (
              <span className="flex gap-1 py-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 rounded-full bg-ink/70 animate-bounce"
                    style={{ animationDelay: `${i * 0.14}s` }}
                  />
                ))}
              </span>
            )}
            {/^【mock-[^】]*】/.test(m.content) && (
              <span className="mb-1 inline-flex items-center gap-1 rounded-full border border-line bg-paper2/70 px-2 py-0.5 text-[10px] tracking-wide text-muted">
                离线演示
              </span>
            )}
            <Markdown content={m.content.replace(/^【mock-[^】]*】/, '')} />
            {streaming && <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] bg-ink animate-blink" />}
          </div>
        )}
        <ToolChips toolCalls={m.toolCalls} />
      </div>
    </motion.div>
  );
}

export default function ChatArea({ session, messages, streaming, characterName, onSend, onStop, onTransparency, onSlashCommand, onUnknownSlash, onPermissionChange }) {
  const [text, setText] = useState('');
  const [showBottom, setShowBottom] = useState(false);
  const [suggestDismissed, setSuggestDismissed] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const scrollRef = useRef(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming]);

  const mode = session?.modeId || 'chat';
  const modeMeta = {
    chat: ['普通对话', '零注入 · 无前置提示词'],
    code: ['代码开发', '沙箱 · 工具 · 审批 · 快照'],
    roleplay: ['角色扮演 / 写作', '角色卡 · 世界状态 · 多角色'],
  };
  const [name, desc] = modeMeta[mode] || [mode, '自定义模式'];

  const slashToken = text.startsWith('/') ? text.slice(1).split(/\s+/)[0].toLowerCase() : '';
  const filteredCommands = slashToken
    ? SLASH_COMMANDS.filter((c) =>
        c.names.some((n) => n.toLowerCase().startsWith(slashToken) || n.toLowerCase().includes(slashToken))
      )
    : SLASH_COMMANDS;
  const showSuggest = text.startsWith('/') && !suggestDismissed && filteredCommands.length > 0;
  const suggestIdx = Math.min(suggestIndex, Math.max(filteredCommands.length - 1, 0));

  const runSuggestion = (cmd) => {
    if (streaming) return;
    const rest = text.replace(/^\S+\s*/, '').trim();
    setText('');
    setSuggestDismissed(false);
    onSlashCommand(cmd.id, rest);
  };

  const submitSlash = () => {
    if (streaming) return;
    const raw = text.trim();
    const m = raw.match(/^\/(\S+)\s*([\s\S]*)$/);
    const name = m ? m[1].toLowerCase() : '';
    const arg = m ? m[2].trim() : '';
    const cmd = SLASH_COMMANDS.find((c) => c.names.map((n) => n.toLowerCase()).includes(name));
    setText('');
    setSuggestDismissed(false);
    if (!cmd) {
      onUnknownSlash(name);
      return;
    }
    onSlashCommand(cmd.id, arg);
  };

  const submit = () => {
    const v = text.trim();
    if (!v || streaming) return;
    if (v.startsWith('/')) {
      submitSlash();
      return;
    }
    setText('');
    onSend(v);
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-paper">
      <header className="flex items-center justify-between border-b border-line px-6 py-3.5">
        <div className="flex items-baseline gap-3">
          <span className="font-serif-display text-lg text-ink">{name}</span>
          <span className="text-xs text-muted">{desc}</span>
        </div>
        <div className="flex items-center gap-3">
          {characterName && <Badge>角色 · {characterName}</Badge>}
          {session?.goal && (
            <Tooltip content={`当前目标：${session.goal}`}>
              <Badge data-testid="goal-badge" className="max-w-[220px]">
                <span className="truncate">目标 · {session.goal.length > 16 ? `${session.goal.slice(0, 16)}…` : session.goal}</span>
              </Badge>
            </Tooltip>
          )}
          {mode === 'code' && (
            <Tooltip
              content={
                session?.permissionMode === 'aggressive'
                  ? '无审批模式（激进）：agent 可执行任意命令、访问任意文件。点击切换回一般模式。'
                  : '一般模式：危险命令与敏感路径访问需审批。点击切换为无审批模式。'
              }
            >
              <button
                data-testid="permission-toggle"
                onClick={onPermissionChange}
                className={
                  session?.permissionMode === 'aggressive'
                    ? 'flex items-center gap-1 rounded-full border border-red-600/50 bg-red-600/10 px-2.5 py-1 text-xs text-red-700 transition-colors hover:bg-red-600/20'
                    : 'flex items-center gap-1 rounded-full border border-line bg-card/60 px-2.5 py-1 text-xs text-muted transition-colors hover:border-ink/40 hover:text-ink'
                }
              >
                <span
                  className={
                    session?.permissionMode === 'aggressive'
                      ? 'h-1.5 w-1.5 rounded-full bg-red-600'
                      : 'h-1.5 w-1.5 rounded-full bg-muted'
                  }
                />
                {session?.permissionMode === 'aggressive' ? '无审批模式' : '一般模式'}
              </button>
            </Tooltip>
          )}
          <Tooltip content="提示词透明面板">
            <Button size="icon" variant="ghost" onClick={onTransparency}>
              <Eye className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        data-testid="messages"
        className="absolute inset-0 space-y-4 overflow-y-auto px-8 py-6"
        onScroll={(e) => {
          const el = e.currentTarget;
          setShowBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 120);
        }}
      >
        <motion.div key={session?.modeId || 'chat'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
          <AnimatePresence initial={false}>
            {messages.map((m, i) => (
              <div key={m.id || `${m.role}-${i}`} className="mb-4">
                <Bubble
                  m={m}
                  delay={Math.min(i * 0.03, 0.25)}
                  streaming={streaming && i === messages.length - 1 && m.role === 'assistant'}
                />
              </div>
            ))}
          </AnimatePresence>
        </motion.div>
        {!messages.length && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="flex h-full flex-col items-center justify-center gap-2 text-center"
          >
            <p className="font-serif-display text-3xl tracking-[0.25em] text-ink/85">欢迎使用 Modeo</p>
            <p className="max-w-sm text-sm text-muted">在下方输入消息开始。三种模式可随时切换，提示词全程透明可见。</p>
          </motion.div>
        )}
      </div>
      <AnimatePresence>
        {showBottom && (
          <motion.button
            data-testid="scroll-bottom"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })}
            className="absolute bottom-4 right-6 flex h-8 w-8 items-center justify-center rounded-full border border-line bg-card text-ink shadow-paper transition-colors hover:bg-paper2"
          >
            <ArrowDown className="h-4 w-4" />
          </motion.button>
        )}
      </AnimatePresence>
      </div>

      <footer className="border-t border-line bg-paper2/50 px-6 py-4">
        <div className="relative mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-line bg-card p-2 shadow-paper focus-within:border-ink/40">
          {showSuggest && (
            <div
              data-testid="slash-menu"
              className="absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-2xl border border-line bg-paper shadow-lift"
            >
              {filteredCommands.map((c, i) => (
                <button
                  key={c.id}
                  data-testid={`slash-item-${c.id}`}
                  onMouseEnter={() => setSuggestIndex(i)}
                  onClick={() => runSuggestion(c)}
                  className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors ${
                    i === suggestIdx ? 'bg-card' : 'hover:bg-card/60'
                  }`}
                >
                  <span className="font-mono text-sm text-ink">/{c.names[0]}</span>
                  <span className="flex-1 truncate text-xs text-muted">{c.hint}</span>
                </button>
              ))}
            </div>
          )}
          <Textarea
            data-testid="composer"
            rows={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSuggestDismissed(false);
              setSuggestIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && showSuggest) {
                setSuggestDismissed(true);
                return;
              }
              if (showSuggest && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault();
                setSuggestIndex((i) =>
                  e.key === 'ArrowDown'
                    ? (i + 1) % filteredCommands.length
                    : (i - 1 + filteredCommands.length) % filteredCommands.length
                );
                return;
              }
              if (showSuggest && e.key === 'Tab') {
                e.preventDefault();
                const cmd = filteredCommands[suggestIdx];
                if (cmd) setText(`/${cmd.names[0]} `);
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (showSuggest && filteredCommands[suggestIdx]) {
                  runSuggestion(filteredCommands[suggestIdx]);
                } else {
                  submit();
                }
              }
            }}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行，/ 查看命令"
            className="max-h-40 min-h-[2.5rem] border-0 bg-transparent focus:ring-0"
          />
          {streaming ? (
            <Button size="icon" data-testid="stop" variant="outline" onClick={onStop} className="mb-0.5">
              <Square className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button size="icon" data-testid="send" onClick={submit} disabled={!text.trim()} className="mb-0.5">
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </footer>
    </section>
  );
}
