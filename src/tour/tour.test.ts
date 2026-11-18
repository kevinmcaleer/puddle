import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProject, type Project } from '../model';
import { fixesRecorded, placePopover, stepCount, TOUR_STOPS, type TourContext } from './stops';
import { canResume, readProgress, shouldOffer, writeProgress } from './tour';

/** An in-memory stand-in for localStorage, optionally one that refuses every call (a blocked private window). */
function memory(blocked = false) {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => {
      if (blocked) throw new Error('SecurityError');
      return data.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (blocked) throw new Error('SecurityError');
      data.set(k, v);
    },
  };
}

describe('tour progress', () => {
  it('starts fresh, offered on first launch', () => {
    const p = readProgress(memory());
    expect(p).toEqual({ offered: false, stop: 0, finished: false });
    expect(shouldOffer(p)).toBe(true);
    expect(canResume(p)).toBe(false);
  });

  it('remembers the offer was answered and how far the tour got', () => {
    const s = memory();
    writeProgress({ offered: true }, s);
    writeProgress({ stop: 3 }, s);
    const p = readProgress(s);
    expect(p).toEqual({ offered: true, stop: 3, finished: false });
    expect(shouldOffer(p)).toBe(false);
    expect(canResume(p)).toBe(true);
  });

  it('isn’t offered or resumed once finished', () => {
    const s = memory();
    writeProgress({ finished: true, stop: 0 }, s);
    expect(shouldOffer(readProgress(s))).toBe(false);
    expect(canResume(readProgress(s))).toBe(false);
  });

  it('reads damaged or out-of-range progress as fresh, or within the tour', () => {
    const s = memory();
    s.data.set('puddle.tour', '{not json');
    expect(readProgress(s)).toEqual({ offered: false, stop: 0, finished: false });
    s.data.set('puddle.tour', JSON.stringify({ offered: 'yes', stop: 99 }));
    expect(readProgress(s)).toEqual({ offered: false, stop: TOUR_STOPS.length - 1, finished: false });
    s.data.set('puddle.tour', JSON.stringify({ stop: -2.5 }));
    expect(readProgress(s).stop).toBe(0);
  });

  it('works without storage: nothing throws and the tour is offered', () => {
    const s = memory(true);
    expect(() => writeProgress({ offered: true }, s)).not.toThrow();
    expect(readProgress(s)).toEqual({ offered: false, stop: 0, finished: false });
    expect(readProgress(undefined)).toEqual({ offered: false, stop: 0, finished: false });
  });
});

const withSteps = (project: Project, n: number): Project => ({
  ...project,
  nodes: [{ id: 't1', name: 'Transform 1', type: 'transform', position: { x: 0, y: 0 }, rules: [], steps: Array.from({ length: n }, (_, i) => ({ id: `st${i}`, type: 'trim', label: 'Trimmed', enabled: true, params: {} })) } as Project['nodes'][number]],
});

describe('tour stops', () => {
  const stop = (id: string) => TOUR_STOPS.find((s) => s.id === id)!;
  const ctx = (c: Partial<TourContext>): TourContext => ({ project: createProject('p'), selectedColumns: [], ...c });

  it('follows the loop of a first visit: what was found, Fix all, the receipt, Export, and only then how it works', () => {
    expect(TOUR_STOPS.map((s) => s.id)).toEqual(['found', 'fixall', 'receipt', 'export', 'canvas', 'steps', 'rules']);
    for (const s of TOUR_STOPS) {
      expect(s.title).not.toBe('');
      expect(s.body.length).toBeGreaterThan(20);
    }
  });

  it('points every stop at something the app draws', () => {
    // Every component's source, to look the anchors up in: a renamed test id or label would leave a stop pointing at nothing.
    const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : /\.tsx$/.test(e.name) && !/\.test\./.test(e.name) ? [readFileSync(join(dir, e.name), 'utf8')] : []));
    const app = sources('src').join('\n');
    const base = createProject('p');
    const project: Project = {
      ...base,
      nodes: [
        { id: 'n1', name: 'contacts.csv', type: 'source', sourceId: 's1', position: { x: 0, y: 0 }, rules: [] },
        { id: 'n2', name: 'Output 1', type: 'output', position: { x: 0, y: 0 }, rules: [] },
      ] as Project['nodes'],
    };
    for (const s of TOUR_STOPS) {
      const anchors = s.anchors(ctx({ project }));
      expect(anchors.length, s.id).toBeGreaterThan(0);
      for (const anchor of anchors) {
        const id = /^\[data-testid="(.+)"\]$/.exec(anchor)?.[1];
        const tour = /^\[data-tour="(.+)"\]$/.exec(anchor)?.[1];
        const section = /^section\[aria-label="(.+)"\]$/.exec(anchor)?.[1];
        if (id?.startsWith('node-')) expect(app, anchor).toContain('data-testid={`node-${node.name}`}');
        else if (id) expect(app.includes(`data-testid="${id}"`) || app.includes(`testId="${id}"`), anchor).toBe(true);
        else if (tour) expect(app, anchor).toContain(`'data-tour': '${tour}'`);
        else if (section) expect(app.includes(`title="${section}"`) || app.includes(`aria-label="${section}"`), anchor).toBe(true);
        else throw new Error(`${s.id}: an anchor this test can’t look up: ${anchor}`);
      }
    }
  });

  it('waits for Fix all on its stop: a step added, or an issue fixed by a read option', () => {
    const done = stop('fixall').done!;
    const base = createProject('p');
    expect(stepCount(withSteps(base, 2))).toBe(2);
    expect(done(ctx({ project: base }), ctx({ project: base }))).toBe(false);
    expect(done(ctx({ project: withSteps(base, 1) }), ctx({ project: base }))).toBe(true);
    expect(done(ctx({ project: withSteps(base, 1) }), ctx({ project: withSteps(base, 1) }))).toBe(false);
    const source = { id: 'n1', name: 'contacts.csv', type: 'source', sourceId: 's1', position: { x: 0, y: 0 }, rules: [] } as Project['nodes'][number];
    const read: Project = { ...base, nodes: [{ ...source, analysis: { at: '2026-11-18T09:00:00.000Z', rows: 5, issues: [{ key: 'bannerRows', kind: 'bannerRows', label: 'Lines above the table', count: 2, fixed: true, fixedByRead: true }] } }] as Project['nodes'] };
    expect(fixesRecorded(read)).toBe(1);
    expect(done(ctx({ project: read }), ctx({ project: { ...base, nodes: [source] } }))).toBe(true);
  });

  it('points the first stop at what was found, and the export stop at the receipt’s foot, then an Output, then Add', () => {
    const base = createProject('p');
    const project: Project = { ...base, nodes: [{ id: 'n1', name: 'contacts.csv', type: 'source', sourceId: 's1', position: { x: 0, y: 0 }, rules: [] } as Project['nodes'][number]] };
    expect(stop('found').anchors(ctx({ project }))[0]).toBe('[data-testid="findings-headline"]');
    expect(stop('export').anchors(ctx({ project }))).toEqual(['[data-testid="receipt-foot"]', '[data-tour="add-node"]']);
  });
});

describe('placing the popover', () => {
  const pop = { width: 320, height: 200 };
  const view = { width: 1280, height: 800 };

  it('goes below a target with room under it, centred on it', () => {
    expect(placePopover({ top: 100, left: 400, width: 200, height: 40 }, pop, view, 8)).toEqual({ top: 148, left: 340, side: 'below' });
  });

  it('goes above a target near the bottom', () => {
    expect(placePopover({ top: 700, left: 400, width: 200, height: 40 }, pop, view, 8)).toEqual({ top: 492, left: 340, side: 'above' });
  });

  it('goes beside a tall target, and inside one too big for any side', () => {
    expect(placePopover({ top: 50, left: 0, width: 600, height: 700 }, pop, view, 8)).toEqual({ top: 300, left: 608, side: 'right' });
    expect(placePopover({ top: 50, left: 900, width: 380, height: 700 }, pop, view, 8)).toEqual({ top: 300, left: 572, side: 'left' });
    expect(placePopover({ top: 0, left: 0, width: 1280, height: 800 }, pop, view, 8)).toEqual({ top: 592, left: 480, side: 'centre' });
  });

  it('stays on screen at the edges, and sits in the middle with no target', () => {
    expect(placePopover({ top: 10, left: 1250, width: 20, height: 20 }, pop, view, 8).left).toBe(1280 - 320 - 8);
    expect(placePopover({ top: 10, left: 0, width: 20, height: 20 }, pop, view, 8).left).toBe(8);
    expect(placePopover(null, pop, view, 8)).toEqual({ top: 300, left: 480, side: 'centre' });
  });
});
