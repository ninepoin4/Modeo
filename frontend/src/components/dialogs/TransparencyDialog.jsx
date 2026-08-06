import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter, DialogClose } from '../ui/dialog';
import { Button } from '../ui/button';
import { Spinner } from '../ui/spinner';
import { api } from '../../api';

export default function TransparencyDialog({ sessionId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.prompt(sessionId).then(setData).catch((e) => setError(e.message));
  }, [sessionId]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>提示词透明面板</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {!data && !error && <div className="flex justify-center py-8"><Spinner /></div>}
          {error && <p className="text-xs text-red-700">{error}</p>}
          {data && (
            <>
              <div>
                <p className="mb-1 text-xs text-muted">会话 / 模式</p>
                <p className="text-sm text-ink">{data.sessionId} · {data.modeName}</p>
              </div>
              <div>
                <p className="mb-1 text-xs text-muted">系统提示词</p>
                <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded-xl bg-paper2 p-3 font-mono text-xs text-ink-soft">
                  {data.systemPrompt === null || data.systemPrompt === '' ? '（无 — 零注入模式）' : data.systemPrompt}
                </pre>
              </div>
              <div className="flex gap-4 text-sm">
                <span className="text-muted">工具：<span className="text-ink">{data.tools?.length ? data.tools.join(', ') : '无'}</span></span>
                <span className="text-muted">模型：<span className="text-ink">{data.model}</span></span>
                <span className="text-muted">消息：<span className="text-ink">{data.messageCount}</span></span>
              </div>
              <div>
                <p className="mb-1 text-xs text-muted">实际发送的消息结构</p>
                <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded-xl bg-paper2 p-3 font-mono text-xs text-ink-soft">
                  {JSON.stringify(data.messages, null, 2)}
                </pre>
              </div>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">关闭</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
