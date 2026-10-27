// The runner's view of a folder on disk, for file sets.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FileSetFile } from '../model';

/** Every file in a folder and its subfolders, as paths inside it ("2024/jan.parquet"), with sizes and times. */
export function listFolder(dir: string): FileSetFile[] {
  const out: FileSetFile[] = [];
  const walk = (at: string, prefix: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path, name);
      else if (entry.isFile() || entry.isSymbolicLink()) {
        const stat = statSync(path, { throwIfNoEntry: false });
        if (stat?.isFile()) out.push({ name, size: stat.size, lastModified: Math.round(stat.mtimeMs) });
      }
    }
  };
  walk(dir, '');
  return out;
}
