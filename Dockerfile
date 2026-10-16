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

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/puddle-headers.inc /etc/nginx/conf.d/puddle-headers.inc
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
