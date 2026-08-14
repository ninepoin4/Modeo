import { useState } from 'react';
import { motion } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';

export default function ApprovalDialog({ approval, onDecide }) {
  const [editing, setEditing] = useState(false);
  const [argsText, setArgsText] = useState(() => JSON.stringify(approval.toolCall?.args ?? {}, null, 2));
  const [error, setError] = useState('');

  const handleApprove = () => {
    if (!editing) return onDecide('approve');
    try {
      const parsed = JSON.parse(argsText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        setError('');
        return onDecide('approve', parsed);
      }
      setError('参数必须是 JSON 对象');
    } catch {
      setError('JSON 解析失败，请检查格式');
    }
  };

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent className="w-[min(520px,92vw)]">
        <DialogHeader>
          <DialogTitle>需要审批</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="mb-3 text-sm text-muted">检测到危险操作，请确认是否允许执行：</p>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-xl border border-line bg-card p-4 font-mono text-xs text-ink shadow-paper"
          >
            {approval.summary}
          </motion.div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing((v) => !v);
                setError('');
                if (!editing && approval.toolCall?.args !== undefined) {
                  setArgsText(JSON.stringify(approval.toolCall.args, null, 2));
                }
              }}
              className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-line-secondary hover:text-ink"
            >
              {editing ? '收起参数编辑' : '编辑参数后执行'}
            </button>
            {editing && <span className="text-xs text-muted">批准时将用编辑后的参数执行工具</span>}
          </div>
          {editing && (
            <div className="mt-2">
              <textarea
                value={argsText}
                onChange={(e) => {
                  setArgsText(e.target.value);
                  setError('');
                }}
                rows={6}
                spellCheck={false}
                className="w-full resize-y rounded-xl border border-line bg-card p-3 font-mono text-xs text-ink outline-none focus:border-line-secondary"
                placeholder='{"command": "ls"}'
              />
              {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" className="text-red-700" onClick={() => onDecide('deny')}>拒绝</Button>
          <Button onClick={handleApprove}>批准{editing ? '并执行' : ''}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
