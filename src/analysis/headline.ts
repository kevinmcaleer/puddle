// The findings headline: what analysis found in a source, said above its rows, where a newcomer is looking.
import { defaultTicked } from './fixes';
import type { Issue } from './issues';

export interface Headline {
  /** How many problems Fix all would fix. */
  count: number;
  text: string;
}

/**
 * The headline over a source's rows: "7 problems found in sales.csv". It counts what Fix all would fix (the issues
 * marked Fix, and the suggestions too when the project applies them), so the number and the button beside it agree.
 * Nothing shows on a node that isn't a source, once those issues are fixed or ignored (they are no longer `open`), or
 * once it was dismissed for the node.
 */
export function findingsHeadline(node: { type: string; name: string; findingsDismissed?: boolean }, open: Issue[], suggestions: boolean): Headline | null {
  if (node.type !== 'source' || node.findingsDismissed) return null;
  const count = defaultTicked(open, suggestions).length;
  if (!count) return null;
  return { count, text: `${count} ${count === 1 ? 'problem' : 'problems'} found in ${node.name}` };
}
