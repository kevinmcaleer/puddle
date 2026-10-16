# Puddle

A browser-based data cleansing and preparation tool in the spirit of Power Query, built on DuckDB running inside the browser. Load messy files, wire a flow of cleaning steps on a node canvas, check the result against quality rules and export tidy data.

Nothing leaves your browser. Projects save the steps, not the data.

## Development

Needs Node 20 or later.

```sh
npm install
npm run dev        # http://localhost:5173
npm run lint
npm run typecheck
npm test           # unit tests, plus engine tests on real DuckDB-WASM (Node build)
npm run e2e        # Playwright against a production build (run `npx playwright install chromium` once)
npm run fetch-extensions  # optional: serve DuckDB's json and parquet extensions locally
```

## Tests

Every feature ships with its own tests, and every bug fix with a regression test, so later changes can't silently break earlier work. CI (`.github/workflows/ci.yml`) runs lint, typecheck, the unit and engine tests, and the Playwright suite on every pull request. It also builds the Docker image for amd64 and arm64 and runs `npm run e2e:container` against it: isolation headers, JSON and Parquet from the self-hosted extensions, and offline use.

## Deploying

A Docker image (nginx serving the static build) behind a Cloudflare Tunnel at puddle.kevspowertools.com. See [deploy/README.md](deploy/README.md).

## Layout

| Path | What lives there |
|---|---|
| `src/design-system/` | Tokens, Tailwind preset and component CSS, vendored from the Puddle design system |
| `src/ui/` | The design system's components in TypeScript (`Button`, `NodeCard`, `StepList`, `RuleRow` and the rest) |
| `src/app/` | The app shell: toolbar actions, inspector and results docks, status strip, theme, engine boot, per-tab session state |
| `src/engine/` | DuckDB-WASM in a Web Worker and the typed `EngineClient` (priorities, cancellation, plain-word errors) |
| `src/model/` | The project graph: Zod schemas, wiring rules, step edits, grouping, undo and redo |
| `src/compiler/` | The pure graph-to-SQL compiler, step registry and schema cache |
| `src/sources/` | Adding sources: format detection, file handles, clipboard text, web addresses (fetched again on reopen), and choosing files again on reopen (on Chromium, reconnecting them with one permission click through stored file handles) |
| `src/persistence/` | IndexedDB autosave, `.puddle.json` export and import, format migrations |
| `src/home/` | The projects home screen and the rename and delete dialogs |
| `src/canvas/` | The node canvas on React Flow: nodes, wires, auto layout |
| `src/flow/` | Each node's live status (columns, row count, broken, dimmed), kept in step with the project |
| `src/steps/` | Each step type's editor form (`defineStepForm`): its Add step menu entry, fields and defaults; the expression editor |
| `src/dates/` | Date format detection: candidate `strptime` formats, ranking by match rate, day and month ambiguity |
| `src/quickfix/` | The quick-fix bar: one click on the selected columns adds one step where the viewed data is |
| `src/rules/` | Quality rule forms and labels; rules compile in `src/compiler/rules.ts` and are checked per node by `src/flow/rules.ts` |
| `src/pwa/` | The service worker (precached app, engine and extensions for offline use), its precache list and the web app manifest |
| `src/export/` | Exports from Output nodes: the quality gate, `COPY ... TO` into DuckDB's in-memory file system, download or clipboard, and the export log |
| `src/inspector/` | The right-hand panel: source read options, applied steps, step settings and node notes |
| `src/notes/` | The project notes panel: Markdown written and previewed, rendered with raw HTML off and links in a new tab |
| `src/results/` | The results table on Glide Data Grid: paging, headers with type and quality |
| `tests/` | Engine integration tests, fixtures and helpers |
| `e2e/` | Playwright tests |

Adding a step type means one `defineStep` in `src/compiler/steps/` (Zod params, past-tense label, compile function), one `defineStepForm` in `src/steps/` (title, group, fields, defaults) and one test fixture.

## Licence

MIT
