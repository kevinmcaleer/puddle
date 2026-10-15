import { create } from 'zustand';

/** What the status strip shows about the viewed result. */
interface ResultsState {
  rows?: number;
  cols?: number;
  ms?: number;
  set: (s: Partial<Pick<ResultsState, 'rows' | 'cols' | 'ms'>>) => void;
}

export const useResultsStore = create<ResultsState>((set) => ({ set: (s) => set(s) }));
