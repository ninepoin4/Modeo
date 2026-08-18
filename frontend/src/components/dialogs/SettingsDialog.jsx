import { useEffect, useMemo, useRef, useState } from 'react';
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
import { fileToDataUrl, loadImage, samplePixels, extractMainColor, buildSkinTheme } from '../../lib/skin';
import { ImagePlus, Loader2 } from 'lucide-react';

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
  const [skinDataUrl, setSkinDataUrl] = useState('');
  const [skinName, setSkinName] = useState('');
  const [skinBusy, setSkinBusy] = useState(false);
  // 多厂商（2026-08-18）：每个厂商的 apiKey 输入临时值（'' = 未修改保留 / null = 清除）；脱敏后无明文，输入框单独管理
  const [keyInputs, setKeyInputs] = useState({});
  const [modelsBusy, setModelsBusy] = useState(false);

  // 仅在弹窗挂载时初始化草稿；settings 后续变化（如主题切换）不同步，避免清空未保存编辑
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    setDraft({ ...settings });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const customModes = (modes || []).filter((m) => !BUILTIN.includes(m.id));
  const currentTheme = themes.find((t) => t.id === themeId) || themes[0] || null;

  const editing = useMemo(() => {
    if (!editDraft) return null;
    const base = themes.find((t) => t.id === editId) || {};
    return { ...base, ...editDraft };
  }, [editDraft, editId, themes]);

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  // 未保存检测：draft 与传入 settings 不一致（含 keyInputs）时关闭给提示
  const dirty = useMemo(() => {
    if (JSON.stringify(draft) !== JSON.stringify(settings)) return true;
    return Object.values(keyInputs).some((v) => v !== undefined && v !== null && v !== '');
  }, [draft, settings, keyInputs]);

  // ---- 多厂商 helpers（2026-08-18）----
  const providers = draft.providers || [];
  const activeProvider = providers.find((p) => p.id === draft.activeProviderId) || null;
  const updateProvider = (id, patch) =>
    set('providers', providers.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const addProvider = () => {
    const np = { id: `p-${Date.now().toString(36)}`, name: '新厂商', provider: 'openai', baseUrl: '', apiKeySet: false, model: '', models: [] };
    set('providers', [...providers, np]);
    set('activeProviderId', np.id);
  };
  const removeProvider = (id) => {
    const rest = providers.filter((p) => p.id !== id);
    set('providers', rest);
    if (draft.activeProviderId === id) set('activeProviderId', rest[0]?.id || 'mock');
  };
  const fetchModelsFor = async (id) => {
    const p = providers.find((x) => x.id === id);
    if (!p || !/^https?:\/\//i.test(p.baseUrl || '')) {
      toast('请先填写 Base URL（以 http(s):// 开头）', 'error');
      return;
    }
    setModelsBusy(true);
    try {
      const r = await api.fetchModels(p.baseUrl, keyInputs[id] || '');
      updateProvider(id, { models: r.models || [], model: (r.models || [])[0] || p.model });
      toast(`获取到 ${(r.models || []).length} 个模型`, 'success');
    } catch (e) {
      toast(e.message || '获取模型列表失败', 'error');
    } finally {
      setModelsBusy(false);
    }
  };

  const save = async () => {
    try {
      // 多厂商（2026-08-18）：providers 数组整体保存；每个厂商 apiKey 由输入框临时值决定
      // （'' = 服务端保留原值 / null = 清除）；theme 用当前 themeId 覆盖
      const payload = {
        ...draft,
        providers: (draft.providers || []).map((p) => ({ ...p, apiKey: keyInputs[p.id] ?? '' })),
        activeProviderId: draft.activeProviderId,
        theme: themeId,
      };
      const r = await api.saveSettings(payload);
      onSave(r.settings);
      const act = r.settings.providers?.find((p) => p.id === r.settings.activeProviderId);
      const wsChanged = draft.workspaceDir !== settings?.workspaceDir;
      toast(
        wsChanged
          ? `设置已保存（当前厂商：${act?.name || '未配置'}）· 工作区目录已更新，重启 Modeo 后生效`
          : `设置已保存（当前厂商：${act?.name || '未配置'}）`,
        'success'
      );
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

  /** 皮肤：选择背景图 → 本地预览（不上传，直到用户确认生成） */
  const pickSkinFile = async (e) => {
    const f = e.target?.files?.[0];
    e.target.value = ''; // 允许重复选同一文件
    if (!f) return;
    try {
      const dataUrl = await fileToDataUrl(f);
      setSkinDataUrl(dataUrl);
      setSkinName(f.name.replace(/\.[^.]+$/, '').slice(0, 24) || '皮肤');
    } catch (err) {
      toast(err.message || '图片读取失败', 'error');
    }
  };

  /** 皮肤：上传背景图 → 取主色 → 生成主题 → 保存并应用（音乐 App 一键换肤） */
  const generateSkin = async () => {
    if (!skinDataUrl || skinBusy) return;
    setSkinBusy(true);
    try {
      const img = await loadImage(skinDataUrl);
      const main = extractMainColor(samplePixels(img));
      const up = await api.uploadThemeBackground(skinDataUrl);
      const theme = buildSkinTheme(main, { name: skinName.trim() || '皮肤', background: up.url });
      const r = await api.saveTheme(theme);
      await onThemesChanged();
      await onThemeChange(r.theme.id);
      toast('皮肤已应用——可点「编辑当前主题」手动微调', 'success');
      setSkinDataUrl('');
      setSkinName('');
    } catch (e) {
      toast('生成失败：' + e.message, 'error');
    } finally {
      setSkinBusy(false);
    }
  };

  return (
    <>
    <Dialog open onOpenChange={(o) => !o && (dirty ? (toast('有未保存的修改，已放弃', 'info'), onClose()) : onClose())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto p-0">
        <div className="flex max-h-[84vh] flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>
        <DialogBody className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div className="space-y-3">
            <div>
              <p className="mb-2 text-sm text-ink">模型厂商</p>
              <div className="space-y-1.5">
                {providers.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 transition-colors ${
                      draft.activeProviderId === p.id ? 'border-ink/40 bg-card' : 'border-line bg-card/40 hover:bg-card/60'
                    }`}
                  >
                    <input
                      type="radio"
                      name="activeProvider"
                      checked={draft.activeProviderId === p.id}
                      onChange={() => set('activeProviderId', p.id)}
                      className="accent-ink"
                    />
                    <button type="button" onClick={() => set('activeProviderId', p.id)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm text-ink">{p.name || '（未命名厂商）'}</span>
                      <span className="block truncate text-xs text-muted">
                        {p.provider === 'mock' ? '离线演示（无网络）' : `${p.baseUrl || '未填 Base URL'}${p.model ? ` · ${p.model}` : ''}`}
                      </span>
                    </button>
                    {p.provider !== 'mock' && (
                      <Button size="sm" variant="ghost" onClick={() => removeProvider(p.id)}>删除</Button>
                    )}
                  </div>
                ))}
              </div>
              <Button size="sm" variant="outline" className="mt-2" onClick={addProvider}>+ 添加厂商</Button>
            </div>

            {activeProvider && (
              <div className="space-y-2.5 rounded-2xl border border-line bg-card/50 p-3">
                <p className="text-xs font-medium text-muted">
                  {activeProvider.provider === 'mock' ? 'Mock 厂商（离线演示，无需配置）' : '编辑厂商'}
                </p>
                {activeProvider.provider !== 'mock' && (
                  <>
                    <label className="block">
                      <span className="mb-1 block text-xs text-muted">厂商名称</span>
                      <Input value={activeProvider.name || ''} onChange={(e) => updateProvider(activeProvider.id, { name: e.target.value })} />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-muted">Base URL</span>
                      <Input
                        value={activeProvider.baseUrl || ''}
                        onChange={(e) => updateProvider(activeProvider.id, { baseUrl: e.target.value })}
                        placeholder="https://api.openai.com/v1"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 flex items-center justify-between text-xs text-muted">
                        <span>API Key（仅存本地{activeProvider.apiKeySet ? ' · 已设置' : ''}）</span>
                        {activeProvider.apiKeySet && (
                          <button
                            type="button"
                            className="text-xs text-muted underline underline-offset-2 hover:text-ink"
                            onClick={() => setKeyInputs((k) => ({ ...k, [activeProvider.id]: null }))}
                          >
                            {keyInputs[activeProvider.id] === null ? '将清除该密钥' : '清除密钥'}
                          </button>
                        )}
                      </span>
                      <Input
                        type="password"
                        placeholder={activeProvider.apiKeySet ? '已设置，留空则保持不变' : '输入 API Key'}
                        value={keyInputs[activeProvider.id] ?? ''}
                        onChange={(e) => setKeyInputs((k) => ({ ...k, [activeProvider.id]: e.target.value }))}
                      />
                    </label>
                    <div className="flex items-end gap-2">
                      <label className="block flex-1">
                        <span className="mb-1 block text-xs text-muted">模型</span>
                        {activeProvider.models?.length ? (
                          <select
                            value={activeProvider.model || ''}
                            onChange={(e) => updateProvider(activeProvider.id, { model: e.target.value })}
                            className="h-10 w-full rounded-xl border border-line bg-card px-3 text-sm focus:border-ink/50 focus:outline-none"
                          >
                            {activeProvider.models.map((m) => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                        ) : (
                          <Input
                            value={activeProvider.model || ''}
                            onChange={(e) => updateProvider(activeProvider.id, { model: e.target.value })}
                            placeholder="如 gpt-4o"
                          />
                        )}
                      </label>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={modelsBusy}
                        onClick={() => fetchModelsFor(activeProvider.id)}
                      >
                        {modelsBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        {modelsBusy ? '获取中…' : '获取模型列表'}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-muted">Temperature</span>
                <Input type="number" step="0.1" min="0" max="2" value={draft.temperature ?? 0.7} onChange={(e) => set('temperature', Number(e.target.value))} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-muted">角色市场索引 URL</span>
                <Input value={draft.marketUrl || ''} onChange={(e) => set('marketUrl', e.target.value)} placeholder="https://example.com/market.json" />
              </label>
            </div>
            {/* 2026-08-18：工作区目录可配置——沙箱边界即工作区，指向项目根即可让 AI review/开发项目本身 */}
            <label className="mt-3 block">
              <span className="mb-1 block text-xs text-muted">工作区目录（沙箱边界，AI 只能访问这里）</span>
              <Input
                value={draft.workspaceDir || ''}
                onChange={(e) => set('workspaceDir', e.target.value)}
                placeholder="留空 = 默认 workspaces/default；填项目根目录路径（如 D:\my-project）"
              />
              <span className="mt-1 block text-[11px] text-muted/80">
                建议指向你的项目根目录（如 Modeo 自身源码目录），AI 即可读取/修改项目文件；危险命令仍需审批。保存后需重启 Modeo 生效。
              </span>
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

            {/* 背景皮肤（音乐 App 式）：上传背景图 → 自动取色生成匹配色板 */}
            <div className="mb-3 rounded-2xl border border-dashed border-line bg-card/40 p-3">
              <p className="mb-1 text-sm text-ink">背景皮肤</p>
              <p className="mb-2 text-xs text-muted">
                上传一张背景图，自动提取主色调生成匹配色板（也可再进「编辑当前主题」手动微调）。
              </p>
              <div className="flex items-center gap-2">
                {skinDataUrl && (
                  <img src={skinDataUrl} alt="背景预览" className="h-14 w-24 shrink-0 rounded-lg border border-line object-cover" />
                )}
                <label className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border border-line bg-card px-3 text-xs text-ink-soft transition-colors hover:border-ink/40">
                  <ImagePlus className="h-3.5 w-3.5" />
                  选择背景图
                  <input type="file" accept="image/*" hidden onChange={pickSkinFile} data-testid="skin-file" />
                </label>
                <Button size="sm" variant="outline" onClick={generateSkin} disabled={!skinDataUrl || skinBusy} data-testid="skin-generate">
                  {skinBusy ? '生成中…' : '从图片生成配色'}
                </Button>
                {skinBusy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}
              </div>
              {skinDataUrl && (
                <Input
                  value={skinName}
                  onChange={(e) => setSkinName(e.target.value)}
                  placeholder="皮肤主题名称"
                  className="mt-2 h-8 text-xs"
                  data-testid="skin-name"
                />
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
        <DialogFooter className="shrink-0 border-t border-line bg-paper">
          <DialogClose asChild>
            <Button variant="ghost">取消</Button>
          </DialogClose>
          <Button onClick={save}>保存</Button>
        </DialogFooter>
        </div>
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
