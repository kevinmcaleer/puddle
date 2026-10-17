import { flow } from '../../tests/helpers/projects';
import { logExport, setOutputFormat, setOutputSpec } from './exports';
import { EXPORT_LOG_LIMIT } from './schema';

const entry = { at: '2026-10-15T00:00:00Z', nodeId: 'out', nodeName: 'Out', format: 'csv' as const, fileName: 'Out.csv', rows: 1 };

describe('export log', () => {
  it('keeps the newest entries first, up to the limit', () => {
    let p = flow({ nodes: [{ id: 'out', type: 'output' }] });
    for (let i = 0; i < EXPORT_LOG_LIMIT + 5; i++) p = logExport(p, { ...entry, rows: i }, `x${i}`);
    expect(p.exportLog).toHaveLength(EXPORT_LOG_LIMIT);
    expect(p.exportLog[0]).toMatchObject({ id: `x${EXPORT_LOG_LIMIT + 4}`, rows: EXPORT_LOG_LIMIT + 4 });
  });

  it('changes only Output nodes’ export settings', () => {
    const p = flow({ nodes: [{ id: 't', type: 'transform' }, { id: 'out', type: 'output' }] });
    const next = setOutputSpec(setOutputSpec(p, 'out', { format: 'parquet', fileName: 'tidy' }), 't', { format: 'json' });
    expect(next.nodes[1]).toMatchObject({ outputSpec: { format: 'parquet', fileName: 'tidy', options: {} } });
    expect(next.nodes[0]).toBe(p.nodes[0]);
  });

  it('switches format keeping the file name, drops the old options, and leaves the same format alone', () => {
    const p = setOutputSpec(flow({ nodes: [{ id: 't', type: 'transform' }, { id: 'out', type: 'output' }] }), 'out', { fileName: 'tidy', options: { delimiter: ';' } });
    expect(setOutputFormat(p, 'out', 'parquet').nodes[1]).toMatchObject({ outputSpec: { format: 'parquet', fileName: 'tidy', options: {} } });
    expect(setOutputFormat(p, 'out', 'csv')).toBe(p);
    expect(setOutputFormat(p, 't', 'parquet')).toBe(p);
  });
});
