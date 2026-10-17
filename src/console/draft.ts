import { create } from 'zustand';

export const DEFAULT_QUERY = 'SELECT *\nFROM input\nLIMIT 20';

/** The console's query, kept while the console closes and opens, like a scratch pad. Not part of the project. */
export const useConsoleDraft = create<{ query: string; setQuery: (query: string) => void }>((set) => ({ query: DEFAULT_QUERY, setQuery: (query) => set({ query }) }));
