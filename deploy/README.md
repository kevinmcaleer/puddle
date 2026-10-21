# Deploying Puddle

Puddle is a static site: everything runs in the browser, so the server only hands out files. The image is nginx serving the built app, for `linux/amd64` and `linux/arm64`, so it runs on a cluster or a Raspberry Pi. A Cloudflare Tunnel puts it on `puddle.kevspowertools.com` without opening a port.

## The image

CI publishes `ghcr.io/kevinmcaleer/puddle` on every push to `main`, tagged `latest` and with the commit SHA.

To build it yourself:

```sh
docker build -t puddle .
docker run --rm -p 8088:8080 --read-only --tmpfs /tmp puddle
```

Then open <http://localhost:8088>. The build downloads DuckDB's `json` and `parquet` extensions from extensions.duckdb.org (see below). Where that site can't be reached, add `--build-arg FETCH_EXTENSIONS=0`. JSON and Parquet then load from extensions.duckdb.org at run time instead.

What the server does (`deploy/nginx.conf`):

- Every response carries `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, so the page is cross-origin isolated.
- `.wasm` is served as `application/wasm`, and responses are gzipped.
- Hashed files (`/assets/`, `/duckdb-extensions/<version>/`) are cached for a year. `index.html`, `sw.js`, `precache.json` and the manifest are always revalidated, so a deploy shows on the next visit.
- `/docs/` is the user guide, built from `docs/` with Sphinx in its own build stage (the screenshots are committed, so the build needs no browser).
- `/tutorial-data/` passes the taxi tutorial's two files (`trip-data/yellow_tripdata_2024-01.parquet`, `misc/taxi_zone_lookup.csv`) through from the TLC at `d37ci6vzurychx.cloudfront.net`, Range headers and all, without keeping them. The TLC's host sends no CORS headers, so browsers can't read them from there. nginx looks the host up when a request comes, using the DNS servers in the container's `/etc/resolv.conf` (written to `/tmp/puddle-resolver.conf` at start-up by `deploy/30-puddle-resolver.sh`), so Puddle still starts with no internet connection; only **Start the taxi tutorial** needs one. Any other path there answers 404.
- `/healthz` answers `ok` for health checks. The container runs as a non-root user and works with a read-only root file system when `/tmp` is writable.

## Docker Compose

`compose.yaml` in the repository root runs Puddle with a restart policy, a read-only root file system and a health check on `/healthz`. From the repository root:

```sh
docker compose up -d
```

Then open <http://localhost:8088>. Compose uses the `puddle:latest` image you built with `docker build -t puddle .`, and builds it from the Dockerfile if it isn't there. After pulling new code, `docker compose up -d --build` rebuilds it.

These settings can go in the environment or in a `.env` file next to `compose.yaml`:

| Variable | Default | What it does |
| --- | --- | --- |
| `PUDDLE_IMAGE` | `puddle:latest` | The image to run. Set `ghcr.io/kevinmcaleer/puddle:latest` to run the one CI publishes, and update it with `docker compose pull && docker compose up -d` |
| `PUDDLE_PORT` | `8088` | The port Puddle answers on, on the host |
| `FETCH_EXTENSIONS` | `1` | Set `0` to build where extensions.duckdb.org can't be reached (see below) |
| `CLOUDFLARE_TUNNEL_TOKEN` | none | The tunnel's token, for the `tunnel` profile |

## Scheduled runs (puddle-run)

The editor is browser-only, so nothing runs while the browser is closed. `puddle-run` is a second, small container that runs the same project files on the Pi, with the same compiler, on DuckDB's native build (fast on arm64, and it can load DuckDB's database and S3 extensions later).

1. Put each project file where the runner can see it: export it from the editor's project menu (`.puddle.json`) into a folder, say `/srv/puddle/projects`, and put its source files beside it or in a `sources/` folder there. A source read from somewhere else gets its path in the editor: select the source node and fill in **Path to this file** under *On the runner* (absolute, or relative to the project file).
2. Set when it runs in the editor's **Project** tab, **Run on a schedule**, in cron syntax: `0 3 * * *` is 03:00 every day, `*/15 * * * 1-5` every quarter hour on weekdays. A project with no schedule is never run from the folder.
3. Start the runner next to Puddle:

   ```sh
   PUDDLE_PROJECTS=/srv/puddle/projects docker compose --profile runner up -d
   ```

   It reads the folder every 30 seconds (`PUDDLE_RUNNER_POLL`), so a project saved or changed there is picked up without a restart. Times follow `TZ` (default `Europe/London`).

Each run writes every Output node's file (CSV, TSV, JSON, NDJSON or Parquet; Excel and clipboard outputs are skipped for now) into `out/` next to the project files, with `<project>.run.json` (what ran, rows per output, every rule's result) and `<project>.quality.md` (the quality report). A failing `fail` rule holds that export back, as it does in the browser; the run log says which rule.

One-off runs and checks:

```sh
docker run --rm -v /srv/puddle/projects:/projects puddle-run:latest check /projects/orders.puddle.json
docker run --rm -v /srv/puddle/projects:/projects puddle-run:latest run /projects/orders.puddle.json
```

Without Docker, `npm run build:runner` builds `dist-runner/puddle-run.mjs`, and `node dist-runner/puddle-run.mjs watch /srv/puddle/projects` runs it on any machine with Node 22 or later (pdf.js, which reads PDF sources, needs it; the native DuckDB binding is downloaded by `npm ci` for the machine's own platform).

### Schemas in a pipeline (puddle-run schema)

`puddle-run schema` does the Schema view's jobs from the command line, on a project file or a plain `.dbml` file, so a repository that keeps its database design as DBML can check it and generate from it in CI. It needs no DuckDB and reads no data.

```sh
node dist-runner/puddle-run.mjs schema shop.dbml --check
node dist-runner/puddle-run.mjs schema shop.puddle.json --ddl postgres schema.sql --records
node dist-runner/puddle-run.mjs schema shop.dbml --docs schema.html --docs-md schema.md --mermaid schema.mmd
node dist-runner/puddle-run.mjs schema shop.dbml --diff old/shop.dbml --migration postgres migration.sql
```

| Option | Writes |
| --- | --- |
| `--check` | nothing; prints each DBML error with its line and column, and exits 1 if there are any |
| `--dbml <out.dbml>` | the DBML as Puddle writes it (normalised) |
| `--ddl <dialect> <out.sql>` | the CREATE script for `duckdb`, `postgres`, `mysql`, `sqlite` or `sqlserver`; `--records` adds the INSERTs for the DBML's records |
| `--docs <out.html>`, `--docs-md <out.md>` | the docs page, as Export › Docs writes it, without the diagrams (drawing them needs a browser) |
| `--mermaid <out.mmd>` | the diagram as a Mermaid `erDiagram` |
| `--diff <older>` | prints what changed since an older project or `.dbml` file; with `--migration <dialect> <out.sql>`, the script that takes the older schema to this one, with lossy changes marked |

It exits 0 when everything worked, 1 on DBML errors or a file it can't read, and 2 on arguments it doesn't understand. A GitHub Actions job that fails a pull request on a DBML error and commits the regenerated SQL and docs:

```yaml
name: Schema
on:
  pull_request:
    paths: ['db/schema.dbml']
permissions:
  contents: write
jobs:
  schema:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.head_ref }}
      - uses: actions/checkout@v4
        with:
          repository: kevinmcaleer/puddle
          path: .puddle
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci && npm run build:runner
        working-directory: .puddle
      - name: Check the DBML
        run: node .puddle/dist-runner/puddle-run.mjs schema db/schema.dbml --check
      - name: Write the SQL and docs
        run: node .puddle/dist-runner/puddle-run.mjs schema db/schema.dbml --ddl postgres db/schema.sql --docs-md db/schema.md
      - name: Commit them if they changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add db/schema.sql db/schema.md
          git diff --cached --quiet || (git commit -m "Regenerate schema SQL and docs" && git push)
```

## The tunnel

1. In Cloudflare Zero Trust, go to Networks, then Tunnels, and create a tunnel. Copy its token.
2. Add a public hostname: `puddle.kevspowertools.com`, service `http://puddle:8080`.
3. Next to `compose.yaml`, create a `.env` file containing `CLOUDFLARE_TUNNEL_TOKEN=<token>`, then start Puddle with the tunnel:

   ```sh
   docker compose --profile tunnel up -d
   ```

   The tunnel starts once Puddle's health check passes.

Check that the headers survive the tunnel:

```sh
curl -sI https://puddle.kevspowertools.com/ | grep -i cross-origin
```

Both isolation headers should appear. In the browser console, `crossOriginIsolated` should be `true`. Don't turn on Cloudflare features that rewrite responses, such as Rocket Loader or email obfuscation. The largest file is DuckDB's WASM engine (about 36 MB), well within what Cloudflare passes and caches.

## DuckDB extensions

DuckDB-WASM reads JSON and Parquet through extensions that it normally downloads from extensions.duckdb.org. The image includes them instead: `scripts/fetch-duckdb-extensions.mjs` downloads them at build time for the bundled DuckDB version into `duckdb-extensions/<version>/<platform>/`, and writes a `manifest.json`. On start, the app checks that manifest and points DuckDB at the site's own copy, so loading these formats sends no request off the site. Run `npm run fetch-extensions` to get the same locally.

## Offline

After the first visit, a service worker keeps the app, the engine and the extensions, and Puddle opens and runs with no network. Each deploy has its own cache, and the old one is removed once the new one is ready. Data files are never cached: they're read from your disk each time.

## Browser support and memory

- Puddle runs in Chrome, Edge, Firefox and Safari. CI runs the whole Playwright suite in Chromium and Firefox on every pull request and in WebKit (Safari's engine) nightly, and the container tests, including offline use, in Chromium and Firefox. Locally `npm run e2e` uses Chromium; set `E2E_BROWSERS=firefox` (or `chromium,firefox,webkit`) after `npx playwright install firefox webkit` to run the others.
- Only Chrome and Edge keep access to files between visits (the File System Access API), so a reopened project reconnects with one click. Firefox and Safari can't: Puddle says so in a note on the canvas, and each file is chosen again from its node.
- Copying an export to the clipboard asks for the clipboard during the click and fills it once the export has run, which is what Safari and Firefox require. A browser that refuses gets a message to export a file instead.
- Where the origin private file system isn't available, DuckDB keeps everything in memory instead of spilling large intermediate results to it.
- DuckDB runs single-threaded (the `eh` bundle). The multi-threaded `coi` bundle is off because its worker threads can't read files chosen in the browser. The isolation headers stay so it can return later without a hosting change.
- Source files are read from disk in pieces, so a file can be larger than memory. Intermediate results live in the tab's WebAssembly memory, which tops out at 4 GB.
- Exports are written into DuckDB's memory and then handed to the browser as one file, so an export needs about twice its size in free memory. A 290 MB CSV exports comfortably.

### Memory ceiling by browser

The large-file check (`a file big enough to be scanned in parallel is read in full` in `e2e/engine.spec.ts`) loads and counts a 1.2 million row, 100 MB CSV. CI runs it in every browser on each pull request.

| Browser | Large-file check (100 MB CSV) | Ceiling |
| --- | --- | --- |
| Chromium | Passes | WebAssembly memory tops out at 4 GB |
| Firefox | Runs in CI | Not yet measured |
| WebKit (Safari) | Runs in CI nightly | Not yet measured. Safari is known to reclaim memory from busy tabs sooner, so expect a lower ceiling |

To measure a ceiling, raise `rows` in that test until it fails and record the largest size that passed here.

