import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expandCandidates, pathLabel, scanXml, tableToCsv, xmlElements, xmlToTable } from './records';

const books = () => readFileSync(join(__dirname, '../../tests/fixtures/books.xml'), 'utf8');

/** An OData v2 feed, which is Atom: the records are <entry>, the values under content › properties. */
const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xml:base="https://example.org/odata/" xmlns="http://www.w3.org/2005/Atom" xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
  <title type="text">Products</title>
  <entry>
    <id>https://example.org/odata/Products(1)</id>
    <link rel="edit" href="Products(1)" />
    <link rel="related" href="Products(1)/Category" />
    <content type="application/xml"><m:properties><d:ID m:type="Edm.Int32">1</d:ID><d:Name>Bread</d:Name><d:Price m:type="Edm.Decimal">2.5</d:Price></m:properties></content>
  </entry>
  <entry>
    <id>https://example.org/odata/Products(2)</id>
    <link rel="edit" href="Products(2)" />
    <link rel="related" href="Products(2)/Category" />
    <content type="application/xml"><m:properties><d:ID m:type="Edm.Int32">2</d:ID><d:Name>Milk</d:Name><d:Price m:type="Edm.Decimal" m:null="true" /></m:properties></content>
  </entry>
</feed>`;

describe('finding the records in an XML document', () => {
  it('offers repeating elements with fields first, shallowest first, with how many there are', async () => {
    const shape = await scanXml(books());
    expect(shape.root).toBe('catalog');
    expect(shape.candidates).toEqual([
      { path: 'catalog/book', count: 3, fields: 7 },
      { path: 'catalog/book/author', count: 4, fields: 0 },
    ]);
    expect(expandCandidates(shape, 'catalog/book').map((c) => c.path)).toEqual(['author']);
    expect(pathLabel('catalog/book')).toBe('catalog › book');
  });

  it('picks the Atom entries over their more numerous links', async () => {
    const shape = await scanXml(ATOM);
    expect(shape.candidates.map((c) => c.path)).toEqual(['feed/entry', 'feed/entry/link']);
  });

  it('reads a document whose single record repeats nothing', async () => {
    const shape = await scanXml('<config><server host="a" port="1"/></config>');
    expect(shape.candidates).toEqual([{ path: 'config/server', count: 1, fields: 2 }]);
    expect((await xmlToTable('<config><server host="a" port="1"/></config>')).rows).toEqual([['a', '1']]);
    expect((await scanXml('<only>text</only>')).candidates).toEqual([{ path: 'only', count: 1, fields: 0 }]);
  });
});

describe('reading records as rows', () => {
  it('flattens attributes and child elements into columns, keeps text as written, and puts repeats in JSON', async () => {
    const t = await xmlToTable(books());
    expect(t.record).toBe('catalog/book');
    expect(t.columns).toEqual(['id', 'format', 'title', 'published', 'price', 'price.currency', 'author', 'stock']);
    expect(t.rows).toEqual([
      ['bk101', 'paperback', '  Emma ', '1815-12-23', '8.99', 'GBP', '["Jane Austen"]', '12'],
      ['bk102', '', 'Good Omens', '1990-05-10', '9.50', 'GBP', '["Terry Pratchett","Neil Gaiman"]', '0'],
      ['bk103', 'hardback', 'Dracula & other stories', '1897-05-26', '12.00', 'USD', '["Bram Stoker"]', '3'],
    ]);
  });

  it('gives each repeat inside a record a row of its own, the record’s values repeated', async () => {
    const t = await xmlToTable(books(), { expand: 'author' });
    expect(t.expand).toBe('author');
    expect(t.rows.map((r) => [r[0], r[6]])).toEqual([
      ['bk101', 'Jane Austen'],
      ['bk102', 'Terry Pratchett'],
      ['bk102', 'Neil Gaiman'],
      ['bk103', 'Bram Stoker'],
    ]);
    // A record with none of them keeps one row, with the expanded columns empty.
    const none = await xmlToTable('<r><x a="1"><y>p</y><y>q</y></x><x a="2"/></r>', { expand: 'y' });
    expect(none.columns).toEqual(['a', 'y']);
    expect(none.rows).toEqual([['1', 'p'], ['1', 'q'], ['2', '']]);
  });

  it('reads another repeating element as the records when asked', async () => {
    const t = await xmlToTable(books(), { record: 'catalog/book/author' });
    expect(t.columns).toEqual(['author']);
    expect(t.rows.flat()).toEqual(['Jane Austen', 'Terry Pratchett', 'Neil Gaiman', 'Bram Stoker']);
  });

  it('flattens nested elements by path, objects in JSON arrays, and tells clashing names apart', async () => {
    const t = await xmlToTable(ATOM);
    expect(t.columns).toEqual(['id', 'link', 'content.type', 'content.properties.ID', 'content.properties.ID.type', 'content.properties.Name', 'content.properties.Price', 'content.properties.Price.type', 'content.properties.Price.null']);
    expect(t.rows[0]!.slice(0, 2)).toEqual(['https://example.org/odata/Products(1)', '[{"rel":"edit","href":"Products(1)"},{"rel":"related","href":"Products(1)/Category"}]']);
    expect(t.rows[1]!.slice(5)).toEqual(['Milk', '', 'Edm.Decimal', 'true']);

    const clash = await xmlToTable('<r><x name="a"><name>b</name></x><x name="c"><name>d</name></x></r>');
    expect(clash.columns).toEqual(['name', 'name 2']);
    expect(clash.rows).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('streams the elements at a path as trees, for readers with their own mapping (OData)', async () => {
    const names: string[] = [];
    for await (const entry of xmlElements(ATOM, 'feed/entry')) {
      const props = entry.children.find((c) => c.name === 'content')!.children[0]!;
      names.push(props.children.find((c) => c.name === 'Name')!.text);
    }
    expect(names).toEqual(['Bread', 'Milk']);
    await expect(async () => {
      for await (const _ of xmlElements(ATOM, 'feed/item')) void _;
    }).rejects.toThrow('There are no feed › item elements in this XML. Choose another record element.');
  });

  it('writes CSV with a header row, quoting what needs it', async () => {
    expect(tableToCsv({ columns: ['a', 'b'], rows: [[' x', 'say "hi", twice'], ['1\n2', '']] })).toBe('a,b\n" x","say ""hi"", twice"\n"1\n2",\n');
  });
});
