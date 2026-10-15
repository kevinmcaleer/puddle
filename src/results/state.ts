import { create } from 'zustand';
import type { ColumnProfile } from './profile';

/** What the status strip shows about the viewed result. */
interface ResultsState {
  rows?: number;
  cols?: number;
  ms?: number;
  /** Per-column profiles, filled in after the grid appears. */
  profile?: Record<string, ColumnProfile>;
  set: (s: Partial<Pick<ResultsState, 'rows' | 'cols' | 'ms' | 'profile'>>) => void;
}

export const useResultsStore = create<ResultsState>((set) => ({ set: (s) => set(s) }));
