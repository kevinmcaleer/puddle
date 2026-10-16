// Sample mode and Stop on real DuckDB-WASM (Node build): sampled previews, full-data exports and gates, and
// stopping a slow query without breaking the engine.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileCount, sourceFileName } from '../../src/compiler';
import { EngineClient, tableRows } from '../../src/engine/client';
import { isStopped } from '../../src/engine/errors';
import { exportGateFor, runExport, type Delivery } from '../../src/export/run';
import { evaluateRules, useRuleStore } from '../../src/flow/rules';
import { applySample, countSources, currentSample, setFullData, useSampleStore } from '../../src/flow/sample';
import { evaluateFlow, invalidateCaches, useFlowStore } from '../../src/flow/status';
import type { Project, Rule } from '../../src/model';
import { createNodeBackend } from '../helpers/nodeBackend';
import { flow, src } from '../helpers/projects';

const cust = src({ id: 'cust', format: 'csv' });
const cust2 = src({ id: 'cust2', format: 'csv' });
// Row 3 has no email: a sample of the first two rows passes, the full data fails.
const emailRule: Rule = { id: 'email', type: 'notEmpty', label: 'email is never empty', enabled: true, severity: 'fail', params: { column: 'email' } };

let release: (() => void) | null = null;
let engine: EngineClient;
beforeAll(async () => {
  // Queries marked "slow" wait until released, so a test can press Stop while one is running.
  engine = new EngineClient(
    await createNodeBackend({
      beforeQuery: (sql) => (sql.includes('/* slow */') ? new Promise<void>((r) => (release = r)) : Promise.resolve()),
    }),
  );
  for (const s of [cust, cust2]) await engine.registerBuffer(sourceFileName(s), new Uint8Array(readFileSync(join(__dirname, '../fixtures', 'customers.csv'))));
});
afterAll(() => engine.close());
beforeEach(() => {
  invalidateCaches();
  useSampleStore.setState({ counts: {}, full: false });
  useRuleStore.setState({ nodes: {} });
});

const project = (threshold: number): Project => {
  const p = flow({ sources: [cust], nodes: [{ id: 'in', type: 'source', sourceId: cust.id }, { id: 'out', type: 'output' }], wires: [['in', 'out']] });
  return { ...p, settings: { ...p.settings, sampleThresholdRows: threshold }, nodes: p.nodes.map((n) => (n.id === 'out' ? { ...n, name: 'Customers', rules: [emailRule] } : n)) };
};
const count = async (p: Project) => Number(tableRows((await engine.query(compileCount(p, { nodeId: 'out' }))).table)[0]!.n);

describe('sample mode', () => {
  it('switches on above the threshold: previews and rules read the sample, Run on full data reads everything', async () => {
    const p = project(2);
    await countSources(engine, p);
    expect(useSampleStore.getState().counts.cust?.rows).toBe(4);
    const sample = currentSample(p);
    expect(sample).toEqual({ rows: 2, sources: { cust: 4 } });
    const view = applySample(p, sample);
    expect(await count(view)).toBe(2);

    await evaluateFlow(engine, view);
    expect(useFlowStore.getState().nodes.out?.status.state).toBe('ok');
    await evaluateRules(engine, view);
    expect(useRuleStore.getState().nodes.out?.results.email).toEqual({ state: 'ok', failures: 0, total: 2 });

    setFullData(true);
    expect(currentSample(p)).toBeNull();
    expect(await count(applySample(p, currentSample(p)))).toBe(4);
  });

  it('stays off at or below the threshold', async () => {
    const p = project(4);
    await countSources(engine, p);
    expect(currentSample(p)).toBeNull();
  });

  it('checks rules on the full data before an export, and exports every row', async () => {
    const p = project(2);
    await countSources(engine, p);
    const sample = currentSample(p);
    await evaluateFlow(engine, applySample(p, sample));
    await evaluateRules(engine, applySample(p, sample));
    // The sample passes, but the full data doesn't, and that is what the gate goes by.
    const gate = await exportGateFor(engine, p, 'out', sample);
    expect(gate).toMatchObject({ state: 'blocked', blocking: [{ label: 'email is never empty', failures: 1 }] });
    const delivered: number[] = [];
    const deliver: Delivery = async (blob) => void delivered.push(blob.size);
    const entry = await runExport(engine, applySample(p, sample), 'out', { gate, override: true, deliver });
    expect(entry.rows).toBe(4);
  });
});

describe('sample mode with a Join', () => {
  it('exports every joined row even though the flow only described the sample', async () => {
    const base = flow({
      sources: [cust, cust2],
      nodes: [
        { id: 'a', type: 'source', sourceId: cust.id },
        { id: 'b', type: 'source', sourceId: cust2.id },
        { id: 'j', type: 'join', joinSpec: { kind: 'inner', keys: [{ left: 'id', right: 'id' }] } },
        { id: 'out', type: 'output' },
      ],
      wires: [['a', 'j', 'left'], ['b', 'j', 'right'], ['j', 'out']],
    });
    const p = { ...base, settings: { ...base.settings, sampleThresholdRows: 2 } };
    await countSources(engine, p);
    const sample = currentSample(p);
    expect(sample?.sources).toEqual({ cust: 4, cust2: 4 });
    await evaluateFlow(engine, applySample(p, sample));
    expect(useFlowStore.getState().nodes.out?.status.state).toBe('ok');
    const gate = await exportGateFor(engine, p, 'out', sample);
    const entry = await runExport(engine, p, 'out', { gate, deliver: async () => undefined });
    expect(entry.rows).toBe(4);
  });
});

describe('Stop', () => {
  it('stops a slow query, says so, and the engine carries on', async () => {
    const slow = engine.query('SELECT /* slow */ count(*) AS n FROM range(1000)', { label: 'Slow test' });
    const queued = engine.query('SELECT 1 AS one', { priority: 'background' });
    await new Promise((r) => setTimeout(r, 20));
    expect(engine.activity).toMatchObject({ label: 'Slow test' });
    expect(engine.stop()).toBe(2);
    release?.();
    await expect(slow).rejects.toSatisfy(isStopped);
    await expect(queued).rejects.toSatisfy(isStopped);
    expect(engine.activity).toBeNull();
    expect(tableRows((await engine.query('SELECT 2 AS two')).table)).toEqual([{ two: 2 }]);
  });

  it('a stopped export delivers nothing', async () => {
    const p = project(100);
    const delivered: number[] = [];
    const deliver: Delivery = async (blob) => void delivered.push(blob.size);
    // Stop the export while its COPY waits in the queue behind a slow query.
    const blocker = engine.query('SELECT /* slow */ 1');
    const exporting = runExport(engine, p, 'out', { gate: { state: 'clear' }, deliver });
    await new Promise((r) => setTimeout(r, 20));
    engine.stop();
    release?.();
    await expect(blocker).rejects.toSatisfy(isStopped);
    await expect(exporting).rejects.toSatisfy(isStopped);
    expect(delivered).toEqual([]);
  });
});
