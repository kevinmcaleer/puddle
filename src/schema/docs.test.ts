import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultDocsTokens, DOCS_TOKENS, writeDocsHtml, writeDocsMarkdown } from './docs';
import { parseDbml } from './parse';

const fixture = (name: string) => parseDbml(readFileSync(`tests/fixtures/dbml/${name}.dbml`, 'utf8')).schema;
const shop = fixture('shop');
const tokens = defaultDocsTokens();
const html = (schema = shop, views: { name: string; svg: string }[] = []) => writeDocsHtml(schema, { title: 'Shop schema', views, tokens });

/** Every src and href that points off the page. */
const external = (page: string) => [...page.matchAll(/\s(?:src|href|xlink:href)\s*=\s*["']?\s*(?:https?:)?\/\//gi)].map((m) => m[0]);

describe('schema docs as HTML', () => {
  it('writes the shop schema as it was', async () => {
    await expect(html()).toMatchFileSnapshot('__snapshots__/shop.docs.html');
  });

  it('is byte-identical for the same input', () => {
    expect(html()).toBe(html(fixture('shop')));
  });

  it('anchors each table and lists it in the contents, with its columns and settings', () => {
    const page = html();
    for (const t of ['customers', 'orders', 'products', 'order_items']) {
      expect(page).toContain(`<section id="table-${t}" class="docs-card"`);
      expect(page).toContain(`<a href="#table-${t}"><code>${t}</code></a>`);
    }
    expect(page).toContain('<tr><td><code>email</code></td><td><code>varchar(255)</code></td><td><span class="docs-tag">not null</span><span class="docs-tag">unique</span></td>');
    expect(page).toContain('<td><code>&#39;GB&#39;</code></td>');
    expect(page).toContain('<span class="docs-tag">check: total &gt;= 0</span>');
    // An enum-typed column links to its enum.
    expect(page).toContain('<a href="#enum-order_status"><code>order_status</code></a>');
    expect(page).toContain('<tr><td><code>customer_id, ordered_at</code></td><td>orders_by_customer</td>');
  });

  it('describes each ref from both of its tables, with cardinality and actions', () => {
    const page = html();
    const section = (id: string) => page.slice(page.indexOf(`<section id="${id}"`), page.indexOf('</section>', page.indexOf(`<section id="${id}"`)));
    expect(section('table-order_items')).toContain('<tr><td><code>order_id</code></td><td>many-to-one</td><td><a href="#table-orders"><code>orders</code></a> <code>(id)</code></td><td><span class="docs-tag docs-tag--warn">on delete cascade</span></td></tr>');
    expect(section('table-orders')).toContain('<tr><td><code>id</code></td><td>one-to-many</td><td><a href="#table-order_items"><code>order_items</code></a> <code>(order_id)</code></td>');
    expect(section('table-customers')).toContain('one-to-many');

    const refs = writeDocsHtml(fixture('refs'), { title: 'Refs', views: [], tokens });
    expect(refs).toContain('one-to-one');
    expect(refs).toContain('many-to-many');
    expect(refs).toContain('many-to-one, optional here');
    expect(refs).toContain('on delete set null</span><span class="docs-tag docs-tag--warn">on update set default');
    expect(refs).toContain('<span class="docs-tag docs-tag--warn">inactive</span>');
    expect(refs).toContain('<code>merchant_id, country_code</code>');
  });

  it('writes enums, groups and sticky notes', () => {
    const page = html();
    expect(page).toContain('<section id="enum-order_status" class="docs-card">');
    expect(page).toContain('<tr><td><code>shipped</code></td><td>Left the warehouse</td></tr>');
    expect(page).toContain('<section id="group-sales" class="docs-card">\n<h3>sales</h3>\n<ul><li><a href="#table-orders"><code>orders</code></a></li><li><a href="#table-order_items"><code>order_items</code></a></li></ul>');
    expect(page).toContain('<p class="docs-note">Prices are in pounds</p>');
    expect(page).toContain('<p class="docs-project-note">Customers, their orders and what they bought</p>');

    const enums = writeDocsHtml(fixture('enums'), { title: 'Enums', views: [], tokens });
    expect(enums).toContain('<section id="enum-v2.job_status"');
    expect(enums).toContain('<code>A+</code>');
    expect(enums).toContain('<a href="#enum-v2.job_status"><code>v2.job_status</code></a>');
  });

  it('names tables in other schemas, and keeps anchors unique', () => {
    const page = writeDocsHtml(fixture('schemas'), { title: 'Schemas', views: [], tokens });
    expect(page).toContain('<section id="table-core.user"');
    expect(page).toContain('<section id="table-core.users"');
    expect(page).toContain('<a href="#table-core.users"><code>core.users</code></a>');
    const twice = writeDocsHtml(parseDbml('Table "a b" {\n  id int\n}\nTable "a-b" {\n  id int\n}').schema, { title: 'x', views: [], tokens });
    expect(twice).toContain('id="table-a-b"');
    expect(twice).toContain('id="table-a-b-1"');
  });

  it('escapes everything written in the schema, and keeps notes as paragraphs', () => {
    const s = parseDbml(
      [
        "Project p {\n  Note: '''\n  First <b>paragraph</b>\n  line two\n\n  Second & \"last\"\n  '''\n}",
        'Table "<script>alert(1)</script>" {\n  "x\\"y" text [note: \'<img src=x onerror=alert(1)>\']\n\n  Note: \'a < b\'\n}',
      ].join('\n'),
    ).schema;
    const page = writeDocsHtml(s, { title: 'T <i>', views: [], tokens });
    expect(page).not.toContain('<script>alert');
    expect(page).not.toContain('<img');
    expect(page).not.toContain('<b>');
    expect(page).toContain('<title>T &lt;i&gt;</title>');
    expect(page).toContain('<code>&lt;script&gt;alert(1)&lt;/script&gt;</code>');
    expect(page).toContain('<code>x&quot;y</code>');
    expect(page).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(page).toContain('<p class="docs-project-note">First &lt;b&gt;paragraph&lt;/b&gt;<br>line two</p>\n<p class="docs-project-note">Second &amp; &quot;last&quot;</p>');
    expect(page).toContain('<p class="docs-note">a &lt; b</p>');
    expect(page.match(/<script>/g)).toHaveLength(1);

    const notes = writeDocsHtml(fixture('notes'), { title: 'Notes', views: [], tokens });
    expect(notes).toContain('This is a multiple lines note<br>');
    expect(notes).toContain('<p class="docs-note">Contains tables that are related to e-commerce system</p>');
  });

  it('makes no requests: links in notes stay text, and only in-page anchors are linked', () => {
    const page = writeDocsHtml(fixture('project-note'), { title: 'DBML', views: [], tokens });
    expect(page).toContain('[dbdiagram.io](http://dbdiagram.io)');
    expect(external(page)).toEqual([]);
    expect(external(html())).toEqual([]);
    expect(html()).not.toMatch(/<link\b|@import|url\(/);
    for (const m of html().matchAll(/\shref="([^"]*)"/g)) expect(m[1]).toMatch(/^#/);
  });

  it('inlines each view as SVG, without its XML declaration or anything that runs', () => {
    const svg = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><rect width="10" height="10" style="fill:rgb(1, 2, 3)"/><text>orders</text></svg>\n';
    const page = html(shop, [
      { name: 'All tables', svg },
      { name: 'Sales <team>', svg },
    ]);
    expect(page).toContain('<figure id="view-All-tables">\n<figcaption>All tables</figcaption>\n<div class="docs-diagram">\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" style="fill:rgb(1, 2, 3)"/><text>orders</text></svg>\n</div>');
    expect(page).toContain('<figcaption>Sales &lt;team&gt;</figcaption>');
    expect(page).toContain('<a href="#view-Sales-team">Sales &lt;team&gt;</a>');
    expect(page).not.toContain('<?xml');
    expect(page).not.toContain('alert');
    expect(external(page)).toEqual([]);
  });

  it('styles from the tokens given, light and dark, and drops values that would break the CSS', () => {
    const page = writeDocsHtml(shop, { title: 'x', views: [], tokens: { light: { '--ink': '#111', '--brand': 'red} body{display:none', '--not-a-docs-token': '#fff' }, dark: { '--ink': '#eee' } } });
    expect(page).toContain(':root {\n  color-scheme: light dark;\n  --ink: #111;\n}');
    expect(page).toContain('@media (prefers-color-scheme: dark) {\n  :root {\n    --ink: #eee;\n  }\n}');
    expect(page).not.toContain('display:none');
    expect(page).not.toContain('--not-a-docs-token');
    // Every token the stylesheet reads is one the caller is asked for.
    const read = new Set([...page.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]));
    expect([...read].filter((t) => !DOCS_TOKENS.includes(t!))).toEqual([]);
  });

  it("keeps the runner's fixed tokens in step with the design system", () => {
    const css = readFileSync('src/design-system/tokens.css', 'utf8');
    const block = (start: string) => css.slice(css.indexOf(start), css.indexOf('}', css.indexOf(start)));
    const values = (text: string) => Object.fromEntries([...text.matchAll(/^\s*(--[\w\\.-]+):\s*(.+);$/gm)].map((m) => [m[1], m[2]]));
    const light = values(block(':root {'));
    const dark = values(block(':root[data-theme="dark"] {'));
    for (const t of DOCS_TOKENS) {
      expect(tokens.light[t], t).toBe(light[t]);
      if (dark[t]) expect(tokens.dark[t], t).toBe(dark[t]);
    }
    expect(Object.keys(tokens.dark).sort()).toEqual(DOCS_TOKENS.filter((t) => dark[t]).sort());
  });

  it('has the search box and its script, and what each table is found by', () => {
    const page = html();
    expect(page).toContain('<input id="docs-search" type="search"');
    expect(page).toContain("document.querySelectorAll('[data-search]')");
    expect(page).toContain('<section id="table-customers" class="docs-card" data-search="customers c id email name country created_at">');
  });
});

describe('schema docs as Markdown', () => {
  it('writes the shop schema as it was', async () => {
    await expect(writeDocsMarkdown(shop, { title: 'Shop schema' })).toMatchFileSnapshot('__snapshots__/shop.docs.md');
  });

  it('has the diagram as Mermaid, a column table per table and refs with cardinality', () => {
    const md = writeDocsMarkdown(shop, { title: 'Shop schema' });
    expect(md).toContain('```mermaid\nerDiagram\n');
    expect(md).toContain('| `email` | `varchar(255)` | not null, unique |  |  |');
    expect(md).toContain('| `order_id` | many-to-one | [`orders`](#orders) `(id)` | on delete cascade |');
    expect(md).toContain('| `shipped` | Left the warehouse |');
    expect(md).toContain('  - [`order_items`](#order_items)');
    expect(md).toContain('| `created_at` | `timestamp` |  | `` `now()` `` |  |');
  });

  it("links to the anchors GitHub makes, numbering repeats, and keeps cells and names from breaking the layout", () => {
    const s = parseDbml("Table tables {\n  id int [note: '''a | b\nnext line <br>''']\n}\nTable core.\"tables\" {\n  id int\n}\nEnum diagram {\n  x\n}").schema;
    const md = writeDocsMarkdown(s, { title: 'Tables' });
    // `# Tables` is tables, `## Tables` tables-1, the table tables-2; `## Diagram` is diagram, the enum diagram-1.
    expect(md).toContain('- [Tables](#tables-1)\n  - [`tables`](#tables-2)\n  - [`core.tables`](#coretables)');
    expect(md).toContain('  - [`diagram`](#diagram-1)');
    expect(md).toContain('| `id` | `int` |  |  | a \\| b<br>next line &lt;br> |');
  });

  it('writes the notes and the other fixtures without losing content', () => {
    const md = writeDocsMarkdown(fixture('groups'), { title: 'Groups' });
    expect(md).toContain('### tablegroup\\_name\n\n- [`merchants`](#merchants)\n- [`countries`](#countries)\n- [`core.table3`](#coretable3)');
    const notes = writeDocsMarkdown(fixture('project-note'), { title: 'DBML' });
    expect(notes).toContain('[dbdiagram.io](http://dbdiagram.io)');
    expect(writeDocsMarkdown(parseDbml('').schema, { title: 'Empty' })).toBe('# Empty\n\n0 tables · 0 refs · 0 enums\n\n## Contents\n\nThe schema is empty.\n');
  });
});
