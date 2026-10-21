import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { likeliestTable, readWordTables, readWordXml, wordTableInfo, wordTableLabel, wordTableToRows } from './read';

const report = () => new Uint8Array(readFileSync(join(__dirname, '../../tests/fixtures/word/report.docx')));

describe('reading the tables of a Word document', () => {
  it('finds every table in the fixture, labelled by its heading, its caption or its number', async () => {
    const tables = await readWordTables(report());
    expect(tables.map(wordTableInfo)).toEqual([
      { index: 1, label: 'Sales by region', rows: 5, columns: 3 },
      { index: 2, label: 'Figures are in thousands.', rows: 1, columns: 1 },
      { index: 3, label: 'Table 2: Staff at the end of June', rows: 4, columns: 4 },
    ]);
    expect(wordTableLabel(wordTableInfo(tables[0]!))).toBe('Sales by region (5 rows, 3 columns)');
    expect(likeliestTable(tables)?.index).toBe(3);
  });

  it('repeats a cell merged down rows and across columns, and joins the paragraphs and tabs of a cell', async () => {
    const tables = await readWordTables(report());
    expect(tables[0]!.cells).toEqual([
      ['Region', 'Quarter', 'Amount'],
      ['North', 'Q1', '120'],
      ['North', 'Q2', '130.5'],
      ['South', 'Q1', '80'],
      ['South', 'Q2', ''],
    ]);
    expect(tables[2]!.cells).toEqual([
      ['Name', 'Role & team', 'Role & team', 'Started'],
      ['Ada', 'Engineer', 'Data', '2024-03-01'],
      ['Grace née Hopper', 'Lead', 'Data', '2023-11-15'],
      ['Linus', 'Engineer (contract)', 'Platform', '2025-06-30'],
    ]);
  });

  it('takes the first row as the column names, made unique, or numbers the columns', async () => {
    const tables = await readWordTables(report());
    expect(wordTableToRows(tables[2]!)).toEqual({
      columns: ['Name', 'Role & team', 'Role & team 2', 'Started'],
      rows: [
        ['Ada', 'Engineer', 'Data', '2024-03-01'],
        ['Grace née Hopper', 'Lead', 'Data', '2023-11-15'],
        ['Linus', 'Engineer (contract)', 'Platform', '2025-06-30'],
      ],
    });
    expect(wordTableToRows(tables[1]!, { header: false })).toEqual({ columns: ['Column 1'], rows: [['Note: the South Q2 figure was not available when this report was written.']] });
  });

  it('reads a nested table as its cell’s text, pads a short row, names a table by a long paragraph only when short, and leaves deleted text out', async () => {
    const xml = `<w:document xmlns:w="w"><w:body>
      <w:p><w:r><w:t>${'x'.repeat(100)}</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:tbl><w:tr><w:tc><w:p><w:r><w:t>in</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>side</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>after</w:t></w:r><w:del><w:r><w:delText>gone</w:delText></w:r></w:del></w:p></w:tc></w:tr></w:tbl>
    </w:body></w:document>`;
    const tables = await readWordXml(xml);
    expect(tables).toEqual([{ index: 1, label: 'Table 1', cells: [['a', 'b'], ['in side after', '']] }]);
  });

  it('says what a file that isn’t a Word document is', async () => {
    await expect(readWordTables(new Uint8Array([1, 2, 3]))).rejects.toThrow(/isn’t a Word document Puddle can read/);
    await expect(readWordXml('<a><b></a>')).rejects.toThrow(/This Word document can’t be read/);
  });
});
