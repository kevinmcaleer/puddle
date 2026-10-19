import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Button, type ButtonProps } from './Button';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';
import { groupItems, moveMenuFocus } from './menuGroups';

export interface MenuItem {
  label: string;
  icon?: IconName;
  hint?: string;
  /** The item's keyboard shortcut, e.g. "T", shown in mono at the right. */
  shortcut?: string;
  disabled?: boolean;
  /** Items with the same group sit together under its heading; items without one come first, ungrouped. */
  group?: string;
  /** A choice among the items of its group (a radio item): the one that is on shows a tick. */
  checked?: boolean;
  /** With `checked`, an on-or-off setting (a checkbox item) rather than a choice among its group. */
  toggle?: boolean;
  /** A submenu: the item opens these beside it (on hover, a click or the right arrow) instead of running onSelect. */
  items?: MenuItem[];
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
  scroll,
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
  /** A long menu: its items scroll within the window's height instead of running off the screen. */
  scroll?: boolean;
  /** Open or closed from outside (e.g. a keyboard shortcut opens it); `onOpenChange` hears every change. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const headingId = useId();
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlled === undefined) setOwn(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const trigger = () => ref.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]');
  const menuItems = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape from inside the menu goes back to its button, as a menu button should.
      const inside = ref.current?.contains(document.activeElement);
      setOpen(false);
      if (inside) trigger()?.focus();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  // The search starts empty each time the menu opens. Only closing clears it: the effect above also runs again when
  // the parent passes a new onOpenChange, and clearing there threw away what was being typed.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) setQuery('');
  }

  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((i) => `${i.label} ${i.hint ?? ''} ${i.group ?? ''}`.toLowerCase().includes(q)) : items;
  const pick = (item: MenuItem) => {
    setOpen(false);
    // Focus goes back to the menu's button before the item runs, so a dialog the item opens returns focus there.
    trigger()?.focus();
    item.onSelect();
  };

  // Opened, a menu without a search field puts focus on its first item; the arrow keys, Home and End move between them.
  useEffect(() => {
    if (open && !search) menuItems()[0]?.focus();
  }, [open, search]);
  const moveFocus = (e: ReactKeyboardEvent<HTMLElement>) => moveMenuFocus(e);

  return (
    <div className={cx('relative', className)} ref={ref}>
      {renderTrigger ? (
        renderTrigger({ 'aria-haspopup': 'menu', 'aria-expanded': open, onClick: () => setOpen(!open) })
      ) : (
        <Button
          {...(button as ButtonProps)}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' || open) return;
            e.preventDefault();
            setOpen(true);
          }}
        >
          {button?.iconOnly && typeof label === 'string' ? <span className="sr-only">{label}</span> : label}
          {!button?.iconOnly && <Icon name="chevron-down" size={14} />}
        </Button>
      )}
      {open && (
        // The search field sits above the menu, not in it: a menu may hold only its items.
        <div className={`ui-popover absolute top-full z-popover mt-1 py-1 ${align === 'end' ? 'right-0' : 'left-0'}`} style={items.some((i) => i.items) ? { overflow: 'visible' } : undefined} onKeyDown={moveFocus}>
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
          <div role="menu" aria-label={typeof label === 'string' ? label : undefined} className={scroll ? 'max-h-[60vh] overflow-y-auto' : undefined}>
            <MenuEntries items={shown} headingId={headingId} onPick={pick} />
          </div>
        </div>
      )}
    </div>
  );
}

/** A menu's items, gathered under their group headings. Shared by the menu button and the context menu. */
export function MenuEntries({ items, headingId, onPick: pick }: { items: MenuItem[]; headingId: string; onPick: (item: MenuItem) => void }) {
  return (
    <>
      {groupItems(items).map(({ group, items: members }, g) => {
        const buttons = members.map((item) =>
          item.items ? (
            <Submenu key={item.label} item={item} onPick={pick} />
          ) : (
            <button
              key={item.label}
              type="button"
              role={item.checked === undefined ? 'menuitem' : item.toggle ? 'menuitemcheckbox' : 'menuitemradio'}
              aria-checked={item.checked}
              disabled={item.disabled}
              className={ITEM_CLASS}
              onClick={() => pick(item)}
            >
              {item.icon && <Icon name={item.icon} size={14} />}
              <span className="flex-1">{item.label}</span>
              {item.hint && <span className="text-ink-subtle">{item.hint}</span>}
              {item.shortcut && <kbd className="font-mono text-label text-ink-subtle">{item.shortcut}</kbd>}
              {item.checked && <Icon name="check" size={14} />}
            </button>
          ),
        );
        if (!group) return buttons;
        const id = `${headingId}-${g}`;
        return (
          <div key={group} role="group" aria-labelledby={id} className={g > 0 ? 'mt-1 border-t border-line pt-1' : undefined}>
            <div id={id} className="ui-eyebrow px-3 pb-1 pt-2">
              {group}
            </div>
            {buttons}
          </div>
        );
      })}
    </>
  );
}

const ITEM_CLASS = 'flex w-full items-center gap-2 px-3 py-1 text-left text-body text-ink hover:bg-surface-hover disabled:cursor-not-allowed disabled:text-ink-subtle';

/**
 * An item that opens a submenu beside it, to the right unless the window is too narrow there. The right arrow opens it
 * and focuses its first item; the left arrow goes back.
 */
function Submenu({ item, onPick }: { item: MenuItem; onPick: (item: MenuItem) => void }) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<{ left: boolean; up: number }>({ left: false, up: 0 });
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const focusFirst = useRef(false);

  useLayoutEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    const at = button.current!.getBoundingClientRect();
    const { width, height } = el.getBoundingClientRect();
    setSide({ left: at.right + width > window.innerWidth - 4, up: Math.max(0, at.top + height - (window.innerHeight - 4)) });
    if (focusFirst.current) el.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus();
    focusFirst.current = false;
  }, [open]);

  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        ref={button}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={item.disabled}
        className={ITEM_CLASS}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          focusFirst.current = true;
          setOpen(true);
          if (open) panel.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus();
        }}
      >
        {item.icon && <Icon name={item.icon} size={14} />}
        <span className="flex-1">{item.label}</span>
        <Icon name="chevron-right" size={14} />
      </button>
      {open && (
        <div
          ref={panel}
          role="menu"
          aria-label={item.label}
          className={cx('ui-popover absolute z-popover -mt-1 py-1', side.left ? 'right-full' : 'left-full')}
          style={{ top: -side.up }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              setOpen(false);
              button.current?.focus();
            } else moveMenuFocus(e);
          }}
        >
          <MenuEntries items={item.items!} headingId={headingId} onPick={onPick} />
        </div>
      )}
    </div>
  );
}
