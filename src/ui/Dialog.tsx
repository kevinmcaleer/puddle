import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './cx';

/**
 * A modal dialog on the native <dialog> element (focus trap, Escape to close). The confirm button submits the
 * form, so Enter confirms; `danger` styles it for destructive actions such as delete. Without `confirm` it only
 * shows something, with a Close button.
 */
export function Dialog({
  title,
  children,
  confirm,
  danger,
  onConfirm,
  onClose,
  className,
}: {
  title: string;
  children?: ReactNode;
  confirm?: string;
  danger?: boolean;
  onConfirm?: () => void;
  onClose: () => void;
  /** Width and the like, in place of the default inspector width. */
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (onConfirm) onConfirm();
    else onClose();
  };
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={cx(className ?? 'w-[var(--size-inspector)]', 'rounded-lg border border-line bg-surface-raised p-0 text-ink shadow-dialog backdrop:bg-ink backdrop:opacity-40')}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <form className="flex flex-col gap-4 p-4" onSubmit={submit}>
        <h2 className="font-display text-heading">{title}</h2>
        {children}
        <div className="flex justify-end gap-2">
          {confirm ? (
            <>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" variant={danger ? 'danger' : 'primary'}>{confirm}</Button>
            </>
          ) : (
            <Button type="submit" variant="secondary" autoFocus>Close</Button>
          )}
        </div>
      </form>
    </dialog>
  );
}
