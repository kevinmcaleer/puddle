import { describe, expect, it } from 'vitest';
import { isSmallFlow, RESULTS_DEFAULT, RESULTS_MIN, resultsHeight } from './resultsHeight';

describe('how the window is split between the canvas and the results', () => {
  it('gives the data most of the window while the flow is small', () => {
    const h = resultsHeight({ flow: 'small', dragged: null, windowHeight: 900 });
    expect(h).toBe(500);
    expect(h).toBeGreaterThan(900 / 2);
    // The canvas keeps a third of what the toolbar, tabs and status strip leave.
    expect(900 - 150 - h).toBe(250);
  });

  it('leaves a small window’s canvas room for a row of nodes', () => {
    expect(720 - 150 - resultsHeight({ flow: 'small', dragged: null, windowHeight: 720 })).toBe(220);
    expect(resultsHeight({ flow: 'small', dragged: null, windowHeight: 400 })).toBe(120);
  });

  it('shares the window as before once the flow has grown', () => {
    expect(resultsHeight({ flow: 'grown', dragged: null, windowHeight: 900 })).toBe(RESULTS_DEFAULT);
  });

  it('shows only the message on an empty project', () => {
    expect(resultsHeight({ flow: 'empty', dragged: null, windowHeight: 900 })).toBe(RESULTS_MIN);
  });

  it('keeps a divider the user has dragged, whatever the flow', () => {
    for (const flow of ['empty', 'small', 'grown'] as const) expect(resultsHeight({ flow, dragged: 333, windowHeight: 900 })).toBe(333);
  });

  it('never takes the whole window, nor shrinks to nothing', () => {
    expect(resultsHeight({ flow: 'small', dragged: 5000, windowHeight: 900 })).toBe(675);
    expect(resultsHeight({ flow: 'small', dragged: 10, windowHeight: 900 })).toBe(RESULTS_MIN);
    expect(resultsHeight({ flow: 'grown', dragged: null, windowHeight: 300 })).toBe(225);
  });

  it('counts a flow as small while it is a few nodes in one row', () => {
    const at = (...ys: number[]) => ys.map((y) => ({ position: { y } }));
    expect(isSmallFlow(at(80))).toBe(true);
    expect(isSmallFlow(at(80, 80, 96))).toBe(true);
    // Regression: two sources one under the other, and the node that combines them, were squeezed into a third of
    // the window, where the minimap covered them.
    expect(isSmallFlow(at(80, 208))).toBe(false);
    expect(isSmallFlow(at(80, 208, 144))).toBe(false);
    expect(isSmallFlow(at(80, 80, 80, 80))).toBe(false);
    expect(isSmallFlow([])).toBe(false);
  });
});
