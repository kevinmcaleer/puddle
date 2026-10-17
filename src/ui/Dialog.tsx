import { useEffect, useRef, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './cx';

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

/**
 * A modal dialog on the native <dialog> element (focus trap, Escape to close). The confirm button submits the
 * form, so Enter confirms; `danger` styles it for destructive actions such as delete. Without `confirm` it only
 * shows something, with a Close button. Focus starts on the first element marked `data-autofocus` (else the first
 * control) and goes back to whatever had it before when the dialog closes.
 */
export function Dialog({
  title,
  children,
  confirm,
  confirmDisabled,
  danger,
  onConfirm,
  onClose,
  className,
}: {
  title: string;
  children?: ReactNode;
  confirm?: string;
  /** Grey out the confirm button (and ignore Enter) until the form is ready. */
  confirmDisabled?: boolean;
  danger?: boolean;
  onConfirm?: () => void;
  onClose: () => void;
  /** Width and the like, in place of the default inspector width. */
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    if (d && !d.open) d.showModal();
    // React's autoFocus runs while the dialog is still closed, when nothing in it can take focus; this runs once it's open.
    d?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      d?.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  // A modal dialog already keeps the page behind it out of reach. Tab is also kept inside it, wrapping round from the
  // last control to the first and back, rather than leaving for the browser's own controls; the dialog moves the
  // focus itself, so every browser goes through the same controls (Safari's Tab otherwise skips buttons).
  const trapTab = (e: KeyboardEvent) => {
    // A field that uses Tab itself (accepting a suggestion, say) has already prevented it.
    if (e.key !== 'Tab' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || !ref.current) return;
    const all = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.matches(':disabled, [type="hidden"]') && !el.closest('[hidden]') && el.tabIndex >= 0);
    if (!all.length) return;
    e.preventDefault();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next = at < 0 ? (e.shiftKey ? all.length - 1 : 0) : (at + (e.shiftKey ? -1 : 1) + all.length) % all.length;
    all[next]!.focus();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (confirmDisabled) return;
    if (onConfirm) onConfirm();
    else onClose();
  };
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={cx(className ?? 'w-[var(--size-inspector)]', 'rounded-lg border border-line bg-surface-raised p-0 text-ink shadow-dialog backdrop:bg-ink backdrop:opacity-40')}
      onKeyDown={trapTab}
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
              <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={confirmDisabled}>{confirm}</Button>
            </>
          ) : (
            <Button type="submit" variant="secondary" data-autofocus>Close</Button>
          )}
        </div>
      </form>
    </dialog>
  );
}
