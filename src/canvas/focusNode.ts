// A node selected from the keyboard (an arrow key, T or O) takes the focus, while the keyboard is on the canvas (see Canvas).

/** The keyboard is on the canvas (or nowhere), and not on one of the canvas's own buttons or menus. */
export function keyboardOnCanvas(active: Element | null = document.activeElement): boolean {
  if (active && active !== document.body && !active.closest('main[aria-label="Canvas"]')) return false;
  return !active?.closest('.puddle-canvas button, .puddle-canvas [role="menu"]');
}

/**
 * Focus node `id` on the canvas. A node just added can take focus only once React Flow has measured and drawn it, a
 * few frames later, so this tries again on each frame for up to a second. It gives up as soon as the keyboard has
 * gone somewhere else meanwhile, on the canvas or off it: a shortcut pressed straight after T or O (such as / for the
 * step search, or F for the canvas) must keep its focus. (In WebKit the node can take a dozen frames to draw, and
 * taking the focus back then sent the Enter meant for the step search to the node.) Returns a function that stops
 * trying.
 */
export function focusNodeWhenDrawn(
  id: string,
  frames: { request: (fn: () => void) => number; cancel: (handle: number) => void } = { request: (fn) => requestAnimationFrame(fn), cancel: (h) => cancelAnimationFrame(h) },
): () => void {
  let frame = 0;
  let tries = 0;
  const start = document.activeElement;
  const focus = () => {
    // Moved on, even on the canvas (F focuses the canvas itself): that focus stays. Dropping to the body doesn't count.
    const active = document.activeElement;
    if (active !== start && active !== document.body) return;
    if (!keyboardOnCanvas()) return;
    const el = document.querySelector<HTMLElement>(`.puddle-canvas .react-flow__node[data-id="${CSS.escape(id)}"]`);
    el?.focus();
    if (document.activeElement !== el && tries++ < 60) frame = frames.request(focus);
  };
  focus();
  return () => frames.cancel(frame);
}
