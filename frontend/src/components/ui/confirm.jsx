import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from './dialog';
import { Button } from './button';

export function ConfirmDialog({ open, title, description, danger, onConfirm, onCancel }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="w-[min(420px,92vw)]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{description}</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>取消</Button>
          <Button variant={danger ? 'outline' : 'default'} className={danger ? 'text-red-700' : ''} onClick={onConfirm}>
            确认
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
