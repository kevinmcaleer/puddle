// An INI file as a plain object: sections as nested objects, keys as strings (numbers and booleans left as text,
// which DuckDB types like any CSV). Comments start with ; or #; a key before any section goes at the top level.

export type IniValue = string | IniSection;
export interface IniSection {
  [key: string]: IniValue;
}

const unquote = (v: string) => (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) ? v.slice(1, -1) : v);

/** Parse INI text. A section named "a.b" nests under "a" (as TOML does); a repeated key keeps its last value. */
export function parseIni(text: string): IniSection {
  const root: IniSection = {};
  let current = root;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const section = /^\[(.+)\]$/.exec(line);
    if (section) {
      current = root;
      for (const part of section[1]!.trim().split('.')) {
        const key = part.trim();
        const next = current[key];
        if (typeof next === 'object' && next) current = next;
        else current = current[key] = {};
      }
      continue;
    }
    const at = line.search(/[=:]/);
    if (at === -1) {
      current[line] = '';
      continue;
    }
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    // A trailing comment after a space; inside quotes it is part of the value.
    if (!/^["']/.test(value)) value = value.replace(/\s+[;#].*$/, '');
    current[key] = unquote(value);
  }
  return root;
}
