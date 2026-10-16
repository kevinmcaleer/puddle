import { sampledUpstream, sampleFor, setFullData, useSample, useSampleStore } from '../flow/sample';
import { useProject } from '../model';
import { Banner, Button, fullCount } from '../ui';

const list = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** Over the results: this is a sample, how big, and Run on full data. In full-data mode, the way back. */
export function SampleBanner() {
  const project = useProject();
  const sample = useSample(project);
  const counts = useSampleStore((s) => s.counts);
  const full = useSampleStore((s) => s.full);
  const nodeId = project.view.viewedNodeId;
  if (!nodeId) return null;
  const sampled = sampledUpstream(project, nodeId, sample);
  if (sampled.length && sample)
    return (
      <div className="px-3 pb-2" data-testid="sample-banner" data-sample={sample.rows}>
        <Banner
          tone="info"
          title={`Sample of ${fullCount(sample.rows)} rows`}
          action={
            <Button size="sm" variant="secondary" onClick={() => setFullData(true)}>
              Run on full data
            </Button>
          }
        >
          {list(sampled.map((s) => `${s.name} has ${fullCount(s.rows)} rows`))}, more than this project’s threshold, so previews, profiles and rules read
          the first {fullCount(sample.rows)} of each. Exports always use the full data.
        </Banner>
      </div>
    );
  // Full data was asked for: say so, with the way back, while a sample would apply.
  const would = full ? sampleFor(project, Object.fromEntries(Object.entries(counts).map(([id, c]) => [id, c.rows])), false) : null;
  if (!would || !sampledUpstream(project, nodeId, would).length) return null;
  return (
    <div className="px-3 pb-2" data-testid="full-data-banner">
      <Banner
        tone="info"
        title="Running on full data"
        action={
          <Button size="sm" variant="ghost" onClick={() => setFullData(false)}>
            Back to the sample
          </Button>
        }
      >
        Previews, profiles and rules read every row, which can be slow on data this size.
      </Banner>
    </div>
  );
}
