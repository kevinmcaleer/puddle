#!/usr/bin/env node
// Download the New York taxi tutorial's files from the NYC Taxi and Limousine Commission (TLC), for its screenshots
// (docs/screenshots/tutorial.spec.ts). They are too big to keep in the repository. Files already there are kept.
// Usage: node scripts/fetch-tutorial-data.mjs [outDir]
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = 'https://d37ci6vzurychx.cloudfront.net';
const FILES = ['trip-data/yellow_tripdata_2024-01.parquet', 'misc/taxi_zone_lookup.csv'];
const out = process.argv[2] ?? 'docs/_data';

mkdirSync(out, { recursive: true });
for (const path of FILES) {
  const file = join(out, path.split('/').pop());
  if (existsSync(file)) {
    console.log(`${file}: already there`);
    continue;
  }
  const res = await fetch(`${SOURCE}/${path}`);
  if (!res.ok) throw new Error(`Couldn't download ${SOURCE}/${path}: ${res.status} ${res.statusText}`);
  const body = new Uint8Array(await res.arrayBuffer());
  // Written under another name first, so a download cut short isn't taken for the file next time.
  writeFileSync(`${file}.part`, body);
  renameSync(`${file}.part`, file);
  console.log(`${file}: ${(body.length / 1e6).toFixed(1)} MB`);
}
