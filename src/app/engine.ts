import { create } from 'zustand';
import { getEngine, type EngineClient, type EngineInfo } from '../engine';

export type EngineStatus = { state: 'loading' } | { state: 'ready'; info: EngineInfo } | { state: 'failed'; message: string };

interface EngineState {
  status: EngineStatus;
  engine: EngineClient | null;
}

export const useEngineStore = create<EngineState>(() => ({ status: { state: 'loading' }, engine: null }));

let booted = false;

/** Boot DuckDB-WASM in the background. Safe to call more than once. */
export function bootEngine() {
  if (booted) return;
  booted = true;
  getEngine().then(
    (engine) => useEngineStore.setState({ engine, status: { state: 'ready', info: engine.info } }),
    (e: unknown) => useEngineStore.setState({ status: { state: 'failed', message: e instanceof Error ? e.message : String(e) } }),
  );
}
