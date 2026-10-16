import { flow, src, step } from '../../tests/helpers/projects';
import { setKeepResult, type Project } from '../model';
import { compile, compileCount, compileJoinCheck, upstreamKey } from './compile';
import { compileExport } from './export';
import { KeptBook, keptTable, keptTableName, knownKept } from './keptBook';
import { SchemaBook } from './schemaBook';

const chain = (steps = [step('s1', 'trimWhitespace', { columns: ['name'] })]) =>
  flow({
    sources: [src({ id: 'cust', format: 'csv' })],
    nodes: [
      { id: 'src', type: 'source', sourceId: 'cust' },
      { id: 'clean', type: 'transform', steps },
      { id: 'more', type: 'transform', steps: [step('s2', 'changeCase', { columns: ['name'], mode: 'upper' })] },
      { id: 'out', type: 'output' },
    ],
    wires: [['src', 'clean'], ['clean', 'more'], ['more', 'out']],
  });

/** A book holding `nodeId`'s table, built for the project as it is now. */
const keptFor = (p: Project, ...ids: string[]) => {
  const book = new KeptBook();
  for (const id of ids) book.set(id, { key: upstreamKey(p, { nodeId: id }), table: keptTableName(id) });
  return book;
};

describe('kept results in the compiler', () => {
  it('names and quotes a node’s table', () => {
    expect(keptTableName('n1')).toBe('kept_n1');
    expect(keptTable('a"b')).toBe('"kept_a""b"');
  });

  it('reads downstream nodes from a kept table instead of compiling upstream', () => {
    const p = setKeepResult(chain(), 'clean', true);
    const { sql, nodeIds } = compile(p, { nodeId: 'out' }, { kept: keptFor(p, 'clean') });
    expect(sql).not.toContain('read_csv');
    expect(sql).not.toContain('trim');
    expect(sql).toContain('FROM "kept_clean"');
    expect(nodeIds).toEqual(['clean', 'more', 'out']);
    expect(sql).toMatchSnapshot();
  });

  it('reads the kept node itself from its table, but compiles it for a rebuild or a step preview', () => {
    const p = setKeepResult(chain(), 'clean', true);
    const kept = keptFor(p, 'clean');
    expect(compile(p, { nodeId: 'clean' }, { kept }).sql).toBe('SELECT * FROM "kept_clean"');
    expect(compile(p, { nodeId: 'clean' }, { kept, rebuild: true }).sql).toBe(compile(p, { nodeId: 'clean' }).sql);
    expect(compile(p, { nodeId: 'clean', stepIndex: 0 }, { kept }).sql).toContain('read_csv');
  });

  it('is read by every compile through the app’s book, exports included, while the table is current', () => {
    const p = setKeepResult(chain(), 'clean', true);
    knownKept.set('clean', { key: upstreamKey(p, { nodeId: 'clean' }), table: keptTableName('clean') });
    try {
      expect(compileCount(p, { nodeId: 'more' })).toContain('"kept_clean"');
      expect(compileExport(p, 'out', '/out.csv')).toContain('"kept_clean"');
      expect(compileExport(p, 'out', '/out.csv')).not.toContain('read_csv');
      knownKept.set('clean', { key: 'stale', table: keptTableName('clean') });
      expect(compileExport(p, 'out', '/out.csv')).toContain('read_csv');
    } finally {
      knownKept.clear();
    }
  });

  it('ignores a table built for a different upstream, or a node no longer kept', () => {
    const p = setKeepResult(chain(), 'clean', true);
    const kept = keptFor(p, 'clean');
    const changed = setKeepResult(chain([step('s1', 'trimWhitespace', { columns: ['email'] })]), 'clean', true);
    expect(compile(changed, { nodeId: 'out' }, { kept }).sql).toBe(compile(changed, { nodeId: 'out' }).sql);
    const unkept = setKeepResult(p, 'clean', false);
    expect(compile(unkept, { nodeId: 'out' }, { kept }).sql).toContain('read_csv');
  });

  it('stops at the nearest kept node when several are kept', () => {
    const p = setKeepResult(setKeepResult(chain(), 'clean', true), 'more', true);
    const sql = compile(p, { nodeId: 'out' }, { kept: keptFor(p, 'clean', 'more') }).sql;
    expect(sql).toBe('SELECT * FROM "kept_more"');
    // Rebuilding the downstream one reads the upstream one's table.
    const rebuild = compile(p, { nodeId: 'more' }, { kept: keptFor(p, 'clean', 'more'), rebuild: true }).sql;
    expect(rebuild).toContain('FROM "kept_clean"');
    expect(rebuild).not.toContain('read_csv');
  });

  it('reads a Join’s kept inputs, and checks a kept Join by compiling it', () => {
    const p0 = flow({
      sources: [src({ id: 'orders', format: 'csv' }), src({ id: 'customers', format: 'csv' })],
      nodes: [
        { id: 'o', type: 'source', sourceId: 'orders' },
        { id: 'c', type: 'source', sourceId: 'customers' },
        { id: 'j', type: 'join', joinSpec: { kind: 'left', keys: [{ left: 'customer_id', right: 'customer_id' }], suffix: '_right' } },
        { id: 'out', type: 'output' },
      ],
      wires: [['o', 'j', 'left'], ['c', 'j', 'right'], ['j', 'out']],
    });
    const p = setKeepResult(setKeepResult(p0, 'c', true), 'j', true);
    const schemas = new SchemaBook();
    schemas.set(upstreamKey(p, { nodeId: 'o' }), [{ name: 'customer_id', type: 'BIGINT' }]);
    schemas.set(upstreamKey(p, { nodeId: 'c' }), [{ name: 'customer_id', type: 'BIGINT' }, { name: 'name', type: 'VARCHAR' }]);
    const join = compile(p, { nodeId: 'j' }, { schemas, kept: keptFor(p, 'c') }).sql;
    expect(join).toContain('"kept_c"');
    expect(join).not.toContain('customers');
    const check = compileJoinCheck(p, 'j', { schemas, kept: keptFor(p, 'c', 'j') });
    expect(check).not.toContain('"kept_j"');
    expect(check).toContain('"kept_c"');
  });
});
