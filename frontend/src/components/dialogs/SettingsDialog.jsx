import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogClose } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Separator } from '../ui/separator';
import { api } from '../../api';
import { useToast } from '../ui/toast';
import { ConfirmDialog } from '../ui/confirm';
import { applyTheme } from '../../lib/theme';
import { cn } from '../../lib/utils';

const BUILTIN = ['chat', 'code', 'roleplay'];
const FONT_OPTIONS = [
  { id: 'serif', name: '衬线（宋体）' },
  { id: 'sans', name: '无衬线（黑体）' },
  { id: 'mono', name: '等宽（终端）' },
];
const COLOR_FIELDS = [
  ['paper', '纸面'],
  ['paper2', '浮层'],
  ['ink', '主文字'],
  ['inkSoft', '次文字'],
  ['line', '边框'],
  ['lineSoft', '细边框'],
  ['muted', '灰字'],
  ['card', '卡片'],
  ['accent', '强调'],
];

function rgbToHex(rgb) {
  const m = String(rgb || '').match(/^(\d{1,3}) (\d{1,3}) (\d{1,3})$/);
  if (!m) return '#000000';
  return `#${[1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('')}`;
}
function hexToRgb(hex) {
  const m = String(hex || '').replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return '0 0 0';
  return `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}`;
}

function ThemeSwatch({ t, active, onClick }) {
  const c = t.colors || {};
  const paper = rgbToHex(c.paper);
  const ink = rgbToHex(c.ink);
  const accent = rgbToHex(c.accent);
  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all',
        active ? 'border-ink bg-card shadow-paper' : 'border-line bg-card/50 hover:border-ink/40'
      )}
      style={{ background: paper }}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-black/10 font-serif-display text-sm" style={{ background: paper, color: ink, borderColor: rgbToHex(c.line) }}>
        字
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium" style={{ color: ink }}>{t.name}</span>
        <span className="block truncate text-xs" style={{ color: ink }}>
          {t.builtin ? '内置' : '自定义'}{t.description ? ` · ${t.description}` : ''}
        </span>
      </span>
      <span className="flex gap-0.5">
        {[paper, rgbToHex(c.card), rgbToHex(c.ink), accent].map((col, i) => (
          <span key={i} className="h-3.5 w-3.5 rounded-full border border-black/10" style={{ background: col }} />
        ))}
      </span>
    </button>
  );
}

export default function SettingsDialog({
  settings, modes, plugins, themes = [], themeId, onThemeChange, onThemesChanged, onSave, onClose, onModesChanged,
}) {
  const toast = useToast();
  const [draft, setDraft] = useState({});
  const [modeYaml, setModeYaml] = useState('');
  const [error, setError] = useState('');
  const [confirmMode, setConfirmMode] = useState(null);
  const [confirmTheme, setConfirmTheme] = useState(null);
  const [editId, setEditId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [importText, setImportText] = useState('');

  useEffect(() => setDraft({ ...settings }), [settings]);

  const customModes = (modes || []).filter((m) => !BUILTIN.includes(m.id));
  const currentTheme = themes.find((t) => t.id === themeId) || themes[0] || null;

  const editing = useMemo(() => {
    if (!editDraft) return null;
    const base = themes.find((t) => t.id === editId) || {};
    return { ...base, ...editDraft };
  }, [editDraft, editId, themes]);

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    try {
      // apiKey 未填写则传空字符串，服务端保留原值（脱敏设计）
      const payload = { ...draft, apiKey: draft.apiKey || '' };
      const r = await api.saveSettings(payload);
      onSave(r.settings);
      onClose();
    } catch (e) {
      setError(e.message);
    }
  };

  const createMode = async () => {
    try {
      await api.createMode(modeYaml);
      setModeYaml('');
      onModesChanged();
    } catch (e) {
      setError(e.message);
    }
  };

  const deleteMode = async (id) => {
    try {
      await api.deleteMode(id);
      onModesChanged();
      toast('自定义模式已删除', 'success');
    } catch (e) {
      toast('删除失败：' + e.message, 'error');
    }
  };

  const selectTheme = async (id) => {
    await onThemeChange(id);
    toast('主题已应用', 'success');
  };

  const deleteCustomTheme = async (id) => {
    try {
      await api.deleteTheme(id);
      await onThemesChanged();
      toast('自定义主题已删除', 'success');
    } catch (e) {
      toast('删除失败：' + e.message, 'error');
    }
  };

  const startEdit = (t) => {
    setEditId(t.id);
    setEditDraft({
      name: t.name,
      dark: t.dark,
      font: t.font,
      radius: t.radius,
      noiseOn: t.noiseOn,
      noiseDensity: t.noiseDensity,
      shadowStrength: t.shadowStrength,
      colors: { ...(t.colors || {}) },
    });
  };

  const patchColor = (k, hex) => {
    setEditDraft((d) => ({ ...d, colors: { ...d.colors, [k]: hexToRgb(hex) } }));
  };

  const previewEdit = () => {
    if (!editing) return;
    applyTheme({
      ...editing,
      builtin: false,
      id: editing.id,
      colors: { ...editing.colors, accent: editing.colors.accent || '20 20 20' },
    });
  };

  const saveEdit = async (asNew = false) => {
    if (!editing) return;
    const payload = { ...editing, builtin: false };
    if (!asNew && editing.builtin) {
      payload.id = `custom-${editing.id}`;
    }
    try {
      await api.saveTheme(payload);
      await onThemesChanged();
      if (!asNew && !editing.builtin) await onThemeChange(payload.id);
      toast(asNew || editing.builtin ? '已存为新主题' : '主题已更新', 'success');
      setEditId(null);
      setEditDraft(null);
    } catch (e) {
      toast('保存失败：' + e.message, 'error');
    }
  };

  const exportCurrent = () => {
    if (!editing) return;
    const blob = new Blob([JSON.stringify(editing, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `modeo-theme-${editing.id}.json`;
    a.click();
  };

  const importTheme = async () => {
    try {
      const data = JSON.parse(importText);
      const r = await api.saveTheme(data);
      await onThemesChanged();
      setImportText('');
      toast(`已导入主题「${r.theme.name}」`, 'success');
    } catch (e) {
      toast('导入失败：' + e.message, 'error');
    }
  };

  return (
    <>
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs text-muted">模型提供商</span>
              <select
                value={draft.provider || 'mock'}
                onChange={(e) => set('provider', e.target.value)}
                className="h-10 w-full rounded-xl border border-line bg-card px-3 text-sm focus:border-ink/50 focus:outline-none"
              >
                <option value="mock">Mock（离线演示）</option>
                <option value="openai">OpenAI 兼容 API</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-muted">模型</span>
              <Input value={draft.model || ''} onChange={(e) => set('model', e.target.value)} />
            </label>
            <label className="block col-span-2">
              <span className="mb-1 block text-xs text-muted">Base URL</span>
              <Input value={draft.baseUrl || ''} onChange={(e) => set('baseUrl', e.target.value)} />
            </label>
            <label className="block col-span-2">
              <span className="mb-1 block text-xs text-muted">API Key（仅存本地{draft.apiKeySet ? ' · 已设置' : ''}）</span>
              <Input
                type="password"
                placeholder={draft.apiKeySet ? '已设置，留空则保持不变' : '输入 API Key'}
                value={draft.apiKey || ''}
                onChange={(e) => set('apiKey', e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-muted">Temperature</span>
              <Input type="number" step="0.1" min="0" max="2" value={draft.temperature ?? 0.7} onChange={(e) => set('temperature', Number(e.target.value))} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-muted">角色市场索引 URL</span>
              <Input value={draft.marketUrl || ''} onChange={(e) => set('marketUrl', e.target.value)} placeholder="https://example.com/market.json" />
            </label>
          </div>

          <Separator />
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="font-serif-display text-sm text-ink">外观主题</p>
              {editId && (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => { setEditId(null); setEditDraft(null); }}>取消编辑</Button>
                  <Button size="sm" variant="outline" onClick={() => saveEdit(true)}>存为新主题</Button>
                  <Button size="sm" onClick={() => saveEdit(false)}>保存</Button>
                </div>
              )}
            </div>

            {!editId ? (
              <>
                <div className="grid grid-cols-1 gap-1.5">
                  {themes.map((t) => (
                    <ThemeSwatch key={t.id} t={t} active={t.id === themeId} onClick={() => selectTheme(t.id)} />
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {currentTheme && (
                    <Button size="sm" variant="outline" onClick={() => startEdit(currentTheme)}>编辑当前主题</Button>
                  )}
                  <label className="text-xs text-muted">导入主题 JSON：</label>
                  <div className="flex min-w-0 flex-1 gap-1.5">
                    <Input value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='{"id":"my-theme","name":"我的主题",...}' className="h-8 font-mono text-xs" />
                    <Button size="sm" variant="outline" onClick={importTheme} disabled={!importText.trim()}>导入</Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-3 rounded-2xl border border-line bg-card/50 p-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted">主题名称</span>
                    <Input value={editing?.name || ''} onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted">基底</span>
                    <select
                      value={editing?.dark ? 'dark' : 'light'}
                      onChange={(e) => setEditDraft((d) => ({ ...d, dark: e.target.value === 'dark' }))}
                      className="h-10 w-full rounded-xl border border-line bg-card px-3 text-sm focus:border-ink/50 focus:outline-none"
                    >
                      <option value="light">浅色</option>
                      <option value="dark">深色</option>
                    </select>
                  </label>
                  <label className="block col-span-2">
                    <span className="mb-1 block text-xs text-muted">字体</span>
                    <div className="flex gap-1.5">
                      {FONT_OPTIONS.map((f) => (
                        <button
                          key={f.id}
                          onClick={() => setEditDraft((d) => ({ ...d, font: f.id }))}
                          className={cn('flex-1 rounded-xl border px-2 py-1.5 text-xs transition-colors', editing?.font === f.id ? 'border-ink bg-ink text-paper' : 'border-line bg-card hover:border-ink/40')}
                        >
                          {f.name}
                        </button>
                      ))}
                    </div>
                  </label>
                </div>

                <div className="grid grid-cols-3 gap-x-4 gap-y-2">
                  {COLOR_FIELDS.map(([k, label]) => (
                    <label key={k} className="block">
                      <span className="mb-0.5 block text-[11px] text-muted">{label}</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={rgbToHex(editing?.colors?.[k])}
                          onChange={(e) => patchColor(k, e.target.value)}
                          className="h-8 w-9 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent p-0.5"
                        />
                        <input
                          value={editing?.colors?.[k] || ''}
                          onChange={(e) => setEditDraft((d) => ({ ...d, colors: { ...d.colors, [k]: e.target.value } }))}
                          className="w-full rounded-lg border border-line bg-card px-1.5 py-1 font-mono text-[11px] focus:border-ink/50 focus:outline-none"
                        />
                      </div>
                    </label>
                  ))}
                </div>

                <div className="grid grid-cols-3 gap-x-4">
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] text-muted">圆角 {editing?.radius ?? 16}px</span>
                    <input type="range" min="4" max="24" value={editing?.radius ?? 16} onChange={(e) => setEditDraft((d) => ({ ...d, radius: Number(e.target.value) }))} className="w-full" />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] text-muted">噪点密度 {editing?.noiseDensity ?? 0}</span>
                    <input type="range" min="0" max="60" value={editing?.noiseDensity ?? 0} onChange={(e) => setEditDraft((d) => ({ ...d, noiseDensity: Number(e.target.value) }))} className="w-full" />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] text-muted">阴影 {Math.round((editing?.shadowStrength ?? 0) * 100)}%</span>
                    <input type="range" min="0" max="1" step="0.05" value={editing?.shadowStrength ?? 0} onChange={(e) => setEditDraft((d) => ({ ...d, shadowStrength: Number(e.target.value) }))} className="w-full" />
                  </label>
                </div>

                <label className="flex items-center gap-2 text-xs text-ink-soft">
                  <input type="checkbox" checked={Boolean(editing?.noiseOn)} onChange={(e) => setEditDraft((d) => ({ ...d, noiseOn: e.target.checked }))} />
                  启用纸张噪点纹理
                </label>

                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" onClick={previewEdit}>实时预览</Button>
                  <Button size="sm" variant="outline" onClick={exportCurrent}>导出 JSON</Button>
                  {!editing?.builtin && (
                    <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setConfirmTheme(editing.id)}>删除</Button>
                  )}
                </div>
              </div>
            )}
          </div>

          <Separator />
          <div>
            <p className="mb-2 font-serif-display text-sm text-ink">自定义模式</p>
            {customModes.map((m) => (
              <div key={m.id} className="mb-1.5 flex items-center justify-between rounded-xl border border-line bg-card/50 px-3 py-2">
                <span className="text-sm text-ink">{m.name} <span className="text-xs text-muted">({m.id})</span></span>
                <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setConfirmMode(m.id)}>删除</Button>
              </div>
            ))}
            <Textarea value={modeYaml} onChange={(e) => setModeYaml(e.target.value)} spellCheck={false} placeholder={'id: my-mode\nname: 我的模式\nsystemPrompt: |\n  提示词\ntools: []\ndefaultModel: mock'} className="mt-2 min-h-[120px] font-mono text-xs" />
            <Button size="sm" variant="outline" className="mt-2" onClick={createMode}>新建模式</Button>
          </div>

          <Separator />
          <div>
            <p className="mb-2 font-serif-display text-sm text-ink">已加载插件</p>
            {plugins?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {plugins.map((p, i) => (
                  <span key={i} className="rounded-full border border-line bg-card/60 px-2.5 py-0.5 text-xs text-ink-soft">
                    {p.tool || p.file}{p.error ? '（加载失败）' : ''}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted">（无）</p>
            )}
          </div>
          {error && <p className="whitespace-pre-wrap text-xs text-red-700">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">取消</Button>
          </DialogClose>
          <Button onClick={save}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {confirmMode && (
      <ConfirmDialog
        open
        title="删除自定义模式"
        description={`确认删除自定义模式「${confirmMode}」？`}
        danger
        onCancel={() => setConfirmMode(null)}
        onConfirm={() => {
          const id = confirmMode;
          setConfirmMode(null);
          deleteMode(id);
        }}
      />
    )}
    {confirmTheme && (
      <ConfirmDialog
        open
        title="删除自定义主题"
        description={`确认删除自定义主题「${confirmTheme}」？删除后不可恢复。`}
        danger
        onCancel={() => setConfirmTheme(null)}
        onConfirm={() => {
          const id = confirmTheme;
          setConfirmTheme(null);
          deleteCustomTheme(id);
        }}
      />
    )}
    </>
  );
}
