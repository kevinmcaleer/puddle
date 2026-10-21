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

The image does all of this already. It also serves:

- This user guide at `/docs/`, built from `docs/` when the image is built. **Help**, then **User guide** opens it.
- The {doc}`taxi tutorial's <tutorial-taxi>` two files at `/tutorial-data/`, passed through from the TLC's site (whose own server doesn't let browsers read them) as the browser reads them. Nothing is kept on the server, but the container needs to reach the internet for **Start the taxi tutorial** to work. Every other path under `/tutorial-data/` answers 404.

## Scheduled runs

`puddle-run` is a second, small container that runs exported project files (`.puddle.json`) on a schedule, outside the browser, with the same compiler on DuckDB's native build. It watches a folder of project files, runs each one when its **Run on a schedule** setting says, and writes every Output node's file, a run log and the quality report (as Markdown, JSON and HTML, the same report as **Write quality report** in the editor) into an `out/` folder beside them. `docker compose --profile runner up -d` starts it with `PUDDLE_PROJECTS` pointing at the folder; the [deployment README](https://github.com/kevinmcaleer/puddle/blob/main/deploy/README.md#scheduled-runs-puddle-run) has the details, and `puddle-run check <file>` says where a project's sources were found, whether any file has stopped looking like the format the project reads it as, which database connections still need a secret, and when it would next run. Connection sources are read with the drivers built in; their secrets come from `PUDDLE_SECRET_<NAME>` variables or the JSON file `PUDDLE_SECRETS` names, never from the project file. `puddle-run analyse <file>` lists the issues the editor's Issues panel would find in a file, with no project. `puddle-run schema <file> --check` checks a schema's DBML and can write its SQL, docs or a migration, for a CI pipeline; the deployment README has a GitHub Actions example.

## Google Drive sync

Google Drive sync needs a Google Cloud OAuth client ID at build time: `--build-arg VITE_GOOGLE_CLIENT_ID=...` for the image. Without one every Google Drive option is hidden. See the [README](https://github.com/kevinmcaleer/puddle#development) for setting up the client.

## Browser support

Puddle runs in Chrome, Edge, Firefox and Safari. Only Chrome and Edge keep access to files between visits, so in Firefox and Safari the files are chosen again, all in one go, when a project reopens.
