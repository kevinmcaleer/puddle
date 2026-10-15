# Puddle

A browser-based data cleansing and preparation tool in the spirit of Power Query, built on DuckDB running inside the browser. Load messy files, wire a flow of cleaning steps on a node canvas, check the result against quality rules and export tidy data.

Nothing leaves your browser. Projects save the steps, not the data.

## Development

Needs Node 20 or later.

```sh
npm install
npm run dev        # http://localhost:5173, cross-origin isolated so DuckDB uses its multi-threaded bundle
npm run lint
npm run typecheck
npm test           # unit tests, plus engine tests on real DuckDB-WASM (Node build)
npm run e2e        # Playwright against a production build (run `npx playwright install chromium` once)
```

## Layout

| Path | What lives there |
|---|---|
| `src/design-system/` | Tokens, Tailwind preset and component CSS, vendored from the Puddle design system |
| `src/ui/` | The design system's components in TypeScript (`Button`, `NodeCard`, `StepList`, `RuleRow` and the rest) |
| `src/app/` | The app shell: toolbar, canvas, inspector, results dock, status strip, theme |
| `src/engine/` | DuckDB-WASM in a Web Worker and the typed `EngineClient` (priorities, cancellation, plain-word errors) |
| `src/model/` | The project graph: Zod schemas, wiring rules, undo and redo |
| `src/compiler/` | The pure graph-to-SQL compiler, step registry and schema cache |
| `tests/` | Engine integration tests, fixtures and helpers |
| `e2e/` | Playwright tests |

Adding a step type means one `defineStep` in `src/compiler/steps/` (Zod params, past-tense label, compile function), one editor form and one test fixture.

## Licence

MIT
