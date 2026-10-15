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

/** Resolves once DuckDB is ready; rejects if it failed to start. */
export function whenEngine(): Promise<EngineClient> {
  const now = useEngineStore.getState();
  if (now.engine) return Promise.resolve(now.engine);
  if (now.status.state === 'failed') return Promise.reject(new Error(now.status.message));
  return new Promise((resolve, reject) => {
    const off = useEngineStore.subscribe((s) => {
      if (s.engine) {
        off();
        resolve(s.engine);
      } else if (s.status.state === 'failed') {
        off();
        reject(new Error(s.status.message));
      }
    });
  });
}
