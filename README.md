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

## Tests

Every feature ships with its own tests, and every bug fix with a regression test, so later changes can't silently break earlier work. CI (`.github/workflows/ci.yml`) runs lint, typecheck, the unit and engine tests, and the Playwright suite on every pull request.

## Layout

| Path | What lives there |
|---|---|
| `src/design-system/` | Tokens, Tailwind preset and component CSS, vendored from the Puddle design system |
| `src/ui/` | The design system's components in TypeScript (`Button`, `NodeCard`, `StepList`, `RuleRow` and the rest) |
| `src/app/` | The app shell: toolbar actions, inspector and results docks, status strip, theme, engine boot, per-tab session state |
| `src/engine/` | DuckDB-WASM in a Web Worker and the typed `EngineClient` (priorities, cancellation, plain-word errors) |
| `src/model/` | The project graph: Zod schemas, wiring rules, undo and redo |
| `src/compiler/` | The pure graph-to-SQL compiler, step registry and schema cache |
| `src/sources/` | Adding sources: format detection, file handles, clipboard text |
| `src/canvas/` | The node canvas on React Flow: nodes, wires, auto layout |
| `src/flow/` | Each node's live status (columns, row count, broken, dimmed), kept in step with the project |
| `src/inspector/` | The right-hand panel: node details and source read options |
| `src/results/` | The results table on Glide Data Grid: paging, headers with type and quality |
| `tests/` | Engine integration tests, fixtures and helpers |
| `e2e/` | Playwright tests |

Adding a step type means one `defineStep` in `src/compiler/steps/` (Zod params, past-tense label, compile function), one editor form and one test fixture.

## Licence

MIT
