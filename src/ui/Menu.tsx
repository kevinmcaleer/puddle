import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, type ButtonProps } from './Button';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

export interface MenuItem {
  label: string;
  icon?: IconName;
  hint?: string;
  /** The item's keyboard shortcut, e.g. "T", shown in mono at the right. */
  shortcut?: string;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * A button that opens a short list of actions, drawn as a raised popover. Escape or a click outside closes it. With
 * `search`, a field on top filters the items and Enter picks the first one left.
 */
export function Menu({
  label,
  items,
  button,
  align = 'end',
  renderTrigger,
  className,
  search,
  open: controlled,
  onOpenChange,
}: {
  label: ReactNode;
  items: MenuItem[];
  button?: Omit<ButtonProps, 'children' | 'onClick'>;
  align?: 'start' | 'end';
  /** Draw the trigger yourself (e.g. the toolbar's project name); give it the aria props passed in. */
  renderTrigger?: (p: { 'aria-haspopup': 'menu'; 'aria-expanded': boolean; onClick: () => void }) => ReactNode;
  /** Classes for the wrapper, e.g. to let a trigger inside a flex row shrink. */
  className?: string;
  /** The search field's label, e.g. "Search steps"; no field without it. */
  search?: string;
  /** Open or closed from outside (e.g. a keyboard shortcut opens it); `onOpenChange` hears every change. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlled === undefined) setOwn(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  // The search starts empty each time the menu opens. Only closing clears it: the effect above also runs again when
  // the parent passes a new onOpenChange, and clearing there threw away what was being typed.
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((i) => `${i.label} ${i.hint ?? ''}`.toLowerCase().includes(q)) : items;
  const pick = (item: MenuItem) => {
    setOpen(false);
    item.onSelect();
  };

  return (
    <div className={cx('relative', className)} ref={ref}>
      {renderTrigger ? (
        renderTrigger({ 'aria-haspopup': 'menu', 'aria-expanded': open, onClick: () => setOpen(!open) })
      ) : (
        <Button {...button} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          {label}
          {!button?.iconOnly && <Icon name="chevron-down" size={14} />}
        </Button>
      )}
      {open && (
        <div role="menu" className={`ui-popover absolute top-full z-popover mt-1 py-1 ${align === 'end' ? 'right-0' : 'left-0'}`}>
          {search && (
            <div className="px-2 pb-1">
              <input
                className="ui-input"
                aria-label={search}
                placeholder={search}
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  const first = shown.find((i) => !i.disabled);
                  if (e.key === 'Enter' && first) {
                    e.preventDefault();
                    pick(first);
                  }
                }}
              />
            </div>
          )}
          {search && !shown.length && <div className="px-3 py-1 text-ink-muted">No matches</div>}
          {shown.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className="flex w-full items-center gap-2 px-3 py-1 text-left text-body text-ink hover:bg-surface-hover disabled:cursor-not-allowed disabled:text-ink-subtle"
              onClick={() => pick(item)}
            >
              {item.icon && <Icon name={item.icon} size={14} />}
              <span className="flex-1">{item.label}</span>
              {item.hint && <span className="text-ink-subtle">{item.hint}</span>}
              {item.shortcut && <kbd className="font-mono text-label text-ink-subtle">{item.shortcut}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
