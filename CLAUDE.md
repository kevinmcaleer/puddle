# Puddle

Browser-only data cleansing on DuckDB-WASM. See README.md for layout and commands.

## Tests are part of every change

- Every feature ships its own tests: unit tests next to the code (`src/**/*.test.ts`), engine tests on real DuckDB-WASM against `tests/fixtures/`, and a Playwright test of the user-facing flow in `e2e/`.
- Every bug fix adds a regression test that fails without the fix.
- Never skip, delete or weaken an existing test to get CI green; fix the cause.
- Before pushing, run `npm run lint`, `npm run typecheck`, `npm test` and `npm run e2e`. CI runs the same on every pull request.

## Conventions

- Follow the design system in `src/design-system/` and `src/ui/`: tokens only, no hard-coded colours or sizes; sentence case; no emoji.
- SQL is generated only in `src/compiler/`; quote through `src/compiler/sql.ts`.
- A new step type is one `defineStep` in `src/compiler/steps/`, an editor form and a fixture-backed test.
