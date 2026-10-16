// Sample mode (plan D4): above the project's row threshold, previews, profiles and rules read only the first rows of
// each large source, so editing stays fast. It is never silent: the results say so, and one click runs on full data.
// Exports always read everything.
import { useMemo } from 'react';
import { create } from 'zustand';
import { upstreamKey } from '../compiler';
import type { EngineClient } from '../engine';
import { upstreamIds, useProject, type Project, type ProjectSettings } from '../model';
import { countRows } from './status';

/** However high the threshold, a sample is at most this many rows per source. */
export const SAMPLE_CAP = 100_000;

/** Rows read from each sampled source. */
export const sampleSize = (settings: Pick<ProjectSettings, 'sampleThresholdRows'>) => Math.min(settings.sampleThresholdRows, SAMPLE_CAP);

/** Which sources are sampled, and their full row counts. */
export interface Sample {
  rows: number;
  /** Full row count of each sampled source, by source id. */
  sources: Record<string, number>;
}

/** Sources over the threshold are sampled, unless full data was asked for. */
export function sampleFor(project: Project, counts: Record<string, number | undefined>, full: boolean): Sample | null {
  if (full) return null;
  const threshold = project.settings.sampleThresholdRows;
  const over = project.sources.filter((s) => (counts[s.id] ?? 0) > threshold);
  if (!over.length) return null;
  return { rows: sampleSize(project.settings), sources: Object.fromEntries(over.map((s) => [s.id, counts[s.id]!])) };
}

/** The copy of the project that previews, profiles and rules compile from: sampled sources read their first rows. */
export function applySample(project: Project, sample: Sample | null): Project {
  if (!sample) return project;
  return { ...project, sources: project.sources.map((s) => (s.id in sample.sources ? { ...s, sampleRows: sample.rows } : s)) };
}

/** The sampled sources a node reads from, with their full row counts; empty when its result is the full data. */
export function sampledUpstream(project: Project, nodeId: string, sample: Sample | null): { sourceId: string; name: string; rows: number }[] {
  if (!sample) return [];
  const ids = upstreamIds(project, nodeId);
  return project.nodes.flatMap((n) => {
    if (n.type !== 'source' || !ids.has(n.id) || !(n.sourceId in sample.sources)) return [];
    const source = project.sources.find((s) => s.id === n.sourceId);
    return source ? [{ sourceId: source.id, name: source.name, rows: sample.sources[source.id]! }] : [];
  });
}

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
