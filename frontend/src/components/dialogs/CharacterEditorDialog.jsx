import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogClose } from '../ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { api } from '../../api';
import { useToast } from '../ui/toast';
import { ConfirmDialog } from '../ui/confirm';

const TEMPLATE = `id: my-character
name: 新角色
version: "1.0"
tags: []
description: 一段简短介绍
persona:
  identity: 你是谁
  background: 背景故事
  personality: 性格
  speakingStyle: 说话风格
setting:
  world: 世界观
  scenario: 当前场景
rules: []
boundaries: []
greeting: 开场白
example_messages: []
memory_seeds: []
`;

function lines(v) {
  return Array.isArray(v) ? v.join('\n') : '';
}

export default function CharacterEditorDialog({ id, onClose, onSaved }) {
  const toast = useToast();
  const [yaml, setYaml] = useState(TEMPLATE);
  const [view, setView] = useState('source');
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!!id);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.character(id).then((r) => setYaml(r.yaml)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [id]);

  const toForm = async () => {
    try {
      const r = await api.parse(yaml);
      const d = r.data;
      setForm({
        name: d.name || '',
        id: d.id || '',
        description: d.description || '',
        greeting: d.greeting || '',
        tags: (d.tags || []).join(', '),
        identity: d.persona?.identity || '',
        background: d.persona?.background || '',
        personality: d.persona?.personality || '',
        speakingStyle: d.persona?.speakingStyle || '',
        world: d.setting?.world || '',
        scenario: d.setting?.scenario || '',
        rules: lines(d.rules),
        boundaries: lines(d.boundaries),
        memory_seeds: lines(d.memory_seeds),
      });
      setView('form');
    } catch (e) {
      setError(e.message);
    }
  };

  const toSource = async () => {
    try {
      const data = {
        name: form.name,
        id: form.id || undefined,
        description: form.description,
        greeting: form.greeting,
        tags: form.tags.split(',').map((s) => s.trim()).filter(Boolean),
        persona: { identity: form.identity, background: form.background, personality: form.personality, speakingStyle: form.speakingStyle },
        setting: { world: form.world, scenario: form.scenario },
        rules: form.rules.split('\n').map((s) => s.trim()).filter(Boolean),
        boundaries: form.boundaries.split('\n').map((s) => s.trim()).filter(Boolean),
        memory_seeds: form.memory_seeds.split('\n').map((s) => s.trim()).filter(Boolean),
      };
      const r = await api.stringify(data);
      setYaml(r.yaml);
      setView('source');
    } catch (e) {
      setError(e.message);
    }
  };

  const save = async () => {
    try {
      const r = await api.saveCharacter(yaml, id);
      onSaved(r.character);
    } catch (e) {
      setError(e.message);
    }
  };

  const remove = async () => {
    if (!id) return;
    try {
      await api.deleteCharacter(id);
      toast('角色已删除', 'success');
      onSaved(null, true);
    } catch (e) {
      toast('删除失败：' + e.message, 'error');
    }
  };

  const exportCcv3 = async () => {
    if (!id) return;
    const data = await api.exportCharacterCcv3(id);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${id}.ccv3.json`;
    a.click();
  };

  const F = ({ label, field, textarea }) =>
    textarea ? (
      <label className="block">
        <span className="mb-1 block text-xs text-muted">{label}</span>
        <Textarea rows={2} value={form[field]} onChange={(e) => setForm({ ...form, [field]: e.target.value })} />
      </label>
    ) : (
      <label className="block">
        <span className="mb-1 block text-xs text-muted">{label}</span>
        <Input value={form[field]} onChange={(e) => setForm({ ...form, [field]: e.target.value })} />
      </label>
    );

  return (
    <>
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader className="flex items-center justify-between pr-12">
          <DialogTitle>{id ? `编辑角色 · ${id}` : '新建角色'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Tabs value={view} onValueChange={setView} className="mb-3">
            <TabsList>
              <TabsTrigger value="source">源码</TabsTrigger>
              <TabsTrigger value="form" onClick={view === 'source' ? toForm : undefined}>表单</TabsTrigger>
            </TabsList>
          </Tabs>
          {view === 'source' ? (
            <Textarea value={yaml} onChange={(e) => setYaml(e.target.value)} spellCheck={false} className="min-h-[340px] font-mono text-xs" />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <F label="名称" field="name" />
              <F label="ID" field="id" />
              <div className="col-span-2">
                <F label="简介" field="description" textarea />
              </div>
              <div className="col-span-2">
                <F label="开场白" field="greeting" textarea />
              </div>
              <F label="身份" field="identity" />
              <F label="性格" field="personality" />
              <F label="背景" field="background" textarea />
              <F label="说话风格" field="speakingStyle" textarea />
              <F label="世界观" field="world" />
              <F label="场景" field="scenario" />
              <div className="col-span-2">
                <F label="规则（每行一条）" field="rules" textarea />
              </div>
              <div className="col-span-2">
                <F label="边界（每行一条）" field="boundaries" textarea />
              </div>
              <div className="col-span-2">
                <F label="记忆种子（每行一条）" field="memory_seeds" textarea />
              </div>
              <F label="标签（逗号分隔）" field="tags" />
              <Button variant="outline" onClick={toSource} className="self-end">
                转为源码
              </Button>
            </div>
          )}
          {error && <p className="mt-2 whitespace-pre-wrap text-xs text-red-700">{error}</p>}
        </DialogBody>
        <DialogFooter>
          {id && (
            <div className="mr-auto flex gap-2">
              <Button variant="outline" onClick={exportCcv3}>导出 CCv3</Button>
              <Button variant="ghost" className="text-red-700" onClick={() => setConfirmDel(true)}>删除</Button>
            </div>
          )}
          <DialogClose asChild>
            <Button variant="ghost">取消</Button>
          </DialogClose>
          <Button onClick={save} disabled={loading}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {id && confirmDel && (
      <ConfirmDialog
        open
        title="删除角色"
        description={`确认删除角色「${id}」？此操作不可恢复。`}
        danger
        onCancel={() => setConfirmDel(false)}
        onConfirm={() => {
          setConfirmDel(false);
          remove();
        }}
      />
    )}
    </>
  );
}
