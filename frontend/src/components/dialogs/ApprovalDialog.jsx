import { motion } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';

export default function ApprovalDialog({ approval, onDecide }) {
  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent className="w-[min(460px,92vw)]">
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
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" className="text-red-700" onClick={() => onDecide('deny')}>拒绝</Button>
          <Button onClick={() => onDecide('approve')}>批准</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
