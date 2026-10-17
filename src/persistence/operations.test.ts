import { createOperations } from './operations';

describe('stored operations history', () => {
  const counter = () => {
    const log: string[] = [];
    let n = 0;
    const op = (label: string) => ({ label, undo: async () => void log.push(`undo ${label}`, String(--n)), redo: async () => void log.push(`redo ${label}`, String(++n)) });
    return { log, op, value: () => n, bump: () => ++n };
  };

  it('undoes and redoes operations in order, newest first', async () => {
    const ops = createOperations();
    const c = counter();
    c.bump();
    ops.record(c.op('First'));
    c.bump();
    ops.record(c.op('Second'));
    expect(await ops.undo()).toBe(true);
    expect(await ops.undo()).toBe(true);
    expect(await ops.undo()).toBe(false);
    expect(c.value()).toBe(0);
    expect(await ops.redo()).toBe(true);
    expect(ops.use.getState().past.map((o) => o.label)).toEqual(['First']);
    expect(ops.use.getState().future.map((o) => o.label)).toEqual(['Second']);
    expect(c.log).toEqual(['undo Second', '1', 'undo First', '0', 'redo First', '1']);
  });

  it('a new operation clears what could be redone, and the history keeps only the latest steps', async () => {
    const ops = createOperations(2);
    const c = counter();
    for (const label of ['A', 'B', 'C']) ops.record(c.op(label));
    expect(ops.use.getState().past.map((o) => o.label)).toEqual(['B', 'C']);
    await ops.undo();
    ops.record(c.op('D'));
    expect(ops.use.getState().future).toEqual([]);
  });

  it('runs one step at a time, so two quick undos undo two operations', async () => {
    const ops = createOperations();
    const c = counter();
    ops.record(c.op('A'));
    ops.record(c.op('B'));
    const both = [ops.undo(), ops.undo()];
    expect(await Promise.all(both)).toEqual([true, true]);
    expect(c.log).toEqual(['undo B', '-1', 'undo A', '-2']);
    expect(ops.use.getState().busy).toBe(false);
  });

  it('drops an operation that can no longer be undone, and carries on', async () => {
    const ops = createOperations();
    const c = counter();
    ops.record(c.op('A'));
    ops.record({ label: 'Broken', undo: () => Promise.reject(new Error('gone')), redo: () => Promise.resolve() });
    await expect(ops.undo()).rejects.toThrow('gone');
    expect(ops.use.getState().past.map((o) => o.label)).toEqual(['A']);
    expect(await ops.undo()).toBe(true);
  });
});
