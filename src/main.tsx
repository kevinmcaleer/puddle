import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { bootEngine, useEngineStore, whenEngine } from './app/engine';
import { applyTheme, useTheme } from './app/theme';
import { useKeptStore } from './flow/kept';
import { useProjectStore } from './model';
import { registerServiceWorker } from './pwa/register';
import './index.css';

applyTheme(useTheme.getState().preference);
bootEngine();
// After the engine has loaded, so the worker's precache reads the 36 MB WASM from the HTTP cache instead of
// downloading it a second time alongside the page (Chromium fails one of the two with ERR_CACHE_WRITE_FAILURE).
whenEngine().then(registerServiceWorker, () => undefined);

// A handle for the Playwright tests and for poking at the engine from the console. Everything stays in this tab.
useEngineStore.subscribe((s) => {
  if (s.engine) (globalThis as { __puddle?: unknown }).__puddle = { engine: s.engine, store: useProjectStore, kept: useKeptStore };
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
