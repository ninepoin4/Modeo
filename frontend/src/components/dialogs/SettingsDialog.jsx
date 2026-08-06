import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogClose } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Separator } from '../ui/separator';
import { api } from '../../api';
import { useToast } from '../ui/toast';
import { ConfirmDialog } from '../ui/confirm';

const BUILTIN = ['chat', 'code', 'roleplay'];

export default function SettingsDialog({ settings, modes, plugins, onSave, onClose, onModesChanged }) {
  const toast = useToast();
  const [draft, setDraft] = useState({});
  const [modeYaml, setModeYaml] = useState('');
  const [error, setError] = useState('');
  const [confirmMode, setConfirmMode] = useState(null);
  useEffect(() => setDraft({ ...settings }), [settings]);
  const customModes = (modes || []).filter((m) => !BUILTIN.includes(m.id));

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    try {
      const r = await api.saveSettings(draft);
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

  return (
    <>
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
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
              <span className="mb-1 block text-xs text-muted">API Key（仅存本地）</span>
              <Input type="password" value={draft.apiKey || ''} onChange={(e) => set('apiKey', e.target.value)} />
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
    </>
  );
}
