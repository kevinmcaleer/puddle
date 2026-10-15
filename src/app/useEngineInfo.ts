import { useEffect, useState } from 'react';
import { getEngine, type EngineInfo } from '../engine';

export type EngineStatus = { state: 'loading' } | { state: 'ready'; info: EngineInfo } | { state: 'failed'; message: string };

/** Boots DuckDB-WASM in the background and reports when it's ready. */
export function useEngineStatus(): EngineStatus {
  const [status, setStatus] = useState<EngineStatus>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    getEngine().then(
      (engine) => {
        if (!live) return;
        setStatus({ state: 'ready', info: engine.info });
        // Exposed for end-to-end tests and debugging in the console. Everything stays in this tab.
        (globalThis as { __puddle?: unknown }).__puddle = { engine };
      },
      (e: unknown) => live && setStatus({ state: 'failed', message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, []);
  return status;
}
