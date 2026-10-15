import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { bootEngine, useEngineStore } from './app/engine';
import { applyTheme, useTheme } from './app/theme';
import { useProjectStore } from './model';
import './index.css';

applyTheme(useTheme.getState().preference);
bootEngine();

// A handle for the Playwright tests and for poking at the engine from the console. Everything stays in this tab.
useEngineStore.subscribe((s) => {
  if (s.engine) (globalThis as { __puddle?: unknown }).__puddle = { engine: s.engine, store: useProjectStore };
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
