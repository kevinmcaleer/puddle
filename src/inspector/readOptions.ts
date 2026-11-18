import { isReadOptionsFix, type Issue } from '../analysis/issues';

/**
 * Whether a source's read options start open. A file that reads cleanly keeps them folded away, so the Issues list
 * is what shows; they open by themselves when the source can't be read (the options are how to put that right), when
 * the file is a document (its options pick which table is read), or when an open issue's fix is a read option. Opening
 * or closing them by hand (`choice`) wins.
 */
export function readOptionsOpen(source: { state: 'ok' | 'error' | 'other'; issues: Pick<Issue, 'fix'>[]; format?: string }, choice: boolean | null = null): boolean {
  if (choice != null) return choice;
  if (source.state === 'error') return true;
  // A document's options choose which of its tables is read, which is the first thing to settle, not a detail.
  if (source.format === 'word' || source.format === 'pdf') return true;
  return source.issues.some((i) => isReadOptionsFix(i.fix));
}
