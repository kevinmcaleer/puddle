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
- `/healthz` answers `ok` for health checks. The container runs as a non-root user and works with a read-only root file system when `/tmp` is writable.

## The tunnel

1. In Cloudflare Zero Trust, go to Networks, then Tunnels, and create a tunnel. Copy its token.
2. Add a public hostname: `puddle.kevspowertools.com`, service `http://puddle:8080`.
3. Next to `deploy/docker-compose.yml`, create a `.env` file containing `CLOUDFLARE_TUNNEL_TOKEN=<token>`, then run:

   ```sh
   docker compose -f deploy/docker-compose.yml up -d
   ```

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

- Chrome and Edge are the targets. Firefox and Safari should work but are best-effort.
- DuckDB runs single-threaded (the `eh` bundle). The multi-threaded `coi` bundle is off because its worker threads can't read files chosen in the browser. The isolation headers stay so it can return later without a hosting change.
- Source files are read from disk in pieces, so a file can be larger than memory. Intermediate results live in the tab's WebAssembly memory, which tops out at 4 GB.
- Exports are written into DuckDB's memory and then handed to the browser as one file, so an export needs about twice its size in free memory. A 290 MB CSV exports comfortably.
