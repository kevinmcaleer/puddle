# Self-hosting

Puddle is a static site: everything runs in the browser, so a server only hands out files. The image is nginx serving the built app, for `linux/amd64` and `linux/arm64`, so it runs on a cluster or a Raspberry Pi. [deploy/README.md](https://github.com/kevinmcaleer/puddle/blob/main/deploy/README.md) has the full detail; this page is the short version.

## Run the published image

CI publishes `ghcr.io/kevinmcaleer/puddle` on every push to `main`, tagged `latest` and with the commit SHA.

```sh
docker run --rm -p 8088:8080 --read-only --tmpfs /tmp ghcr.io/kevinmcaleer/puddle:latest
```

Then open <http://localhost:8088>.

## Docker Compose

`compose.yaml` in the repository root runs Puddle with a restart policy, a read-only file system and a health check on `/healthz`:

```sh
docker compose up -d
```

`PUDDLE_IMAGE`, `PUDDLE_PORT` and `CLOUDFLARE_TUNNEL_TOKEN` can be set in the environment or a `.env` file next to `compose.yaml`. `docker compose --profile tunnel up -d` adds a Cloudflare Tunnel, which puts Puddle on your own domain without opening a port.

## What the server must do

- Send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on every response.
- Serve `.wasm` files as `application/wasm`.
- Revalidate `index.html`, `sw.js`, `precache.json` and the manifest on every visit, so a deploy shows straight away.

The image does all of this already.

## Scheduled runs

`puddle-run` is a second, small container that runs exported project files (`.puddle.json`) on a schedule, outside the browser, with the same compiler on DuckDB's native build. It watches a folder of project files, runs each one when its **Run on a schedule** setting says, and writes every Output node's file, a run log and a quality report into an `out/` folder beside them. `docker compose --profile runner up -d` starts it with `PUDDLE_PROJECTS` pointing at the folder; the [deployment README](https://github.com/kevinmcaleer/puddle/blob/main/deploy/README.md#scheduled-runs-puddle-run) has the details, and `puddle-run check <file>` says where a project's sources were found and when it would next run.

## Google Drive sync

Google Drive sync needs a Google Cloud OAuth client ID at build time: `--build-arg VITE_GOOGLE_CLIENT_ID=...` for the image. Without one every Google Drive option is hidden. See the [README](https://github.com/kevinmcaleer/puddle#development) for setting up the client.

## Browser support

Puddle runs in Chrome, Edge, Firefox and Safari. Only Chrome and Edge keep access to files between visits, so in Firefox and Safari each file is chosen again when a project reopens.
