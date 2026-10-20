import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Button, type ButtonProps } from './Button';
import { cx } from './cx';
import { Icon } from './Icon';

export interface CheckItem {
  id: string;
  label: string;
  /** Items with the same group sit together under its heading, in the order the groups first appear. */
  group?: string;
  hint?: string;
  checked: boolean;
}

/**
 * A button with an optional dropdown: the main part does the whole thing in one click ("Fix all"); the arrow opens a
 * list of the parts with a checkbox each, so a few can be unticked and the rest applied with the button at the
 * bottom. Space toggles the focused item, Enter applies, Escape closes.
 */
export function SplitButton({
  label,
  onClick,
  items,
  onToggle,
  applyLabel,
  onApply,
  menuLabel,
  disabled,
  variant = 'primary',
  size = 'sm',
  align = 'end',
  testId,
}: {
  label: string;
  onClick: () => void;
  items: CheckItem[];
  onToggle: (id: string, checked: boolean) => void;
  /** The apply button's label, e.g. "Apply 5 fixes"; the button is disabled when nothing is ticked. */
  applyLabel: string;
  onApply: () => void;
  /** Names the dropdown for assistive tech, e.g. "Choose fixes". */
  menuLabel: string;
  disabled?: boolean;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  align?: 'start' | 'end';
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const ticked = items.filter((i) => i.checked).length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const inside = ref.current?.contains(document.activeElement);
      setOpen(false);
      if (inside) ref.current?.querySelector<HTMLElement>('[aria-haspopup="dialog"]')?.focus();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Opened, the first checkbox takes focus, so the arrow keys and Space work straight away.
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
  }, [open]);

  const apply = () => {
    setOpen(false);
    onApply();
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (ticked) apply();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const boxes = [...(ref.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [])];
    const i = boxes.indexOf(document.activeElement as HTMLInputElement);
    if (i < 0) return;
    e.preventDefault();
    boxes[(i + (e.key === 'ArrowDown' ? 1 : boxes.length - 1)) % boxes.length]?.focus();
  };

  // Groups in the order they first appear; ungrouped items first.
  const groups: { group: string | undefined; items: CheckItem[] }[] = [];
  for (const item of items) {
    const g = groups.find((x) => x.group === item.group);
    if (g) g.items.push(item);
    else groups.push({ group: item.group, items: [item] });
  }
  groups.sort((a, b) => (a.group === undefined ? -1 : b.group === undefined ? 1 : 0));

  return (
    <div className="relative inline-flex" ref={ref} data-testid={testId}>
      <span className="ui-split">
        <Button variant={variant} size={size} disabled={disabled} onClick={onClick} className="ui-split__main">
          {label}
        </Button>
        <Button
          variant={variant}
          size={size}
          disabled={disabled}
          iconOnly
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={menuLabel}
          className="ui-split__arrow"
          onClick={() => setOpen(!open)}
        >
          <Icon name="chevron-down" size={14} />
        </Button>
      </span>
      {open && (
        <div
          role="dialog"
          aria-label={menuLabel}
          className={cx('ui-popover absolute top-full z-popover mt-1 py-1', align === 'end' ? 'right-0' : 'left-0')}
          style={{ minWidth: 260 }}
          onKeyDown={onKeyDown}
        >
          <div className="max-h-[60vh] overflow-y-auto">
            {groups.map(({ group, items: members }, g) => (
              <div key={group ?? ''} role="group" aria-labelledby={group ? `${headingId}-${g}` : undefined} className={g > 0 ? 'mt-1 border-t border-line pt-1' : undefined}>
                {group && (
                  <div id={`${headingId}-${g}`} className="ui-eyebrow px-3 pb-1 pt-2">
                    {group}
                  </div>
                )}
                {members.map((item) => (
                  <label key={item.id} className="ui-check" data-testid={`check-${item.id}`}>
                    <input type="checkbox" checked={item.checked} aria-label={item.label} aria-describedby={item.hint ? `${headingId}-${item.id}` : undefined} onChange={(e) => onToggle(item.id, e.target.checked)} />
                    <span className="flex-1">{item.label}</span>
                    {item.hint && (
                      <span id={`${headingId}-${item.id}`} className="text-ink-subtle">
                        {item.hint}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            ))}
          </div>
          <div className="flex justify-end border-t border-line px-2 pb-1 pt-2">
            <Button variant="primary" size="sm" disabled={!ticked} onClick={apply}>
              {applyLabel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
