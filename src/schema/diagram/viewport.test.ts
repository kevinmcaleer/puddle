import { describe, expect, it } from 'vitest';
import { centreOn, fitView, MAX_ZOOM, MIN_ZOOM, START, toDiagram, zoomAt } from './viewport';

describe('the diagram viewport', () => {
  it('keeps the point under the pointer still while zooming', () => {
    const before = { x: 30, y: -20, k: 1 };
    const under = toDiagram(before, 200, 150);
    const after = zoomAt(before, 1.5, 200, 150);
    expect(toDiagram(after, 200, 150).x).toBeCloseTo(under.x);
    expect(toDiagram(after, 200, 150).y).toBeCloseTo(under.y);
  });

  it('zooms between 20% and 200%', () => {
    expect(zoomAt(START, 10, 0, 0).k).toBe(MAX_ZOOM);
    expect(zoomAt(START, 0.01, 0, 0).k).toBe(MIN_ZOOM);
  });

  it('fits a large drawing in the pane, centred', () => {
    const v = fitView({ x: 0, y: 0, w: 2000, h: 500 }, 1000, 800);
    expect(v.k).toBe(0.5);
    expect(v.x).toBe(0);
    expect(v.y).toBe((800 - 250) / 2);
  });

  it('never fits beyond 100%', () => {
    expect(fitView({ x: 10, y: 10, w: 100, h: 100 }, 1000, 800).k).toBe(1);
    expect(fitView({ x: 0, y: 0, w: 0, h: 0 }, 1000, 800)).toEqual(START);
  });

  it('centres a table at the current zoom', () => {
    const v = centreOn({ x: 0, y: 0, k: 2 }, { x: 100, y: 100, w: 50, h: 50 }, 800, 600);
    expect(toDiagram(v, 400, 300)).toEqual({ x: 125, y: 125 });
    expect(v.k).toBe(2);
  });
});
