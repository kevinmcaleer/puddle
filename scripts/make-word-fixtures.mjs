// Writes tests/fixtures/word/report.docx: a Word document with a title, a paragraph, a heading and three tables, as
// Word writes them (word/document.xml in a zip). Table 1 "Sales by region" has a cell merged down two rows
// (w:vMerge) and a numeric column; table 2 is a one-cell layout box holding a note; table 3 has a caption below it,
// a header cell merged across two columns (w:gridSpan), a cell of two paragraphs and a tab. Run with
// `node scripts/make-word-fixtures.mjs` after changing it, and commit the file.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zip } from './zip.mjs';

const out = fileURLToPath(new URL('../tests/fixtures/word/', import.meta.url));
mkdirSync(out, { recursive: true });

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const run = (t) => `<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
const p = (t, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${t ? run(t) : ''}</w:p>`;
/** A cell: its paragraphs' text (or a paragraph's own XML as { xml }), and the merge properties Word writes. */
const tc = (paragraphs, props = '') => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${props}</w:tcPr>${paragraphs.map((t) => (typeof t === 'string' ? p(t) : t.xml)).join('')}</w:tc>`;
const tr = (cells) => `<w:tr>${cells.join('')}</w:tr>`;
const tbl = (rows) => `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>${rows.join('')}</w:tbl>`;

const body = [
  p('Quarterly report', 'Title'),
  p('Figures for the first half of the year, by region. The totals are in the appendix.'),
  p('Sales by region', 'Heading1'),
  tbl([
    tr([tc(['Region']), tc(['Quarter']), tc(['Amount'])]),
    tr([tc(['North'], '<w:vMerge w:val="restart"/>'), tc(['Q1']), tc(['120'])]),
    tr([tc([''], '<w:vMerge/>'), tc(['Q2']), tc(['130.5'])]),
    tr([tc(['South']), tc(['Q1']), tc(['80'])]),
    tr([tc(['South']), tc(['Q2']), tc([''])]),
  ]),
  p('Figures are in thousands.'),
  tbl([tr([tc(['Note: the South Q2 figure was not available when this report was written.'])])]),
  p('Staff', 'Heading1'),
  tbl([
    tr([tc(['Name']), tc(['Role & team'], '<w:gridSpan w:val="2"/>'), tc(['Started'])]),
    tr([tc(['Ada']), tc(['Engineer']), tc(['Data']), tc(['2024-03-01'])]),
    tr([tc(['Grace', 'née Hopper']), tc(['Lead']), tc(['Data']), tc(['2023-11-15'])]),
    tr([tc(['Linus']), tc([{ xml: '<w:p><w:r><w:t>Engineer</w:t></w:r><w:r><w:tab/><w:t>(contract)</w:t></w:r></w:p>' }]), tc(['Platform']), tc(['2025-06-30'])]),
  ]),
  p('Table 2: Staff at the end of June', 'Caption'),
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>',
].join('');

const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const file = `${out}report.docx`;
writeFileSync(
  file,
  zip([
    ['[Content_Types].xml', Buffer.from(contentTypes), 8],
    ['_rels/.rels', Buffer.from(rels), 8],
    ['word/document.xml', Buffer.from(document), 8],
  ]),
);
console.log(`Wrote ${file}`);
