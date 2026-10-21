// A zip writer for the fixture scripts (Node has none): the test fixtures depend on nothing.
import { crc32, deflateRawSync } from 'node:zlib';

/** A zip from entries [name, bytes, method] (method 8 deflates, 0 stores); a name ending in / is a folder. */
export function zip(entries) {
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
