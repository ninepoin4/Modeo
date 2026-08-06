import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Plus, Download, Upload, MessageSquare, Search, ChevronRight } from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip } from './ui/tooltip';
import { api } from '../api';

const MODE_LABEL = { chat: '对话', code: '代码', roleplay: '角色' };

function relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function groupKey(s) {
  return MODE_LABEL[s.modeId] ? s.modeId : 'other';
}

const GROUP_LABEL = { chat: '对话', code: '代码', roleplay: '角色', other: '其他' };

export default function SessionsSidebar({ sessions, currentId, onOpen, onNew, onImport }) {
  const fileRef = useRef(null);
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState({});
  const filtered = sessions.filter((s) => {
    const t = `${s.title || ''} ${s.modeId} ${s.characterId || ''}`.toLowerCase();
    return t.includes(q.trim().toLowerCase());
  });
  const groups = ['chat', 'code', 'roleplay', 'other']
    .map((k) => ({ key: k, label: GROUP_LABEL[k], items: filtered.filter((s) => groupKey(s) === k) }))
    .filter((g) => g.items.length);
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-paper2/60">
      <div className="flex items-center justify-between px-4 py-3.5">
        <span className="font-serif-display text-[13px] tracking-[0.2em] text-muted">会 话</span>
        <div className="flex items-center gap-1">
          <Tooltip content="导入会话">
            <Button size="icon" variant="ghost" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Tooltip content="新建会话">
            <Button size="icon" variant="subtle" onClick={onNew}>
              <Plus className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) onImport(file);
          e.target.value = '';
        }}
      />
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-xl border border-line bg-card/60 px-3">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted" />
          <input
            data-testid="session-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索会话…"
            className="h-8 w-full bg-transparent text-xs text-ink placeholder:text-muted focus:outline-none"
          />
        </div>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {groups.map((g) => {
          const isOpen = !collapsed[g.key];
          return (
            <div key={g.key} className="mb-2">
              <button
                data-testid={`group-${g.key}`}
                onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
                className="flex w-full items-center gap-1 rounded-lg px-2 py-1 text-left transition-colors hover:bg-card/40"
              >
                <motion.span animate={{ rotate: isOpen ? 90 : 0 }} transition={{ duration: 0.18 }}>
                  <ChevronRight className="h-3 w-3 text-muted" />
                </motion.span>
                <span className="flex-1 font-serif-display text-[11px] tracking-[0.18em] text-muted">{g.label}</span>
                <span className="text-[10px] text-muted/70">{g.items.length}</span>
              </button>
              {isOpen && (
                <div className="mt-1 space-y-1">
                  {g.items.map((s, i) => (
                    <motion.button
                      key={s.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.02, 0.2) }}
                      onClick={() => onOpen(s.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        api.exportSession(s.id).then((data) => {
                          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                          const a = document.createElement('a');
                          a.href = URL.createObjectURL(blob);
                          a.download = `modeo-session-${s.id.slice(0, 8)}.json`;
                          a.click();
                        });
                      }}
                      className={`group relative flex w-full flex-col items-start gap-0.5 overflow-hidden rounded-xl px-3.5 py-2.5 text-left transition-all duration-200 hover:-translate-y-px hover:shadow-paper ${
                        s.id === currentId ? 'bg-card shadow-paper' : 'hover:bg-card/50'
                      }`}
                    >
                      {s.id === currentId && (
                        <motion.span
                          layoutId="session-active-bar"
                          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-ink"
                        />
                      )}
                      <span className="w-full truncate text-sm text-ink">{s.title || '新会话'}</span>
                      <span className="flex w-full items-center justify-between gap-1 text-[11px] text-muted">
                        <span className="flex items-center gap-1">
                          <MessageSquare className="h-3 w-3" />
                          {MODE_LABEL[s.modeId] || s.modeId}
                          {s.characterId ? ` · ${s.characterId}` : ''}
                        </span>
                        <span className="shrink-0">{relTime(s.updatedAt)}</span>
                      </span>
                    </motion.button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!filtered.length && (
          <p className="px-3 py-8 text-center text-xs text-muted">{sessions.length ? '没有匹配的会话' : '暂无会话，点击右上角 + 新建'}</p>
        )}
      </div>
      <div className="border-t border-line px-4 py-3 text-[11px] text-muted">
        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-ink/60 align-middle" />
        Modeo · 本地优先
      </div>
    </aside>
  );
}
