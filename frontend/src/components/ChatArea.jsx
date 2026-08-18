import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, Send, Copy, Check, Square, ArrowDown, Paperclip, Loader2, X } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Tooltip } from './ui/tooltip';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';
import { api } from '../api';
import Markdown from './Markdown';
import VirtualMessageList from './VirtualMessageList';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);
const ACCEPT_ATTR = 'image/*,audio/*,video/*,.pdf,.txt,.md,.json,.csv,.zip';

/** 根据扩展名决定插入的引用语法：图片用 ![]() 内联显示，其余用链接（渲染层按扩展名转播放器） */
function mediaRef(upload) {
  const ext = (upload.name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  if (IMAGE_EXT.has(ext)) return `![${upload.name}](${upload.url})`;
  return `[${upload.name}](${upload.url})`;
}

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
  // 2026-08-17 审查修复（F4 兜底）：role:'tool' 若混入消息列表，不再按助手气泡渲染
  // （工具输出在流式阶段进 toolLog；此处防御性折叠为窄体小字，防 64KB 输出刷屏）
  if (m.role === 'tool') {
    const t = String(m.content || '').trim();
    return (
      <div className="flex justify-center py-1">
        <span className="max-w-[80%] truncate rounded-lg border border-line bg-paper2 px-2.5 py-1 text-center font-mono text-xs text-muted">
          {t.length > 120 ? `${t.slice(0, 120)}…` : t}
        </span>
      </div>
    );
  }
  const isUser = m.role === 'user';
  // 2026-08-18："回复中"占位——模型首 token 前展示打字动画提示，避免用户误以为卡死
  if (m.pending && !m.content && !isUser) {
    return (
      <div className="flex justify-start py-1">
        <div className="flex items-center gap-2 rounded-2xl border border-line bg-card px-4 py-2.5 shadow-paper">
          <span className="flex gap-1">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: '0ms' }} />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: '120ms' }} />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: '240ms' }} />
          </span>
          <span className="text-xs text-muted">回复中…</span>
        </div>
      </div>
    );
  }
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
          <div className="break-words font-serif text-[14.5px] leading-[1.85]">
            <Markdown content={m.content} />
          </div>
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

export default function ChatArea({ session, messages, streaming, characterName, defaultModel, models = [], onSend, onStop, onTransparency, onSlashCommand, onUnknownSlash, onPermissionChange }) {
  const [text, setText] = useState('');
  const [showBottom, setShowBottom] = useState(false);
  const [suggestDismissed, setSuggestDismissed] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  // 消息级模型 override（pi 模型接力思想）：仅本条消息生效，空 = 用默认模型
  const [modelOverride, setModelOverride] = useState('');
  const [editingModel, setEditingModel] = useState(false);
  const [modelDraft, setModelDraft] = useState('');
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);

  const uploadFiles = useCallback(async (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    setUploadError('');
    setUploading(true);
    try {
      for (const f of list) {
        if (f.size > MAX_FILE_BYTES) {
          setUploadError(`「${f.name}」超过 20MB 上限，已跳过`);
          continue;
        }
        const b64 = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(',')[1] || '');
          r.onerror = () => reject(new Error('读取文件失败'));
          r.readAsDataURL(f);
        });
        const up = await api.uploadFile(f.name, b64);
        setText((prev) => (prev ? `${prev}\n` : '') + mediaRef(up) + '\n');
      }
    } catch (e) {
      setUploadError(`上传失败：${e.message}`);
      setTimeout(() => setUploadError(''), 5000);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, []);
  useEffect(() => {
    // 仅在用户位于底部附近（showBottom=false）时自动跟随新消息；向上翻阅历史时不打扰
    if (!showBottom) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, streaming, showBottom]);

  const mode = session?.modeId || 'chat';
  const modeNames = { chat: '普通对话', code: '代码开发', roleplay: '角色扮演 / 写作' };
  const name = modeNames[mode] || mode;

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
    // 发送意图 = 要看回复：无论当前滚到哪，强制回到底部（聊天应用惯例），
    // 否则虚拟滚动下 nearBottom=false 时新回复在视口外不可见。
    // 用 scrollTop 同步赋值 + 手动 dispatch：scrollTo 的 scroll 事件在下一帧才触发，
    // 会晚于新消息的 useEffect 判断，导致 nearBottom 仍是旧值而漏跟随。
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event('scroll'));
    }
    onSend(v, modelOverride || undefined);
  };

  const confirmModel = () => {
    setModelOverride(modelDraft.trim());
    setEditingModel(false);
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-transparent">
      <header className="flex items-center justify-between border-b border-line px-6 py-3.5">
        <div className="flex items-baseline gap-3">
          <span className="font-serif-display text-lg text-ink">{name}</span>
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
                disabled={streaming}
                title={streaming ? '消息生成中，暂不可切换权限模式' : undefined}
                className={
                  session?.permissionMode === 'aggressive'
                    ? 'flex items-center gap-1 rounded-full border border-red-600/50 bg-red-600/10 px-2.5 py-1 text-xs text-red-700 transition-colors hover:bg-red-600/20 disabled:cursor-not-allowed disabled:opacity-50'
                    : 'flex items-center gap-1 rounded-full border border-line bg-card/60 px-2.5 py-1 text-xs text-muted transition-colors hover:border-ink/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50'
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
          <Tooltip
            content={
              modelOverride
                ? `之后的消息使用模型 ${modelOverride}（点击恢复默认 ${defaultModel || '未配置'}）`
                : `当前模型 ${defaultModel || '未配置'}（点击指定模型，pi 接力式换模型）`
            }
          >
            <div className="flex items-center gap-1 rounded-full border border-line bg-card/60 px-2.5 py-1 text-xs text-muted transition-colors hover:border-ink/40">
              <span>模型</span>
              {editingModel ? (
                models.length ? (
                  <>
                    <select
                      data-testid="model-input"
                      autoFocus
                      value={modelDraft || models[0]}
                      onChange={(e) => setModelDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setEditingModel(false);
                      }}
                      onBlur={confirmModel}
                      className="w-40 bg-transparent font-mono text-ink outline-none"
                    >
                      {models.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <button data-testid="model-confirm" onClick={confirmModel} className="text-muted hover:text-ink" title="确认">
                      <Check className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  <>
                    <input
                      data-testid="model-input"
                      autoFocus
                      value={modelDraft}
                      onChange={(e) => setModelDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          confirmModel();
                        } else if (e.key === 'Escape') {
                          setEditingModel(false);
                        }
                      }}
                      placeholder={defaultModel || '模型名'}
                      className="w-28 bg-transparent font-mono text-ink outline-none placeholder:text-muted"
                    />
                    <button data-testid="model-confirm" onClick={confirmModel} className="text-muted hover:text-ink" title="确认">
                      <Check className="h-3 w-3" />
                    </button>
                    <button onClick={() => setEditingModel(false)} className="text-muted hover:text-ink" title="取消">
                      <X className="h-3 w-3" />
                    </button>
                  </>
                )
              ) : (
                <button
                  data-testid="model-chip"
                  disabled={streaming}
                  onClick={() => {
                    setEditingModel(true);
                    setModelDraft(modelOverride);
                  }}
                  title={streaming ? '消息生成中，暂不可切换模型' : undefined}
                  className={`font-mono transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    modelOverride ? 'text-ink' : 'text-muted hover:text-ink'
                  }`}
                >
                  {modelOverride || defaultModel || '未配置'}
                  {modelOverride && <span className="ml-0.5 text-amber-600">*</span>}
                </button>
              )}
            </div>
          </Tooltip>
          <Tooltip content="提示词透明面板">
            <Button size="icon" variant="ghost" onClick={onTransparency}>
              <Eye className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {messages.length === 0 ? (
          <div className="absolute inset-0 overflow-y-auto px-8 py-6" data-testid="messages">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="flex h-full flex-col items-center justify-center gap-2 text-center"
            >
              <p className="font-serif-display text-3xl tracking-[0.25em] text-ink/85">欢迎使用 Modeo</p>
            </motion.div>
          </div>
        ) : (
          <VirtualMessageList
            items={messages}
            getKey={(m) => m.id || `${m.role}:${String(m.content || '').slice(0, 24)}`}
            scrollRef={scrollRef}
            className="absolute inset-0 px-8"
            onNearBottom={(dist) => setShowBottom(dist > 120)}
          >
            {(m, i) => (
              <Bubble
                m={m}
                delay={Math.min(i * 0.03, 0.25)}
                streaming={streaming && i === messages.length - 1 && m.role === 'assistant'}
              />
            )}
          </VirtualMessageList>
        )}
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
        {uploadError && (
          <p data-testid="upload-error" className="mx-auto mb-1.5 max-w-3xl text-center text-xs text-red-600">
            {uploadError}
          </p>
        )}
        <div
          className="relative mx-auto flex max-w-3xl items-end gap-1.5 rounded-2xl border border-line bg-card p-2 shadow-paper focus-within:border-ink/40"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (streaming) return;
            uploadFiles(e.dataTransfer?.files);
          }}
          title="支持拖拽文件到此处上传"
        >
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
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            accept={ACCEPT_ATTR}
            data-testid="file-input"
            onChange={(e) => uploadFiles(e.target.files)}
          />
          <Tooltip content={uploading ? '上传中…' : '上传附件（图片/音频/视频/PDF/文本），支持拖拽或粘贴'}>
            <Button
              size="icon"
              variant="ghost"
              data-testid="attach"
              disabled={streaming || uploading}
              onClick={() => fileInputRef.current?.click()}
              className="mb-0.5 text-muted"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
            </Button>
          </Tooltip>
          <Textarea
            data-testid="composer"
            rows={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSuggestDismissed(false);
              setSuggestIndex(0);
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files || []);
              if (files.length) {
                if (streaming) return; // 流式生成中不处理文件粘贴（与按钮/拖拽一致）
                e.preventDefault();
                uploadFiles(files);
              }
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
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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
