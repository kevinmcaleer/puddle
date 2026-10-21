import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipEntryName, isDataEntry, listEntries, readEntry, readEntryHead } from './index';
import { listZip, readZipEntry, zipEntry } from './zip';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, '../../tests/fixtures/archives', name)));
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const orders = readFileSync(join(__dirname, '../../tests/fixtures/shop-orders.csv'), 'utf8');

describe('zip', () => {
  it('lists the files of an archive from its directory, folders left out', () => {
    expect(listZip(fixture('shop.zip')).map((e) => [e.name, e.method, e.size])).toEqual([
      ['shop/orders.csv', 8, orders.length],
      ['shop/customers.csv', 0, 104],
      ['__MACOSX/shop/._orders.csv', 8, 17],
      ['shop/.DS_Store', 0, 4],
    ]);
  });

  it('unpacks a deflated and a stored entry', async () => {
    const bytes = fixture('shop.zip');
    const entries = listZip(bytes);
    expect(text(await readZipEntry(bytes, zipEntry(entries, 'shop/orders.csv')))).toBe(orders);
    expect(text(await readZipEntry(bytes, zipEntry(entries, 'shop/customers.csv')))).toMatch(/^customer_id,name,status\n1,Ada/);
  });

  it('names the archive’s files when an entry isn’t there, and says when the directory is missing', () => {
    const entries = listZip(fixture('orders.zip'));
    expect(() => zipEntry(entries, 'nope.csv')).toThrow('nope.csv isn’t in this zip archive (it holds orders.csv).');
    expect(() => listZip(fixture('orders.zip').subarray(0, 40))).toThrow('its directory is missing');
    expect(() => listZip(fixture('orders.csv.gz'))).toThrow('its directory is missing');
  });
});

describe('archives', () => {
  it('names a gzip’s one entry for the file and puts data files before a zip’s junk', async () => {
    expect(gzipEntryName('orders.csv.gz')).toBe('orders.csv');
    expect(gzipEntryName('orders.CSV.GZIP')).toBe('orders.CSV');
    expect(isDataEntry('__MACOSX/shop/._orders.csv')).toBe(false);
    expect(isDataEntry('shop/.DS_Store')).toBe(false);
    expect(isDataEntry('shop/orders.csv')).toBe(true);
    expect(await listEntries(fixture('orders.csv.gz'), 'gzip', 'orders.csv.gz')).toEqual([{ name: 'orders.csv' }]);
    expect((await listEntries(fixture('shop.zip'), 'zip', 'shop.zip')).map((e) => e.name)).toEqual(['shop/orders.csv', 'shop/customers.csv', '__MACOSX/shop/._orders.csv', 'shop/.DS_Store']);
  });

  it('reads the head of a gzip without the whole file, and the whole of it', async () => {
    const gz = fixture('orders.csv.gz');
    const partial = await readEntryHead(gz, 'gzip', 'orders.csv', 20);
    expect(text(partial.head)).toBe(orders.slice(0, 20));
    expect(partial.size).toBeUndefined();
    const whole = await readEntryHead(gz, 'gzip', 'orders.csv', 1 << 20);
    expect(text(whole.head)).toBe(orders);
    expect(whole.size).toBe(orders.length);
    expect(text(await readEntry(gz, 'gzip', 'orders.csv'))).toBe(orders);
    expect(text(await readEntry(new File([gz as Uint8Array<ArrayBuffer>], 'orders.csv.gz'), 'gzip', 'orders.csv'))).toBe(orders);
  });

  it('reads a zip entry’s head, size and tail from a File', async () => {
    const file = new File([fixture('shop.zip') as Uint8Array<ArrayBuffer>], 'shop.zip');
    const r = await readEntryHead(file, 'zip', 'shop/orders.csv', 10);
    expect(text(r.head)).toBe('order_id,c');
    expect(r.size).toBe(orders.length);
    expect(text(r.tail!)).toBe(orders.slice(-10));
  });
});
