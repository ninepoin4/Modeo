import { useState } from 'react';
import { motion } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';

/** ask_user 问答弹窗：模型中途提问，用户点选选项/输入回答/跳过（2026-08-15 新增） */
export default function QuestionDialog({ question, onAnswer }) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = (value) => {
    if (submitting) return;
    setSubmitting(true);
    onAnswer(value, false);
  };

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent className="w-[min(520px,92vw)]">
        <DialogHeader>
          <DialogTitle>需要你回答</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-xl border border-line bg-card p-4 text-sm text-ink shadow-paper"
          >
            {question.question}
          </motion.div>
          {question.options && question.options.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {question.options.map((opt, i) => (
                <Button key={i} size="sm" variant="outline" onClick={() => submit(opt)} disabled={submitting}>
                  {opt}
                </Button>
              ))}
            </div>
          )}
          <div className="mt-3">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="输入你的回答…"
              rows={2}
              className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              disabled={submitting}
            />
          </div>
          {submitting && <p className="mt-2 text-xs text-muted">已提交，等待继续…</p>}
        </DialogBody>
        <DialogFooter className="flex justify-between">
          <Button size="sm" variant="ghost" onClick={() => !submitting && onAnswer('', true)} disabled={submitting}>
            跳过
          </Button>
          <Button size="sm" onClick={() => submit(text.trim())} disabled={submitting || !text.trim()}>
            回答
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
