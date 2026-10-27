// File sets: many files of one format read as one table, and the files a SQL node may read by name.
import { hashValue, type FileSetFile, type Source } from '../model';
import { CompileError } from './errors';

/** Formats a file set reads: those DuckDB reads straight from the files, several at a time. */
export const FILE_SET_FORMATS = ['parquet', 'csv', 'tsv', 'json', 'ndjson'] as const;

export const isFileSetFormat = (format: Source['format']): format is (typeof FILE_SET_FORMATS)[number] => (FILE_SET_FORMATS as readonly string[]).includes(format);

/**
 * A glob as a regular expression: `*` is any run of characters but `/`, `**` any run at all, `?` one character and
 * `[abc]` one of those. Case is ignored, as on Windows and macOS, so a pattern finds the same files wherever it runs.
 */
export function globRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // **/ also matches no folder at all.
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i++;
        }
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if (c === '[') {
      const end = pattern.indexOf(']', i + 2);
      if (end < 0) out += '\\[';
      else {
        const body = pattern.slice(i + 1, end).replace(/\\/g, '\\\\');
        out += body.startsWith('!') ? `[^${body.slice(1)}]` : `[${body}]`;
        i = end;
      }
    } else out += c.replace(/[.+^${}()|\\\]]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'i');
}

/**
 * Whether a file's name, as a path inside its set ("2024/jan.parquet"), matches a glob. A pattern without a `/` is
 * matched against the file's own name, wherever it sits, so `*.parquet` finds them in subfolders too.
 */
export function globMatches(pattern: string, name: string): boolean {
  const path = name.replace(/\\/g, '/').replace(/^\.\//, '');
  const re = globRegExp(pattern.replace(/\\/g, '/').replace(/^\.\//, ''));
  return re.test(pattern.includes('/') ? path : (path.split('/').pop() ?? path));
}

/** True when a string read as a file name is a pattern rather than one name. */
export const isGlob = (pattern: string) => /[*?[]/.test(pattern);

/** The files of a set that are read: those its pattern matches, or all of them. */
export function fileSetMembers(source: Pick<Source, 'fileSet'>): FileSetFile[] {
  const set = source.fileSet;
  if (!set) return [];
  const pattern = set.pattern?.trim();
  return pattern ? set.files.filter((f) => globMatches(pattern, f.name)) : set.files;
}

/** A file's extension as a registered name keeps it (DuckDB reads .gz as compressed), or `dat`. */
function extensionOf(name: string): string {
  const base = name.split('/').pop() ?? name;
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(base)?.[1]?.toLowerCase();
  const gz = /\.([A-Za-z0-9]{1,8})\.gz$/i.exec(base)?.[1]?.toLowerCase();
  return gz ? `${gz}.gz` : (ext ?? 'dat');
}

/**
 * The name one file of a set is registered under in DuckDB's file system: it follows the file's name, size and
 * modification time, so a file changed or chosen again under the same name is never mistaken for the old one.
 */
export function fileSetFileName(sourceId: string, file: FileSetFile): string {
  return `src_${sourceId}_${hashValue([file.name, file.size, file.lastModified]).slice(0, 12)}.${extensionOf(file.name)}`;
}

/** The registered names of a set's files that are read, in order; says so when its pattern leaves none. */
export function fileSetNames(source: Source): string[] {
  const members = fileSetMembers(source);
  if (!members.length) {
    const set = source.fileSet;
    if (!set?.files.length) throw new CompileError(`${source.name} has no files. Choose the files it reads.`);
    throw new CompileError(`No file of ${source.name} matches ${set.pattern}. Change the pattern, or choose the files again.`);
  }
  return members.map((f) => fileSetFileName(source.id, f));
}

/** The column a set's rows name their file in, when it's asked for. */
export const FILE_COLUMN = 'file';
