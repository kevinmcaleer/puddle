// DuckDB's json and parquet extensions, served by Puddle itself when the build includes them
// (scripts/fetch-duckdb-extensions.mjs), so loading those formats never contacts extensions.duckdb.org.
import { z } from 'zod';

export const EXTENSIONS_DIR = 'duckdb-extensions';

const ManifestZ = z.object({ version: z.string().min(1), platforms: z.array(z.string()), extensions: z.array(z.string()) });
export type ExtensionManifest = z.infer<typeof ManifestZ>;

/**
 * The repository URL to give DuckDB, or undefined to keep its default: when the manifest is missing, malformed,
 * or built for another DuckDB version or platform, DuckDB would ask for files that aren't there.
 */
export function repositoryFor(manifest: unknown, version: string, platform: string, base: string): string | undefined {
  const m = ManifestZ.safeParse(manifest);
  if (!m.success || m.data.version !== version || !m.data.platforms.includes(platform)) return undefined;
  return new URL(EXTENSIONS_DIR, base).href;
}

/** Read the build's extension manifest, if it has one. */
export async function selfHostedRepository(version: string, platform: string, base: string, get: typeof fetch = fetch): Promise<string | undefined> {
  try {
    const res = await get(new URL(`${EXTENSIONS_DIR}/manifest.json`, base).href, { cache: 'no-cache' });
    if (!res.ok) return undefined;
    return repositoryFor(await res.json(), version, platform, base);
  } catch {
    return undefined;
  }
}
