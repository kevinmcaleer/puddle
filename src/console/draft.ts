import { create } from 'zustand';
import type { ColumnSchema } from '../model';

export const DEFAULT_QUERY = 'SELECT *\nFROM input\nLIMIT 20';

/** How many commands the shell remembers for the up and down arrows. */
export const HISTORY_LIMIT = 100;
/** How many answers the shell keeps above the prompt; older ones scroll away. */
export const TRANSCRIPT_LIMIT = 30;
const HISTORY_KEY = 'puddle.shell.history';

/** What the shell shows for one statement it ran. */
export type ShellOutput =
  | { kind: 'running' }
  | { kind: 'rows'; columns: ColumnSchema[]; rows: Record<string, unknown>[]; ms: number; title?: string }
  /** A table made or changed: its node, and its first rows. */
  | { kind: 'table'; message: string; nodeId?: string; columns?: ColumnSchema[]; rows?: Record<string, unknown>[] }
  | { kind: 'tables'; tables: { name: string; nodeId: string; type: string; columns?: number }[] }
  | { kind: 'text'; text: string; code?: boolean }
  | { kind: 'error'; title: string; message: string; line?: { line: number; text: string } }
  /** The query was kept as a SQL node: its rows are that node's now. */
  | { kind: 'kept'; nodeId: string; name: string };

export interface ShellEntry {
  id: number;
  command: string;
  /** The node read as `input` when it ran, by name, if the command read it. */
  input?: string;
  output: ShellOutput;
}

interface ShellState {
  query: string;
  setQuery: (query: string) => void;
  /** Commands run, oldest first. Kept in this browser, not in the project. */
  history: string[];
  remember: (command: string) => void;
  entries: ShellEntry[];
  add: (entry: Omit<ShellEntry, 'id'>) => number;
  update: (id: number, output: ShellOutput) => void;
  clear: () => void;
  /** The SQL node the shell keeps its tables in this session, if it has made one. */
  hostId?: string;
  setHost: (id: string) => void;
}

function storedHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((c): c is string => typeof c === 'string').slice(-HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

let nextId = 1;

/**
 * The shell's prompt, history and answers, kept while the console closes and opens, like a scratch pad. Not part of
 * the project: the tables the shell makes are, as SQL nodes.
 */
export const useConsoleDraft = create<ShellState>((set) => ({
  query: DEFAULT_QUERY,
  setQuery: (query) => set({ query }),
  history: storedHistory(),
  remember: (command) =>
    set((s) => {
      const history = [...s.history.filter((c) => c !== command), command].slice(-HISTORY_LIMIT);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      } catch {
        // Storage may be off (a private window): the history lasts as long as the page.
      }
      return { history };
    }),
  entries: [],
  add: (entry) => {
    const id = nextId++;
    set((s) => ({ entries: [...s.entries, { ...entry, id }].slice(-TRANSCRIPT_LIMIT) }));
    return id;
  },
  update: (id, output) => set((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, output } : e)) })),
  clear: () => set({ entries: [] }),
  setHost: (hostId) => set({ hostId }),
}));
