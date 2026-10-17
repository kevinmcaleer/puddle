import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MenuEntries, type MenuItem } from './Menu';
import { moveMenuFocus } from './menuGroups';

/**
 * A menu opened by a right click, at the pointer: the same items and groups as a menu button. Escape, a click outside,
 * scrolling or picking an item closes it, and focus goes back to where it was.
 */
export function ContextMenu({ x, y, label, items, onClose }: { x: number; y: number; label: string; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const [at, setAt] = useState({ left: x, top: y });
  const [returnTo] = useState(() => document.activeElement as HTMLElement | null);
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });

  // Kept inside the window: a menu opened near the right or bottom edge opens to the left or upwards.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setAt({ left: Math.max(4, Math.min(x, window.innerWidth - width - 4)), top: Math.max(4, y + height > window.innerHeight - 4 ? y - height : y) });
  }, [x, y]);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus();
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close.current();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      close.current();
      returnTo?.focus();
    };
    const onScroll = (e: Event) => !ref.current?.contains(e.target as Node) && close.current();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onScroll, true);
    window.addEventListener('blur', close.current);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onScroll, true);
      window.removeEventListener('blur', close.current);
    };
  }, [returnTo]);

  // The item runs before the menu closes, so one that opens a dialog in its place can say so first.
  const pick = (item: MenuItem) => {
    returnTo?.focus();
    item.onSelect();
    onClose();
  };

  // In a portal, so no transformed or clipping parent moves or cuts it.
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      data-testid="context-menu"
      className="ui-popover fixed z-popover py-1"
      // Visible overflow, so a submenu can open beside it.
      style={{ left: at.left, top: at.top, overflow: 'visible' }}
      onKeyDown={moveMenuFocus}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuEntries items={items} headingId={headingId} onPick={pick} />
    </div>,
    document.body,
  );
}
