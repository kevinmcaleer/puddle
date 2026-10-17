import { describe, expect, it } from 'vitest';
import { anyNodeOffscreen } from './minimap';

const size = { width: 960, height: 600 };
const flat = { x: 0, y: 0, zoom: 1 };
const node = (x: number, y: number) => ({ x, y, width: 220, height: 80 });

describe('whether the minimap is needed', () => {
  it('is not, with every node inside the canvas or with no nodes', () => {
    expect(anyNodeOffscreen([], flat, size)).toBe(false);
    expect(anyNodeOffscreen([node(40, 40), node(600, 300)], flat, size)).toBe(false);
  });

  it('is, once a node runs past any edge', () => {
    expect(anyNodeOffscreen([node(800, 40)], flat, size)).toBe(true);
    expect(anyNodeOffscreen([node(40, 560)], flat, size)).toBe(true);
    expect(anyNodeOffscreen([node(-10, 40)], flat, size)).toBe(true);
    expect(anyNodeOffscreen([node(40, -1)], flat, size)).toBe(true);
  });

  it('follows the pan and the zoom', () => {
    // Panned left by 500 px, the node at 400 is off the left edge.
    expect(anyNodeOffscreen([node(400, 40)], { x: -500, y: 0, zoom: 1 }, size)).toBe(true);
    // Zoomed to 2x around the origin, a node at 400 ends at 1240 px, past the right edge; at 0.5x it fits.
    expect(anyNodeOffscreen([node(400, 40)], { x: 0, y: 0, zoom: 2 }, size)).toBe(true);
    expect(anyNodeOffscreen([node(1200, 40)], { x: 0, y: 0, zoom: 0.5 }, size)).toBe(false);
  });

  it('is not before the canvas has a size', () => {
    expect(anyNodeOffscreen([node(5000, 5000)], flat, { width: 0, height: 0 })).toBe(false);
  });
});
