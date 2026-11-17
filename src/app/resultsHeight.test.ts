import { describe, expect, it } from 'vitest';
import { RESULTS_DEFAULT, RESULTS_MIN, resultsHeight, SMALL_FLOW } from './resultsHeight';

describe('how the window is split between the canvas and the results', () => {
  it('gives the data most of the window while the flow is small', () => {
    for (const nodes of [1, 2, SMALL_FLOW]) {
      const h = resultsHeight({ nodes, dragged: null, windowHeight: 900 });
      expect(h).toBe(500);
      expect(h).toBeGreaterThan(900 / 2);
      // The canvas keeps a third of what the toolbar, tabs and status strip leave.
      expect(900 - 150 - h).toBe(250);
    }
  });

  it('leaves a small window’s canvas room for a row of nodes', () => {
    expect(720 - 150 - resultsHeight({ nodes: 1, dragged: null, windowHeight: 720 })).toBe(220);
    expect(resultsHeight({ nodes: 1, dragged: null, windowHeight: 400 })).toBe(120);
  });

  it('shares the window as before once the flow has grown', () => {
    expect(resultsHeight({ nodes: SMALL_FLOW + 1, dragged: null, windowHeight: 900 })).toBe(RESULTS_DEFAULT);
    expect(resultsHeight({ nodes: 40, dragged: null, windowHeight: 900 })).toBe(RESULTS_DEFAULT);
  });

  it('shows only the message on an empty project', () => {
    expect(resultsHeight({ nodes: 0, dragged: null, windowHeight: 900 })).toBe(RESULTS_MIN);
  });

  it('keeps a divider the user has dragged, whatever the flow', () => {
    for (const nodes of [0, 1, 3, 12]) expect(resultsHeight({ nodes, dragged: 333, windowHeight: 900 })).toBe(333);
  });

  it('never takes the whole window, nor shrinks to nothing', () => {
    expect(resultsHeight({ nodes: 1, dragged: 5000, windowHeight: 900 })).toBe(675);
    expect(resultsHeight({ nodes: 1, dragged: 10, windowHeight: 900 })).toBe(RESULTS_MIN);
    expect(resultsHeight({ nodes: 9, dragged: null, windowHeight: 300 })).toBe(225);
  });
});
