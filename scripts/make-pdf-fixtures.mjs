// Writes tests/fixtures/pdf/statement.pdf: a two-page text PDF as a bank or a report prints one, written here by
// hand (uncompressed objects, Helvetica, text placed with Td/Tj) so the fixture depends on nothing. Page 1 has a
// title, a paragraph, a heading and a table of transactions with right-aligned amounts and an empty cell; page 2 a
// small second table under a heading and a closing line. Run with `node scripts/make-pdf-fixtures.mjs` and commit.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../tests/fixtures/pdf/', import.meta.url));
mkdirSync(out, { recursive: true });

const esc = (t) => t.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
/** Text at (x, y) in points from the bottom left, in Helvetica at `size`. */
const text = (x, y, t, size = 10) => `BT /F1 ${size} Tf ${x} ${y} Td (${esc(t)}) Tj ET`;
/** Helvetica's width of a text, roughly: 0.5 em a character, for right-aligning numbers. */
const right = (xRight, y, t, size = 10) => text(xRight - t.length * size * 0.5, y, t, size);

const page1 = [
  text(72, 760, 'Puddle Bank', 18),
  text(72, 736, 'Statement for account 12-34-56 00123456, 1 to 31 October 2026.'),
  text(72, 722, 'Keep this statement with your records. Interest is paid monthly.'),
  text(72, 690, 'Transactions', 13),
  // The header and the rows: date, description, amount in and amount out, with the amounts right-aligned.
  text(72, 668, 'Date'), text(150, 668, 'Description'), right(420, 668, 'Paid in'), right(500, 668, 'Paid out'),
  text(72, 650, '2026-10-01'), text(150, 650, 'Salary October'), right(420, 650, '2,450.00'),
  text(72, 632, '2026-10-03'), text(150, 632, 'Grocer on the corner'), right(500, 632, '48.20'),
  text(72, 614, '2026-10-10'), text(150, 614, 'Refund: lamp'), right(420, 614, '19.99'),
  text(72, 596, '2026-10-28'), text(150, 596, 'Rent'), right(500, 596, '1,100.00'),
  text(72, 560, 'Page 1 of 2', 8),
].join('\n');

const page2 = [
  text(72, 760, 'Summary', 13),
  text(72, 738, 'Item'), text(300, 738, 'Amount'),
  text(72, 720, 'Opening balance'), text(300, 720, '312.40'),
  text(72, 702, 'Closing balance'), text(300, 702, '1,634.19'),
  text(72, 670, 'Questions? Call us on 0800 000 000.'),
  text(72, 560, 'Page 2 of 2', 8),
].join('\n');

/** A PDF from page content streams: catalog, pages, one font, each page with its stream, and the xref table. */
function pdf(pages) {
  const objects = [];
  const add = (body) => objects.push(body) && objects.length;
  const catalog = add(null);
  const pagesObj = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const pageIds = pages.map((content) => {
    const stream = add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    return add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${stream} 0 R >>`);
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let body = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const file = `${out}statement.pdf`;
writeFileSync(file, pdf([page1, page2]));
console.log(`Wrote ${file}`);

// A scanned page: one image and no text at all, so the reader can say it has nothing to read.
const scan = [
  text(72, 760, '').slice(0, 0),
].join('');
const image = `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 4 >>\nstream\n\x00\xff\xff\x00\nendstream`;
function scanPdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [4 0 R] /Count 1 >>', image, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 3 0 R >> >> /Contents 5 0 R >>', `<< /Length 36 >>\nstream\nq 451 0 0 698 72 72 cm /Im1 Do Q\nendstream`];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
void scan;
writeFileSync(`${out}scan.pdf`, scanPdf());
console.log(`Wrote ${out}scan.pdf`);
