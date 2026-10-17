import { flow } from '../../tests/helpers/projects';
import { setOutputSpec, type OutputNode } from '../model';
import { exportChoices, exportLabel } from './labels';

const output = (format: OutputNode['outputSpec']['format']) => setOutputSpec(flow({ nodes: [{ id: 'out', type: 'output' }] }), 'out', { format }).nodes[0] as OutputNode;

describe('export labels', () => {
  it('offers every format, files first with their extensions, ticking the node’s own', () => {
    const choices = exportChoices(output('csv'));
    expect(choices.map((c) => c.label)).toEqual(['CSV', 'Parquet', 'JSON', 'NDJSON', 'Excel', 'Copy to clipboard']);
    expect(choices.find((c) => c.format === 'parquet')).toMatchObject({ hint: '.parquet', checked: false });
    expect(choices.filter((c) => c.checked).map((c) => c.format)).toEqual(['csv']);
    expect(choices.at(-1)?.hint).toBeUndefined();
  });

  it('names the button after the format', () => {
    expect(exportLabel(output('parquet'))).toBe('Export Parquet');
    expect(exportLabel(output('clipboard'))).toBe('Copy to clipboard');
  });
});
