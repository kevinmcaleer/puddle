import { EngineClient } from './client';

let engine: Promise<EngineClient> | null = null;

/** The app's one engine. DuckDB-WASM loads lazily on first use. */
export function getEngine(): Promise<EngineClient> {
  engine ??= import('./browser').then(async ({ createBrowserBackend }) => new EngineClient(await createBrowserBackend()));
  return engine;
}
