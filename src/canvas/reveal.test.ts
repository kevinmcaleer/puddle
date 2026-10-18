import { describe, expect, it } from 'vitest';
import { panToShow, revealNodeWhenDrawn, shouldFit } from './reveal';

const size = { width: 800, height: 300 };
const at = { x: 0, y: 0, zoom: 1 };

describe('panToShow', () => {
  it('leaves a node that is in view alone', () => {
    expect(panToShow({ x: 80, y: 80, width: 200, height: 76 }, at, size)).toBeNull();
  });

  it('scrolls up just enough to show a node below the bottom edge, keeping the zoom', () => {
    // The tutorial's second file: added under the first, partly below a short canvas.
    expect(panToShow({ x: 80, y: 208, width: 200, height: 76 }, at, size)).toEqual({ x: 0, y: -8, zoom: 1 });
  });

  it('scrolls down and right for a node above and left of the view', () => {
    expect(panToShow({ x: -100, y: -50, width: 200, height: 76 }, at, size)).toEqual({ x: 124, y: 74, zoom: 1 });
  });

  it('counts the zoom', () => {
    expect(panToShow({ x: 80, y: 208, width: 200, height: 76 }, { x: 0, y: 0, zoom: 0.5 }, size)).toBeNull();
    expect(panToShow({ x: 80, y: 400, width: 200, height: 76 }, { x: 0, y: 0, zoom: 2 }, size)).toEqual({ x: 0, y: -676, zoom: 2 });
  });

  it('lines up the top left of a node too big for the canvas', () => {
    expect(panToShow({ x: 80, y: 80, width: 200, height: 400 }, at, size)).toEqual({ x: 0, y: -56, zoom: 1 });
  });
});

describe('revealNodeWhenDrawn', () => {
  const frames = () => {
    const queue: Array<() => void> = [];
    return { queue, request: (fn: () => void) => queue.push(fn), cancel: () => queue.splice(0) };
  };
  const el = { clientWidth: 800, clientHeight: 300 } as HTMLElement;

  it('waits until the node is measured, then pans to it once', () => {
    const f = frames();
    let measured = {};
    const set: unknown[] = [];
    const flow = {
      getInternalNode: () => ({ internals: { positionAbsolute: { x: 80, y: 208 } }, measured }),
      getViewport: () => at,
      setViewport: (v: unknown) => set.push(v),
    };
    revealNodeWhenDrawn('n', flow, () => el, f);
    expect(set).toEqual([]);
    measured = { width: 200, height: 76 };
    f.queue.shift()!();
    expect(set).toEqual([{ x: 0, y: -8, zoom: 1 }]);
    expect(f.queue).toHaveLength(0);
  });

  it('does nothing once cancelled', () => {
    const f = frames();
    const flow = { getInternalNode: () => undefined, getViewport: () => at, setViewport: () => expect.unreachable() };
    const cancel = revealNodeWhenDrawn('n', flow, () => el, f);
    cancel();
    expect(f.queue).toHaveLength(0);
  });
});

describe('shouldFit', () => {
  // The taxi tutorial: two files stacked down a canvas only 291 pixels tall.
  const tutorial = [
    { x: 80, y: 80, width: 232, height: 76 },
    { x: 80, y: 280, width: 232, height: 76 },
  ];
  const short = { width: 800, height: 291 };

  it('fits a project opened at the untouched viewport with a node off screen', () => {
    expect(shouldFit(at, null, tutorial, short)).toBe(true);
  });

  it('leaves it when everything is already in view', () => {
    expect(shouldFit(at, null, tutorial, { width: 800, height: 600 })).toBe(false);
  });

  it('fits again while the viewport is still its own fit, as the nodes grow', () => {
    const fit = { x: 100, y: 10, zoom: 0.9 };
    expect(shouldFit(fit, fit, tutorial, short)).toBe(true);
  });

  it('never moves a viewport the person set', () => {
    expect(shouldFit({ x: 0, y: -40, zoom: 1 }, null, tutorial, short)).toBe(false);
    expect(shouldFit({ x: 0, y: -40, zoom: 1 }, { x: 100, y: 10, zoom: 0.9 }, tutorial, short)).toBe(false);
  });

  it('waits for nodes and a canvas with a size', () => {
    expect(shouldFit(at, null, [], short)).toBe(false);
    expect(shouldFit(at, null, tutorial, { width: 0, height: 0 })).toBe(false);
  });
});
