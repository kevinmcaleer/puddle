# Puddle as a static site: Node builds the app, nginx serves it. Multi-arch: the build stage runs on the
# builder's own platform (the output is plain files), and nginx's image exists for amd64 and arm64.

FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# The SheetJS tarball is vendored (its current releases are not on the npm registry).
COPY vendor ./vendor
RUN npm ci
COPY . .
# Bundle DuckDB's json and parquet extensions so the app never fetches them from extensions.duckdb.org.
# FETCH_EXTENSIONS=0 skips this where that site can't be reached; JSON and Parquet then fall back to it.
ARG FETCH_EXTENSIONS=1
ARG PUDDLE_BUILD
ENV PUDDLE_BUILD=$PUDDLE_BUILD
# Google Drive sync's OAuth client ID (see README, Development); without it the Drive option is hidden.
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN if [ "$FETCH_EXTENSIONS" = "1" ]; then node scripts/fetch-duckdb-extensions.mjs public/duckdb-extensions; fi \
 && npx vite build

# The user guide (docs/), built with Sphinx and served at /docs/. Its screenshots are committed, so no browser is needed.
FROM --platform=$BUILDPLATFORM python:3.12-alpine AS docs
WORKDIR /app
COPY docs/requirements.txt docs/
RUN pip install --no-cache-dir -r docs/requirements.txt
COPY docs ./docs
RUN python3 -m sphinx -W --keep-going -b html docs docs/_build/html

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/puddle-headers.inc /etc/nginx/conf.d/puddle-headers.inc
# Writes the container's DNS servers where nginx.conf reads them, for the taxi tutorial's pass-through to the TLC.
COPY --chmod=755 deploy/30-puddle-resolver.sh /docker-entrypoint.d/30-puddle-resolver.sh
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=docs /app/docs/_build/html /usr/share/nginx/html/docs
# Certificate authorities, so the pass-through can check it is talking to the TLC's real site.
COPY --from=docs /etc/ssl/certs/ca-certificates.crt /etc/nginx/puddle-ca-certificates.crt
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
