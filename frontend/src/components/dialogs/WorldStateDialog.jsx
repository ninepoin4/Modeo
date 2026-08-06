import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogClose } from '../ui/dialog';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';

function toText(ws) {
  return Object.entries(ws || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
}

function parseText(text) {
  const updates = {};
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k && v) updates[k] = v;
  }
  return updates;
}

export default function WorldStateDialog({ worldState, onSave, onClear, onClose }) {
  const [text, setText] = useState('');
  useEffect(() => setText(toText(worldState)), [worldState]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(480px,92vw)]">
        <DialogHeader>
          <DialogTitle>世界状态</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="mb-2 text-xs text-muted">每行一条事实，格式：键: 值（留空键或值将被忽略）</p>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} spellCheck={false} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" className="text-red-700" onClick={() => { onClear(); onClose(); }}>清空</Button>
          <DialogClose asChild>
            <Button variant="ghost">取消</Button>
          </DialogClose>
          <Button onClick={() => { onSave(parseText(text)); onClose(); }}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
