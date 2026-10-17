// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cellText, columnNames, findTables, likeliestTable, parseHtml, pickTable, tableSize, tableToCsv } from './html';

const tables = (html: string) => findTables(parseHtml(html));
const bond = () => tables(readFileSync(join(__dirname, '../../tests/fixtures/bond-films.html'), 'utf8'));

describe('finding the tables on a page', () => {
  it('reads Wikipedia’s list of Bond films: two-row header, an actor spanning rows, footnotes and sort keys dropped', () => {
    const found = bond();
    // The infobox, the two film tables; the navbox is left out.
    expect(found.map((t) => t.label)).toEqual(['Table 1', 'Eon Productions films', 'Non-Eon films']);
    const eon = found[1]!;
    expect(eon.columns).toEqual(['Title', 'Year', 'Bond actor', 'Director', 'Box office (US$ millions) Actual']);
    expect(eon.rows).toHaveLength(25);
    expect(eon.rows[0]).toEqual(['Dr. No', '1962', 'Sean Connery', 'Terence Young', '59.5']);
    expect(eon.rows[4]).toEqual(['You Only Live Twice', '1967', 'Sean Connery', 'Lewis Gilbert', '111.6']);
    expect(eon.rows[5]![2]).toBe('George Lazenby');
    expect(eon.rows[24]).toEqual(['No Time to Die', '2021', 'Daniel Craig', 'Cary Joji Fukunaga', '774.2']);
    expect(likeliestTable(found)).toBe(eon);
    expect(tableSize(eon)).toBe('25 rows, 5 columns');
  });

  it('names a table by its caption, else the heading above it, numbering tables that share one', () => {
    const t = tables(`
      <h2>Prices</h2><table><tr><th>A</th></tr><tr><td>1</td></tr></table><table><tr><th>B</th></tr><tr><td>2</td></tr></table>
      <h3>Other</h3><table><caption>Totals <sup class="reference">[1]</sup></caption><tr><th>C</th></tr><tr><td>3</td></tr></table>`);
    expect(t.map((x) => x.label)).toEqual(['Prices (1)', 'Prices (2)', 'Totals']);
  });

  it('spreads cells across colspan and rowspan, and pads short rows', () => {
    const [t] = tables(`<table>
      <thead><tr><th rowspan="2">Region</th><th colspan="2">Sales</th></tr><tr><th>2025</th><th>2026</th></tr></thead>
      <tbody><tr><td rowspan="2">North</td><td>1</td><td>2</td></tr><tr><td colspan="2">n/a</td></tr><tr><td>South</td><td>5</td></tr></tbody>
    </table>`);
    expect(t!.columns).toEqual(['Region', 'Sales 2025', 'Sales 2026']);
    expect(t!.rows).toEqual([
      ['North', '1', '2'],
      ['North', 'n/a', 'n/a'],
      ['South', '5', ''],
    ]);
  });

  it('takes the first row as the header when none is marked up, and names blank and repeated headers', () => {
    const [t] = tables('<table><tr><td>Name</td><td></td><td>Name</td></tr><tr><td>a</td><td>b</td><td>c</td></tr></table>');
    expect(t!.columns).toEqual(['Name', 'Column 2', 'Name 2']);
    expect(columnNames([['x', 'x'], ['', 'y']], 3)).toEqual(['x', 'x y', 'Column 3']);
  });

  it('leaves out layout tables, tables with no rows, and reads nested tables on their own', () => {
    const t = tables(`
      <table role="presentation"><tr><td>layout</td></tr><tr><td>x</td></tr></table>
      <table class="ambox"><tr><td>notice</td></tr><tr><td>x</td></tr></table>
      <table><tr><th>Only a header</th></tr></table>
      <table><tr><th>Outer</th></tr><tr><td><table><tr><th>Inner</th></tr><tr><td>i</td></tr></table></td></tr></table>`);
    expect(t.map((x) => x.columns)).toEqual([['Outer'], ['Inner']]);
    expect(t[0]!.rows).toEqual([['Inner i']]);
  });

  it('reads a cell as it shows: line breaks as spaces, hidden text and scripts dropped, spaces collapsed', () => {
    const cell = parseHtml('<table><tr><td> a<br>b&nbsp; c<span style="display:none">x</span><script>y</script></td></tr></table>').querySelector('td')!;
    expect(cellText(cell)).toBe('a b c');
  });
});

describe('finding the table again', () => {
  const found = bond();
  it('by its label when tables above it come or go, else by its place', () => {
    expect(pickTable(found.slice(1).map((t, i) => ({ ...t, index: i })), { index: 1, label: 'Eon Productions films' })!.label).toBe('Eon Productions films');
    expect(pickTable(found, { index: 2, label: 'Renamed' })!.label).toBe('Non-Eon films');
    expect(pickTable(found, { index: 9, label: 'Gone' })).toBeUndefined();
  });
});

describe('writing a table as CSV', () => {
  it('quotes values with commas, quotes, line breaks or edge spaces', () => {
    expect(tableToCsv({ columns: ['a', 'b,c'], rows: [['say "hi"', ' x'], ['1', '2']] })).toBe('a,"b,c"\n"say ""hi"""," x"\n1,2\n');
  });
});
