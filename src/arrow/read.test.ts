import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Bool, DateMillisecond, Dictionary, Field, Int32, Int64, List, Struct, Table, TimestampMicrosecond, Utf8, vectorFromArray } from 'apache-arrow';
import { columnsToCsv } from '../access/csv';
import { arrowColumns, arrowColumnType, readArrowFile } from './read';

const fixture = new Uint8Array(readFileSync(join(__dirname, '../../tests/fixtures/archives/customers.arrow')));

describe('reading an Arrow file', () => {
  it('reads the fixture’s typed columns, dates as days and values as they are', () => {
    const table = readArrowFile(fixture);
    expect(table.numRows).toBe(4);
    const columns = arrowColumns(table);
    expect(columns.map((c) => [c.name, c.type])).toEqual([
      ['id', 'BIGINT'],
      ['name', 'VARCHAR'],
      ['joined', 'DATE'],
      ['balance', 'DOUBLE'],
      ['active', 'BOOLEAN'],
    ]);
    expect(columns.map((c) => c.values)).toEqual([
      [1, 2, 3, 4],
      ['Ada', 'Grace', 'Linus', 'Margaret'],
      [Date.UTC(2026, 0, 5) / 86_400_000, Date.UTC(2026, 1, 10) / 86_400_000, null, Date.UTC(2026, 2, 31) / 86_400_000],
      [12.5, 8, null, 42.25],
      [true, true, false, null],
    ]);
    expect(columnsToCsv(columns).split('\n').slice(0, 2)).toEqual(['"id","name","joined","balance","active"', '1,"Ada",2026-01-05,12.5,true']);
  });

  it('types dictionaries by their values, keeps big whole numbers exact, and writes structured values as JSON', () => {
    const table = new Table({
      code: vectorFromArray(['a', 'b'], new Dictionary(new Utf8(), new Int32())),
      big: vectorFromArray([9007199254740993n, null], new Int64()),
      at: vectorFromArray([new Date(Date.UTC(2026, 0, 5, 9, 30)), null], new TimestampMicrosecond()),
      day: vectorFromArray([new Date(Date.UTC(2026, 0, 5, 9, 30)), null], new DateMillisecond()),
      tags: vectorFromArray([[1, 2], null], new List(new Field('x', new Int32()))),
      pair: vectorFromArray([{ a: 1 }, null], new Struct([new Field('a', new Int32())])),
      ok: vectorFromArray([true, null], new Bool()),
    });
    const columns = arrowColumns(table);
    expect(columns.map((c) => c.type)).toEqual(['VARCHAR', 'BIGINT', 'TIMESTAMP', 'DATE', 'VARCHAR', 'VARCHAR', 'BOOLEAN']);
    expect(columns.map((c) => c.values[0])).toEqual(['a', '9007199254740993', Date.UTC(2026, 0, 5, 9, 30), Date.UTC(2026, 0, 5) / 86_400_000, '[1,2]', '{"a":1}', true]);
    expect(columns.map((c) => c.values[1])).toEqual(['b', null, null, null, null, null, null]);
    expect(arrowColumnType(new Int32())).toBe('BIGINT');
  });

  it('says plainly when the bytes aren’t Arrow', () => {
    expect(() => readArrowFile(new TextEncoder().encode('a,b\n1,2\n'))).toThrow(/This file isn’t an Arrow IPC file Puddle can read \(.*\)\. Save it again as an Arrow or Feather file, or export it as Parquet or CSV\./);
  });
});
