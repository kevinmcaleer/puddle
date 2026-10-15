import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, type ButtonProps } from './Button';
import { Icon, type IconName } from './Icon';

export interface MenuItem {
  label: string;
  icon?: IconName;
  hint?: string;
  disabled?: boolean;
  onSelect: () => void;
}

/** A button that opens a short list of actions, drawn as a raised popover. Escape or a click outside closes it. */
export function Menu({
  label,
  items,
  button,
  align = 'end',
  renderTrigger,
}: {
  label: ReactNode;
  items: MenuItem[];
  button?: Omit<ButtonProps, 'children' | 'onClick'>;
  align?: 'start' | 'end';
  /** Draw the trigger yourself (e.g. the toolbar's project name); give it the aria props passed in. */
  renderTrigger?: (p: { 'aria-haspopup': 'menu'; 'aria-expanded': boolean; onClick: () => void }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
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
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      {renderTrigger ? (
        renderTrigger({ 'aria-haspopup': 'menu', 'aria-expanded': open, onClick: () => setOpen((o) => !o) })
      ) : (
        <Button {...button} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {label}
          {!button?.iconOnly && <Icon name="chevron-down" size={14} />}
        </Button>
      )}
      {open && (
        <div role="menu" className={`ui-popover absolute top-full z-popover mt-1 py-1 ${align === 'end' ? 'right-0' : 'left-0'}`}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className="flex w-full items-center gap-2 px-3 py-1 text-left text-body text-ink hover:bg-surface-hover disabled:cursor-not-allowed disabled:text-ink-subtle"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon && <Icon name={item.icon} size={14} />}
              <span className="flex-1">{item.label}</span>
              {item.hint && <span className="text-ink-subtle">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
