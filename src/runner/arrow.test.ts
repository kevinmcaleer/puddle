import { Int32, Table, tableToIPC, TimestampMillisecond, vectorFromArray } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { sheetToIPC } from '../excel/arrow';
import { stagingOf, stagingRows } from './arrow';

describe('a driver’s Arrow stream staged for native DuckDB', () => {
  it('gives each column the DuckDB type its Arrow type stands for, and the values the appender takes, nulls kept', () => {
    const ipc = sheetToIPC([
      { name: 'id', type: 'BIGINT', values: [1, 2, null] },
      { name: 'total', type: 'DOUBLE', values: [5.5, null, 120] },
      { name: 'signed_up', type: 'DATE', values: [19737, null, 0] },
      { name: 'placed_at', type: 'TIMESTAMP', values: [1_706_000_000_123, null, 0] },
      { name: 'active', type: 'BOOLEAN', values: [true, false, null] },
      { name: 'name', type: 'VARCHAR', values: ['Ada', null, ''] },
      { name: 'avatar', type: 'BLOB', values: [new Uint8Array([1, 2]), null, new Uint8Array()] },
    ]);
    const { table, columns } = stagingOf(ipc);
    expect(columns).toEqual([
      { name: 'id', sqlType: 'BIGINT' },
      { name: 'total', sqlType: 'DOUBLE' },
      { name: 'signed_up', sqlType: 'DATE' },
      { name: 'placed_at', sqlType: 'TIMESTAMP' },
      { name: 'active', sqlType: 'BOOLEAN' },
      { name: 'name', sqlType: 'VARCHAR' },
      { name: 'avatar', sqlType: 'BLOB' },
    ]);
    expect([...stagingRows(table, columns)]).toEqual([
      [1n, 5.5, 19737, 1_706_000_000_123_000n, true, 'Ada', new Uint8Array([1, 2])],
      [2n, null, null, null, false, null, null],
      [null, 120, 0, 0n, null, '', new Uint8Array()],
    ]);
  });

  it('stages a type the drivers don’t produce as its text, and scales other timestamp units to microseconds', () => {
    const withMs = new Table({ n: vectorFromArray([7, 8], new Int32()), when: vectorFromArray([new Date('2026-01-02T03:04:05.678Z'), null], new TimestampMillisecond()) });
    const { table, columns } = stagingOf(tableToIPC(withMs, 'stream'));
    expect(columns).toEqual([
      { name: 'n', sqlType: 'BIGINT' },
      { name: 'when', sqlType: 'TIMESTAMP' },
    ]);
    expect([...stagingRows(table, columns)]).toEqual([
      [7n, BigInt(Date.parse('2026-01-02T03:04:05.678Z')) * 1000n],
      [8n, null],
    ]);
  });
});
