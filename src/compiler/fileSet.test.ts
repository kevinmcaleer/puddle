import { describe, expect, it } from 'vitest';
import { src } from '../../tests/helpers/projects';
import { CompileError } from './errors';
import { fileSetFileName, fileSetMembers, fileSetNames, globMatches } from './fileSet';
import { sourceRelation } from './sources';

const file = (name: string, size = 10) => ({ name, size, lastModified: 1 });
const set = (names: string[], extra: { pattern?: string; fileColumn?: boolean } = {}, format: 'parquet' | 'csv' | 'xml' = 'parquet') => src({ id: 's1', kind: 'files', format, fileSet: { files: names.map((n) => file(n)), ...extra } });

describe('globs', () => {
  it('match a file’s own name, wherever it sits, unless the pattern names folders', () => {
    expect(globMatches('*.parquet', 'jan.parquet')).toBe(true);
    expect(globMatches('*.parquet', '2024/jan.parquet')).toBe(true);
    expect(globMatches('*.parquet', 'jan.csv')).toBe(false);
    expect(globMatches('2024/*.parquet', '2024/jan.parquet')).toBe(true);
    expect(globMatches('2024/*.parquet', '2025/jan.parquet')).toBe(false);
    expect(globMatches('**/*.csv', 'a/b/c.csv')).toBe(true);
    expect(globMatches('**/*.csv', 'c.csv')).toBe(true);
  });

  it('read ?, [ranges] and [!negations], ignore case, and treat other characters literally', () => {
    expect(globMatches('log-?.csv', 'log-1.csv')).toBe(true);
    expect(globMatches('log-[0-9].csv', 'LOG-7.CSV')).toBe(true);
    expect(globMatches('log-[!0-9].csv', 'log-7.csv')).toBe(false);
    expect(globMatches('a+b (1).csv', 'a+b (1).csv')).toBe(true);
    expect(globMatches('a.csv', 'abcsv')).toBe(false);
  });
});

describe('a file set', () => {
  it('reads the files its pattern keeps, or all of them', () => {
    expect(fileSetMembers(set(['a.parquet', 'users.parquet'])).map((f) => f.name)).toEqual(['a.parquet', 'users.parquet']);
    expect(fileSetMembers(set(['log-1.parquet', 'users.parquet'], { pattern: 'log-*' })).map((f) => f.name)).toEqual(['log-1.parquet']);
  });

  it('registers each file under a name that follows the file, keeping its extension', () => {
    const a = fileSetFileName('s1', file('2024/jan.parquet'));
    expect(a).toMatch(/^src_s1_[0-9a-f]{12}\.parquet$/);
    expect(fileSetFileName('s1', file('2024/jan.parquet', 11))).not.toBe(a);
    expect(fileSetFileName('s1', file('x.csv.gz'))).toMatch(/\.csv\.gz$/);
  });

  it('is read as one table, columns lined up by name', () => {
    const names = fileSetNames(set(['a.parquet', 'b.parquet']));
    expect(sourceRelation(set(['a.parquet', 'b.parquet']))).toBe(`read_parquet(['${names[0]}', '${names[1]}'], union_by_name = true)`);
    expect(sourceRelation(set(['a.csv'], {}, 'csv'))).toMatch(/^read_csv\(\['src_s1_[0-9a-f]{12}\.csv'\], union_by_name = true, null_padding = true\)$/);
  });

  it('names each row’s file as chosen when asked, never as registered', () => {
    const sql = sourceRelation(set(['a.parquet'], { fileColumn: true }));
    expect(sql).toContain(`filename = '__puddle_file'`);
    expect(sql).toContain(`THEN 'a.parquet' END AS "file"`);
    expect(sql).toContain('EXCLUDE ("__puddle_file")');
  });

  it('says so when it has no files, when its pattern leaves none, or it isn’t a kind of file a set reads', () => {
    expect(() => sourceRelation(set([]))).toThrow(/has no files/);
    expect(() => sourceRelation(set(['a.parquet'], { pattern: '*.csv' }))).toThrow(new CompileError('No file of s1 matches *.csv. Change the pattern, or choose the files again.'));
    expect(() => sourceRelation(set(['a.xml'], {}, 'xml'))).toThrow(/can’t read xml files as a set/);
  });
});
