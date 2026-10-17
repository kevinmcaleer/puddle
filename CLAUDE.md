# Puddle

Browser-only data cleansing on DuckDB-WASM. See README.md for layout and commands.

## Tests are part of every change

- Every feature ships its own tests: unit tests next to the code (`src/**/*.test.ts`), engine tests on real DuckDB-WASM against `tests/fixtures/`, and one Playwright test in `e2e/` for each user-facing flow it adds or changes.
- Logic and edge cases belong in unit and engine tests. A Playwright test shows that the flow works in a real browser, from the user's side, once; it does not repeat the cases the unit tests cover.
- Every bug fix adds a regression test that fails without the fix, at the lowest level that reproduces it: a browser-only bug gets a Playwright test, anything else a unit or engine test.
- Never skip, delete or weaken an existing test to get CI green; fix the cause.
- Before pushing, run `npm run lint`, `npm run typecheck`, `npm test` and `npm run e2e` (Chromium). CI runs the same, plus Firefox, on every pull request; WebKit runs the whole Playwright suite against main every night.

## Conventions

- Follow the design system in `src/design-system/` and `src/ui/`: tokens only, no hard-coded colours or sizes; sentence case; no emoji.
- SQL is generated only in `src/compiler/`; quote through `src/compiler/sql.ts`.
- A new step type is one `defineStep` in `src/compiler/steps/`, an editor form and a fixture-backed test.
