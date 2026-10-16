import { flow, src } from '../../tests/helpers/projects';
import { applySample, SAMPLE_CAP, sampledUpstream, sampleFor, sampleSize } from './sample';

const base = flow({
  sources: [src({ id: 'big', format: 'csv' }), src({ id: 'small', format: 'csv' })],
  nodes: [
    { id: 'nBig', type: 'source', sourceId: 'big' },
    { id: 'nSmall', type: 'source', sourceId: 'small' },
    { id: 't', type: 'transform' },
    { id: 'out', type: 'output' },
    { id: 'out2', type: 'output' },
  ],
  wires: [['nBig', 't'], ['t', 'out'], ['nSmall', 'out2']],
});
const project = { ...base, settings: { ...base.settings, sampleThresholdRows: 1000 } };

describe('sample mode', () => {
  it('samples at most the threshold, and never more than the cap', () => {
    expect(sampleSize({ sampleThresholdRows: 1000 })).toBe(1000);
    expect(sampleSize({ sampleThresholdRows: 5_000_000 })).toBe(SAMPLE_CAP);
  });

  it('switches on only for sources over the threshold', () => {
    expect(sampleFor(project, { big: 1000, small: 10 }, false)).toBeNull();
    expect(sampleFor(project, {}, false)).toBeNull();
    expect(sampleFor(project, { big: 5000, small: 10 }, false)).toEqual({ rows: 1000, sources: { big: 5000 } });
  });

  it('switches off when full data was asked for', () => {
    expect(sampleFor(project, { big: 5000 }, true)).toBeNull();
  });

  it('marks only the sampled sources on the copy, leaving the project alone', () => {
    const sample = sampleFor(project, { big: 5000, small: 10 }, false);
    const view = applySample(project, sample);
    expect(view.sources.map((s) => s.sampleRows)).toEqual([1000, undefined]);
    expect(project.sources.every((s) => s.sampleRows == null)).toBe(true);
    expect(applySample(project, null)).toBe(project);
  });

  it('names the sampled sources a node reads from', () => {
    const sample = sampleFor(project, { big: 5000, small: 10 }, false);
    expect(sampledUpstream(project, 'out', sample)).toEqual([{ sourceId: 'big', name: 'big', rows: 5000 }]);
    expect(sampledUpstream(project, 'out2', sample)).toEqual([]);
    expect(sampledUpstream(project, 'out', null)).toEqual([]);
  });
});
