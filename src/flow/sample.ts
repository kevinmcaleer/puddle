// Sample mode (plan D4): above the project's row threshold, previews, profiles and rules read only the first rows of
// each large source, so editing stays fast. It is never silent: the results say so, and one click runs on full data.
// Exports always read everything.
import { useMemo } from 'react';
import { create } from 'zustand';
import { upstreamKey } from '../compiler';
import type { EngineClient } from '../engine';
import { useProject, type Project } from '../model';
import { applySample, sampleFor, type Sample } from './sampling';
import { countRows } from './status';

export { applySample, SAMPLE_CAP, sampleFor, sampleSize, sampledUpstream, type Sample } from './sampling';

interface SampleState {
  /** Each source's full row count, with the upstream key it was counted for. */
  counts: Record<string, { key: string; rows: number }>;
  /** "Run on full data" was pressed for this project. */
  full: boolean;
}

export const useSampleStore = create<SampleState>(() => ({ counts: {}, full: false }));

/** Run on full data, or go back to the sample. */
export const setFullData = (full: boolean) => useSampleStore.setState({ full });

/** A project was opened: start from the sample again. */
export const resetSample = () => useSampleStore.setState({ full: false });

const plainCounts = (counts: SampleState['counts']) => Object.fromEntries(Object.entries(counts).map(([id, c]) => [id, c.rows]));

/** The sample in force for a project right now. */
export function currentSample(project: Project): Sample | null {
  const { counts, full } = useSampleStore.getState();
  return sampleFor(project, plainCounts(counts), full);
}

/**
 * Count every readable source's rows on the full data (at background priority, cached by upstream key), so the
 * sample can switch on when one passes the threshold.
 */
export async function countSources(engine: EngineClient, project: Project, readable: (sourceId: string) => boolean = () => true): Promise<void> {
  const jobs = project.nodes.map(async (n) => {
    if (n.type !== 'source' || !readable(n.sourceId)) return;
    const key = upstreamKey(project, { nodeId: n.id });
    if (useSampleStore.getState().counts[n.sourceId]?.key === key) return;
    try {
      const rows = await countRows(engine, project, n.id);
      useSampleStore.setState((s) => ({ counts: { ...s.counts, [n.sourceId]: { key, rows } } }));
    } catch {
      // A source that can't be read shows its own error; it just isn't sampled.
    }
  });
  await Promise.all(jobs);
}

/** The sample in force for the open project, kept stable between renders. */
export function useSample(project: Project): Sample | null {
  const counts = useSampleStore((s) => s.counts);
  const full = useSampleStore((s) => s.full);
  return useMemo(() => sampleFor(project, plainCounts(counts), full), [project, counts, full]);
}

/** The project as previews, profiles and rules see it: sampled in sample mode, the project itself otherwise. */
export function useViewProject(): Project {
  const project = useProject();
  const sample = useSample(project);
  return useMemo(() => applySample(project, sample), [project, sample]);
}
