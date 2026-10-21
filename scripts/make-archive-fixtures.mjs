// Writes tests/fixtures/archives/: the compressed, zipped and Arrow fixtures for #192. orders.csv.gz holds
// shop-orders.csv gzipped; shop.zip holds shop-orders.csv (deflated) and shop-customers.csv (stored) with the folder
// and resource-fork junk a Mac zip carries; sales.xlsx.gz holds the Excel fixture, for a format that must be
// unpacked whole; customers.arrow is an Arrow IPC file (ARROW1) with typed columns. The zip is written here by hand
// (Node has no zip writer), so the test fixtures depend on nothing. Run with `node scripts/make-archive-fixtures.mjs`
// after changing it, and commit the files.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync, gzipSync } from 'node:zlib';
import { Bool, DateDay, Float64, Int32, tableToIPC, Table, Utf8, vectorFromArray } from 'apache-arrow';

const fixtures = fileURLToPath(new URL('../tests/fixtures/', import.meta.url));
const out = `${fixtures}archives/`;
mkdirSync(out, { recursive: true });
const write = (file, data) => {
  writeFileSync(out + file, data);
  console.log(`Wrote ${out}${file}`);
};

const orders = readFileSync(`${fixtures}shop-orders.csv`);
const customers = readFileSync(`${fixtures}shop-customers.csv`);

write('orders.csv.gz', gzipSync(orders));
write('sales.xlsx.gz', gzipSync(readFileSync(`${fixtures}sales.xlsx`)));

/** A zip from entries [name, bytes, method] (method 8 deflates, 0 stores); a name ending in / is a folder. */
function zip(entries) {
  const le16 = (n) => [n & 0xff, (n >> 8) & 0xff];
  const le32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, data, method] of entries) {
    const nameBytes = Buffer.from(name);
    const packed = method === 8 ? deflateRawSync(data) : data;
    const crc = data.length ? crc32(data) : 0;
    const fixed = [...le16(20), ...le16(0), ...le16(method), ...le16(0), ...le16(0x5021), ...le32(crc), ...le32(packed.length), ...le32(data.length), ...le16(nameBytes.length), ...le16(0)];
    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from(fixed), nameBytes, packed]);
    central.push(Buffer.concat([Buffer.from([0x50, 0x4b, 1, 2]), Buffer.from(le16(20)), Buffer.from(fixed), Buffer.from([...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(offset)]), nameBytes]));
    parts.push(local);
    offset += local.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.concat([Buffer.from([0x50, 0x4b, 5, 6]), Buffer.from([...le16(0), ...le16(0), ...le16(entries.length), ...le16(entries.length), ...le32(dir.length), ...le32(offset), ...le16(0)])]);
  return Buffer.concat([...parts, dir, end]);
}

write(
  'shop.zip',
  zip([
    ['shop/', Buffer.alloc(0), 0],
    ['shop/orders.csv', orders, 8],
    ['shop/customers.csv', customers, 0],
    ['__MACOSX/shop/._orders.csv', Buffer.from('Mac resource fork'), 8],
    ['shop/.DS_Store', Buffer.from('junk'), 0],
  ]),
);
// One file in a zip, with no folder: opens straight to it.
write('orders.zip', zip([['orders.csv', orders, 8]]));

const table = new Table({
  id: vectorFromArray([1, 2, 3, 4], new Int32()),
  name: vectorFromArray(['Ada', 'Grace', 'Linus', 'Margaret'], new Utf8()),
  joined: vectorFromArray([new Date(Date.UTC(2026, 0, 5)), new Date(Date.UTC(2026, 1, 10)), null, new Date(Date.UTC(2026, 2, 31))], new DateDay()),
  balance: vectorFromArray([12.5, 8, null, 42.25], new Float64()),
  active: vectorFromArray([true, true, false, null], new Bool()),
});
write('customers.arrow', tableToIPC(table, 'file'));
