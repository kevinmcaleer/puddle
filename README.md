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

Google Drive sync needs a Google Cloud OAuth client ID (type "Web application") in `VITE_GOOGLE_CLIENT_ID` at build time, e.g. `VITE_GOOGLE_CLIENT_ID=1234-abc.apps.googleusercontent.com npm run build`, or `--build-arg VITE_GOOGLE_CLIENT_ID=...` for the Docker image. Without it every Google Drive option is hidden. Add the site's origin (and `http://localhost:5173` for development) as an authorised JavaScript origin, and the same origin followed by `/` as an authorised redirect URI, and enable the Google Drive API for the project. Puddle asks only for the `drive.file` scope. The e2e build uses a test-only ID against a mocked Google.

SheetJS, which reads Excel workbooks, is vendored as `vendor/xlsx-0.20.3.tgz`: its current releases are published on cdn.sheetjs.com, not the npm registry (where `xlsx` stopped at 0.18.5, which has known vulnerabilities). `npm ci` installs it from that file, so installs need no access to the CDN. To upgrade, replace the tarball with a newer one from cdn.sheetjs.com and run `npm install --save-exact xlsx@file:vendor/<tarball>`.

## Tests

Every feature ships with its own tests, and every bug fix with a regression test, so later changes can't silently break earlier work. CI (`.github/workflows/ci.yml`) runs lint, typecheck, the unit and engine tests, and the Playwright suite on every pull request. It also builds the Docker image for amd64 and arm64 and runs `npm run e2e:container` against it: isolation headers, JSON and Parquet from the self-hosted extensions, and offline use.

## Deploying

A Docker image (nginx serving the static build) behind a Cloudflare Tunnel at puddle.kevspowertools.com. `docker compose up -d` runs it on <http://localhost:8088>, and `docker compose --profile tunnel up -d` adds the tunnel. See [deploy/README.md](deploy/README.md).

## Layout

| Path | What lives there |
|---|---|
| `src/design-system/` | Tokens, Tailwind preset and component CSS, vendored from the Puddle design system |
| `src/ui/` | The design system's components in TypeScript (`Button`, `NodeCard`, `StepList`, `RuleRow` and the rest) |
| `src/app/` | The app shell: toolbar actions, inspector and results docks, status strip, theme, engine boot, per-tab session state |
| `src/engine/` | DuckDB-WASM in a Web Worker and the typed `EngineClient` (priorities, cancellation, Stop, plain-word errors) |
| `src/model/` | The project graph: Zod schemas, wiring rules, step edits, grouping, undo and redo |
| `src/compiler/` | The pure graph-to-SQL compiler (steps, joins and lookups over two inputs, appends over any number, and queries from the query designer), step registry, schema cache and the schema book those nodes read their inputs’ columns from |
| `src/sources/` | Adding sources: format detection, file handles, clipboard text, web addresses (fetched again on reopen), choosing files again on reopen (on Chromium, reconnecting them with one permission click through stored file handles), and Excel sources (sheet, header row and range, kept loaded as DuckDB tables) |
| `src/excel/` | SheetJS in a Web Worker: reading `.xlsx` sheets into typed columns and Arrow tables for DuckDB, and writing Excel exports from Arrow batches. Excel's limits and sheet-name rules live in `limits.ts`, which doesn't load SheetJS |
| `src/persistence/` | IndexedDB autosave, `.puddle.json` export and import, format migrations |
| `src/sync/` | Optional project sync through one provider-agnostic layer (`SyncProvider`): sync states, the offline queue, conflict choices and "Open from"; GitHub Gist and Google Drive (only with a client ID set at build time) are the providers. Credentials and sync links stay in IndexedDB on this device (Google's hour-long sign-in in this tab's session only); the synced file is the `.puddle.json` less pasted rows |
| `src/home/` | The projects home screen and the rename and delete dialogs |
| `src/samples/` | The onboarding samples: the catalogue of messy datasets in `public/samples/` (written by `scripts/make-samples.mjs`), the Try a sample picker, and `openSample`, which opens one as a new project |
| `src/canvas/` | The node canvas on React Flow: nodes, wires, auto layout |
| `src/flow/` | Each node's live status (columns, row count, broken, dimmed), kept in step with the project; sample mode above the row threshold |
| `src/steps/` | Each step type's editor form (`defineStepForm`): its Add step menu entry, fields and defaults; the expression editor |
| `src/dates/` | Date format detection: candidate `strptime` formats, ranking by match rate, day and month ambiguity |
| `src/quickfix/` | The quick-fix bar: one click on the selected columns adds one step where the viewed data is |
| `src/rules/` | Quality rule forms and labels; rules compile in `src/compiler/rules.ts` and are checked per node by `src/flow/rules.ts` |
| `src/report/` | Quality reports: what the rules found (counts, overrides from the export log, sources with row counts and head hashes, opt-in failing rows) written as Markdown, JSON or one self-contained HTML file, and the export dialog |
| `src/pwa/` | The service worker (precached app, engine and extensions for offline use), its precache list and the web app manifest |
| `src/export/` | Exports from Output nodes: the quality gate, `COPY ... TO` into DuckDB's in-memory file system (Excel workbooks instead go through the Excel worker), download or clipboard, and the export log |
| `src/query/` | The query designer, in place of the canvas for a Query node: its tables and the join lines dragged between their fields, and the grid of fields with names, sorting, criteria (with "or" rows) and Show, and its Totals row for grouping and summarising |
| `src/inspector/` | The right-hand panel: source read options, applied steps, step settings and node notes |
| `src/notes/` | The project notes panel: Markdown written and previewed, rendered with raw HTML off and links in a new tab |
| `src/results/` | The results table on Glide Data Grid: paging, headers with type and quality |
| `tests/` | Engine integration tests, fixtures and helpers (`scripts/make-excel-fixtures.mjs` writes the Excel fixture) |
| `e2e/` | Playwright tests |

Adding a step type means one `defineStep` in `src/compiler/steps/` (Zod params, past-tense label, compile function), one `defineStepForm` in `src/steps/` (title, group, fields, defaults) and one test fixture.

## Licence

MIT
