// What a sample is and how it applies to a project: the pure half of sample mode, which the quality report (and so
// puddle-run) reads without the store.
import { upstreamIds, type Project, type ProjectSettings } from '../model';

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
