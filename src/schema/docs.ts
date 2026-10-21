// Documentation of a schema, written without a server: one self-contained HTML file (the design tokens inlined, each
// view's diagram as inline SVG, a search box that works offline) and the same content as GitHub-flavoured Markdown.
// Pure and deterministic, so the runner writes byte-identical files from the same schema.
import { writeMermaid } from './mermaid';
import { enumOf, qualified, type Column, type DbmlSchema, type Default, type Index, type Ref, type Table } from './model';

/** The CSS custom properties the HTML reads (sizes, spacing and the type scale follow the design system), so the UI can collect them with getComputedStyle and the runner can fix them. */
export const DOCS_TOKENS: string[] = [
  '--surface-canvas',
  '--surface-panel',
  '--surface-raised',
  '--surface-sunken',
  '--ink',
  '--ink-muted',
  '--ink-subtle',
  '--line',
  '--line-strong',
  '--brand',
  '--brand-tint',
  '--accent-ink',
  '--accent-tint',
  '--font-display',
  '--font-ui',
  '--font-mono',
  '--space-1',
  '--space-2',
  '--space-3',
  '--space-4',
  '--space-6',
  '--space-8',
  '--radius-sm',
  '--radius-md',
  '--size-inspector',
];

export type DocsTokens = { light: Record<string, string>; dark: Record<string, string> };

/** The design system's values for DOCS_TOKENS (src/design-system/tokens.css), for when there is no browser to read them from. */
export function defaultDocsTokens(): DocsTokens {
  const shared = {
    '--font-display': '"Bricolage Grotesque", "Instrument Sans", system-ui, sans-serif',
    '--font-ui': '"Instrument Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
    '--font-mono': '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    '--space-1': '4px',
    '--space-2': '8px',
    '--space-3': '12px',
    '--space-4': '16px',
    '--space-6': '24px',
    '--space-8': '32px',
    '--radius-sm': '5px',
    '--radius-md': '8px',
    '--size-inspector': '320px',
  };
  return {
    light: {
      '--surface-canvas': '#eef2f1',
      '--surface-panel': '#fafbfb',
      '--surface-raised': '#ffffff',
      '--surface-sunken': '#e6ecea',
      '--ink': '#142120',
      '--ink-muted': '#4a5c59',
      '--ink-subtle': '#576966',
      '--line': '#d6dfdd',
      '--line-strong': '#7a8b87',
      '--brand': '#0b6b6b',
      '--brand-tint': '#d7ecea',
      '--accent-ink': '#8a5500',
      '--accent-tint': '#fcefd3',
      ...shared,
    },
    dark: {
      '--surface-canvas': '#0e1514',
      '--surface-panel': '#141c1b',
      '--surface-raised': '#1a2423',
      '--surface-sunken': '#0b1110',
      '--ink': '#e4ecea',
      '--ink-muted': '#a6b6b3',
      '--ink-subtle': '#8b9d99',
      '--line': '#26332f',
      '--line-strong': '#62746f',
      '--brand': '#4fc2bf',
      '--brand-tint': '#123634',
      '--accent-ink': '#f2b23a',
      '--accent-tint': '#3a2a0b',
    },
  };
}

export type DocsView = { name: string; svg: string };
export type DocsHtmlOptions = { title: string; views: DocsView[]; tokens: DocsTokens; /** A cover line under the title: where the schema was documented from and when. */ subtitle?: string };

/** How a ref reads from its `from` side. */
const CARDINALITY: Record<Ref['op'], string> = { '<': 'one-to-many', '>': 'many-to-one', '-': 'one-to-one', '<>': 'many-to-many' };
const FLIPPED: Record<Ref['op'], Ref['op']> = { '<': '>', '>': '<', '-': '-', '<>': '<>' };

/** One ref as seen from a table: its columns there, the other table and its columns, and the cardinality read that way. */
type RefSide = { ref: Ref; columns: string[]; other: { schema: string; table: string; columns: string[] }; cardinality: string; optional: boolean; otherOptional: boolean };

function refsOf(schema: DbmlSchema, t: Table): RefSide[] {
  const out: RefSide[] = [];
  for (const ref of schema.refs) {
    const isFrom = ref.from.schema === t.schema && ref.from.table === t.name;
    const isTo = ref.to.schema === t.schema && ref.to.table === t.name;
    if (isFrom) out.push({ ref, columns: ref.from.columns, other: ref.to, cardinality: CARDINALITY[ref.op], optional: ref.fromOptional, otherOptional: ref.toOptional });
    else if (isTo) out.push({ ref, columns: ref.to.columns, other: ref.from, cardinality: CARDINALITY[FLIPPED[ref.op]], optional: ref.toOptional, otherOptional: ref.fromOptional });
  }
  return out;
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const defaultText = (d: Default) => (d.kind === 'string' ? `'${d.value}'` : d.kind === 'expression' ? `\`${d.value}\`` : d.value);

function columnSettings(c: Column): string[] {
  return [c.pk && 'pk', c.increment && 'increment', c.notNull === true && 'not null', c.notNull === false && 'null', c.unique && 'unique', ...c.checks.map((x) => `check: ${x}`)].filter((x): x is string => !!x);
}

const indexParts = (ix: Index) => ix.parts.map((p) => (p.kind === 'expression' ? `\`${p.value}\`` : p.value)).join(', ');
const indexSettings = (ix: Index) => [ix.pk && 'pk', ix.unique && 'unique', ix.type && `type: ${ix.type}`].filter((x): x is string => !!x);

const refActions = (r: Ref) => [r.delete && `on delete ${r.delete}`, r.update && `on update ${r.update}`, r.inactive && 'inactive'].filter((x): x is string => !!x);

/** Anchors made unique in document order, so the same schema always gets the same ones. */
function slugger(make: (text: string) => string) {
  const used = new Map<string, number>();
  return (text: string) => {
    const base = make(text);
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
}

// ---------------------------------------------------------------------------------------------------------------- HTML

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** A note as paragraphs: blank lines split them, single line breaks are kept. */
const paragraphs = (note: string, cls = 'docs-note') =>
  note
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p class="${cls}">${esc(p.trim()).replace(/\r?\n/g, '<br>')}</p>`)
    .join('\n');

const lines = (note: string) => esc(note.trim()).replace(/\r?\n/g, '<br>');

/** An id an anchor can carry: letters, digits, `_`, `-` and `.`, everything else a `-`. */
const htmlSlug = (text: string) => text.replace(/[^\p{L}\p{N}_.-]+/gu, '-').replace(/^-+|-+$/g, '') || 'x';

/** Only `--name: value` pairs that can't break out of the declaration block. */
function declarations(names: string[], values: Record<string, string>): string {
  return names
    .filter((n) => values[n] !== undefined && /^--[\w-]+$/.test(n) && !/[;{}<>]/.test(values[n]!))
    .map((n) => `  ${n}: ${values[n]!.trim()};`)
    .join('\n');
}

/** A serialised SVG as markup to inline: without its XML declaration or doctype, and never with a script. */
const inlineSvg = (svg: string) =>
  svg
    .replace(/<\?xml[^>]*\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .trim();

/** The page's layout, from the tokens; type sizes are the design system's type scale (tokens.css). */
const DOCS_CSS = `
* { box-sizing: border-box; }
body { margin: 0; background: var(--surface-panel); color: var(--ink); font-family: var(--font-ui); font-size: 13px; line-height: 20px; }
main { max-width: calc(var(--size-inspector) * 3); margin: 0 auto; padding: var(--space-8) var(--space-6); display: flex; flex-direction: column; gap: var(--space-6); }
h1, h2, h3, h4 { font-family: var(--font-display); margin: 0; }
h1 { font-size: 22px; line-height: 24px; letter-spacing: -0.02em; }
h2 { font-size: 20px; line-height: 26px; padding-bottom: var(--space-2); border-bottom: 1px solid var(--line); }
h3 { font-family: var(--font-ui); font-size: 14px; line-height: 20px; }
h4 { font-family: var(--font-ui); font-size: 11px; line-height: 14px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-muted); }
p { margin: 0; }
a { color: var(--brand); }
code { font-family: var(--font-mono); font-size: 12px; }
.docs-meta, .docs-empty { color: var(--ink-muted); }
.docs-note { color: var(--ink-muted); }
.docs-search { position: sticky; top: 0; padding: var(--space-2) 0; background: var(--surface-panel); }
.docs-search input { width: 100%; padding: var(--space-2) var(--space-3); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface-raised); color: var(--ink); font: inherit; }
.docs-search input:focus { outline: 2px solid var(--brand); outline-offset: 1px; }
.docs-toc ul { margin: 0; padding-left: var(--space-6); }
.docs-toc > ul { padding-left: 0; list-style: none; }
.docs-card { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-raised); scroll-margin-top: calc(var(--space-8) * 2); }
.docs-diagram { overflow: auto; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-canvas); padding: var(--space-3); }
.docs-diagram svg { display: block; max-width: 100%; height: auto; }
figure { margin: 0; display: flex; flex-direction: column; gap: var(--space-2); }
figcaption { font-weight: 600; }
table { border-collapse: collapse; width: 100%; }
th, td { padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
th { color: var(--ink-muted); font-weight: 600; background: var(--surface-sunken); }
.docs-tag { display: inline-block; margin: 0 var(--space-1) var(--space-1) 0; padding: 0 var(--space-2); border-radius: var(--radius-sm); background: var(--brand-tint); color: var(--ink); font-size: 12px; line-height: 20px; }
.docs-tag--warn { background: var(--accent-tint); color: var(--accent-ink); }
.docs-stack { display: flex; flex-direction: column; gap: var(--space-4); }
[hidden] { display: none !important; }
@media print { .docs-search { display: none; } .docs-card { break-inside: avoid; } }
`;

/** Filters the table sections and their TOC entries by table or column name, as typed. Plain DOM, no network. */
const SEARCH_SCRIPT = `
(function () {
  var input = document.getElementById('docs-search');
  var empty = document.getElementById('docs-search-empty');
  if (!input) return;
  function filter() {
    var q = input.value.trim().toLowerCase();
    var shown = 0;
    var items = document.querySelectorAll('[data-search]');
    for (var i = 0; i < items.length; i++) {
      var match = !q || items[i].getAttribute('data-search').indexOf(q) >= 0;
      items[i].hidden = !match;
      if (match && items[i].tagName === 'SECTION') shown++;
    }
    if (empty) empty.hidden = !q || shown > 0;
  }
  input.addEventListener('input', filter);
  filter();
})();
`;

const tags = (items: string[], cls = 'docs-tag') => items.map((s) => `<span class="${cls}">${esc(s)}</span>`).join('');

/** One self-contained HTML page: no requests anywhere, styled from the tokens given, light and dark. */
export function writeDocsHtml(schema: DbmlSchema, options: DocsHtmlOptions): string {
  const anchor = slugger(htmlSlug);
  const views = options.views.map((v) => ({ ...v, id: anchor(`view-${v.name}`) }));
  const tableIds = new Map(schema.tables.map((t) => [`${t.schema}.${t.name}`, anchor(`table-${qualified(t.schema, t.name)}`)]));
  const enumIds = new Map(schema.enums.map((e) => [`${e.schema}.${e.name}`, anchor(`enum-${qualified(e.schema, e.name)}`)]));
  const groupIds = schema.groups.map((g) => anchor(`group-${g.name}`));
  const noteIds = schema.notes.map((n) => anchor(`note-${n.name}`));
  const tableLink = (s: string, name: string) => {
    const id = tableIds.get(`${s}.${name}`);
    const label = `<code>${esc(qualified(s, name))}</code>`;
    return id ? `<a href="#${id}">${label}</a>` : label;
  };
  const searchText = (t: Table) => esc([qualified(t.schema, t.name), t.alias, ...t.columns.map((c) => c.name)].filter(Boolean).join(' ').toLowerCase());

  const body: string[] = [];
  body.push(`<header class="docs-stack">`, `<h1>${esc(options.title)}</h1>`);
  const p = schema.project;
  const meta = [p?.name && `Project ${p.name}`, p?.databaseType && p.databaseType, `${count(schema.tables.length, 'table')}`, `${count(schema.refs.length, 'ref')}`, `${count(schema.enums.length, 'enum')}`].filter(Boolean) as string[];
  body.push(`<p class="docs-meta">${esc(meta.join(' · '))}</p>`);
  if (options.subtitle) body.push(`<p class="docs-meta">${esc(options.subtitle)}</p>`);
  if (p?.note?.trim()) body.push(paragraphs(p.note, 'docs-project-note'));
  body.push(`</header>`);

  body.push(
    `<div class="docs-search" role="search">`,
    `<input id="docs-search" type="search" placeholder="Search tables and columns" aria-label="Search tables and columns" autocomplete="off">`,
    `<p id="docs-search-empty" class="docs-empty" hidden>No tables or columns match.</p>`,
    `</div>`,
  );

  // Contents
  const toc: string[] = [];
  if (views.length) toc.push(`<li><a href="#diagrams">Diagrams</a><ul>${views.map((v) => `<li><a href="#${v.id}">${esc(v.name)}</a></li>`).join('')}</ul></li>`);
  if (schema.tables.length)
    toc.push(`<li><a href="#tables">Tables</a><ul>${schema.tables.map((t) => `<li data-search="${searchText(t)}">${tableLink(t.schema, t.name)}</li>`).join('')}</ul></li>`);
  if (schema.enums.length) toc.push(`<li><a href="#enums">Enums</a><ul>${schema.enums.map((e) => `<li><a href="#${enumIds.get(`${e.schema}.${e.name}`)}"><code>${esc(qualified(e.schema, e.name))}</code></a></li>`).join('')}</ul></li>`);
  if (schema.groups.length) toc.push(`<li><a href="#groups">Table groups</a><ul>${schema.groups.map((g, i) => `<li><a href="#${groupIds[i]}">${esc(g.name)}</a></li>`).join('')}</ul></li>`);
  if (schema.notes.length) toc.push(`<li><a href="#notes">Notes</a><ul>${schema.notes.map((n, i) => `<li><a href="#${noteIds[i]}">${esc(n.name)}</a></li>`).join('')}</ul></li>`);
  body.push(`<nav class="docs-toc" aria-label="Contents">`, `<h2>Contents</h2>`, toc.length ? `<ul>\n${toc.join('\n')}\n</ul>` : `<p class="docs-empty">The schema is empty.</p>`, `</nav>`);

  // Diagrams
  if (views.length) {
    body.push(`<section id="diagrams" class="docs-stack">`, `<h2>Diagrams</h2>`);
    for (const v of views) body.push(`<figure id="${v.id}">`, `<figcaption>${esc(v.name)}</figcaption>`, `<div class="docs-diagram">`, inlineSvg(v.svg), `</div>`, `</figure>`);
    body.push(`</section>`);
  }

  // Tables
  if (schema.tables.length) {
    body.push(`<div id="tables" class="docs-stack">`, `<h2>Tables</h2>`);
    for (const t of schema.tables) {
      body.push(`<section id="${tableIds.get(`${t.schema}.${t.name}`)}" class="docs-card" data-search="${searchText(t)}">`);
      body.push(`<h3><code>${esc(qualified(t.schema, t.name))}</code>${t.alias ? ` <span class="docs-meta">as ${esc(t.alias)}</span>` : ''}</h3>`);
      if (t.note?.trim()) body.push(paragraphs(t.note));
      body.push(`<table>`, `<thead><tr><th>Column</th><th>Type</th><th>Settings</th><th>Default</th><th>Note</th></tr></thead>`, `<tbody>`);
      for (const c of t.columns) {
        const e = enumOf(schema, c);
        const type = e ? `<a href="#${enumIds.get(`${e.schema}.${e.name}`)}"><code>${esc(c.type)}</code></a>` : `<code>${esc(c.type)}</code>`;
        body.push(`<tr><td><code>${esc(c.name)}</code></td><td>${type}</td><td>${tags(columnSettings(c))}</td><td>${c.default ? `<code>${esc(defaultText(c.default))}</code>` : ''}</td><td>${c.note ? lines(c.note) : ''}</td></tr>`);
      }
      body.push(`</tbody>`, `</table>`);
      if (t.indexes.length) {
        body.push(`<h4>Indexes</h4>`, `<table>`, `<thead><tr><th>Columns</th><th>Name</th><th>Settings</th><th>Note</th></tr></thead>`, `<tbody>`);
        for (const ix of t.indexes) body.push(`<tr><td><code>${esc(indexParts(ix))}</code></td><td>${ix.name ? esc(ix.name) : ''}</td><td>${tags(indexSettings(ix))}</td><td>${ix.note ? lines(ix.note) : ''}</td></tr>`);
        body.push(`</tbody>`, `</table>`);
      }
      if (t.checks.length) {
        body.push(`<h4>Checks</h4>`, `<ul>`);
        for (const ch of t.checks) body.push(`<li><code>${esc(ch.expression)}</code>${ch.name ? ` <span class="docs-meta">${esc(ch.name)}</span>` : ''}</li>`);
        body.push(`</ul>`);
      }
      const refs = refsOf(schema, t);
      if (refs.length) {
        body.push(`<h4>Refs</h4>`, `<table>`, `<thead><tr><th>Columns</th><th>Relationship</th><th>Other table</th><th>Actions</th></tr></thead>`, `<tbody>`);
        for (const r of refs) {
          const rel = [r.cardinality, r.optional && 'optional here', r.otherOptional && 'optional there'].filter(Boolean).join(', ');
          const other = `${tableLink(r.other.schema, r.other.table)} <code>(${esc(r.other.columns.join(', '))})</code>`;
          body.push(`<tr><td><code>${esc(r.columns.join(', '))}</code></td><td>${esc(rel)}${r.ref.name ? ` <span class="docs-meta">${esc(r.ref.name)}</span>` : ''}</td><td>${other}</td><td>${tags(refActions(r.ref), 'docs-tag docs-tag--warn')}</td></tr>`);
        }
        body.push(`</tbody>`, `</table>`);
      }
      body.push(`</section>`);
    }
    body.push(`</div>`);
  }

  // Enums
  if (schema.enums.length) {
    body.push(`<div id="enums" class="docs-stack">`, `<h2>Enums</h2>`);
    for (const e of schema.enums) {
      body.push(`<section id="${enumIds.get(`${e.schema}.${e.name}`)}" class="docs-card">`, `<h3><code>${esc(qualified(e.schema, e.name))}</code></h3>`);
      body.push(`<table>`, `<thead><tr><th>Value</th><th>Note</th></tr></thead>`, `<tbody>`);
      for (const v of e.values) body.push(`<tr><td><code>${esc(v.name)}</code></td><td>${v.note ? lines(v.note) : ''}</td></tr>`);
      body.push(`</tbody>`, `</table>`, `</section>`);
    }
    body.push(`</div>`);
  }

  // Table groups
  if (schema.groups.length) {
    body.push(`<div id="groups" class="docs-stack">`, `<h2>Table groups</h2>`);
    schema.groups.forEach((g, i) => {
      body.push(`<section id="${groupIds[i]}" class="docs-card">`, `<h3>${esc(g.name)}</h3>`);
      if (g.note?.trim()) body.push(paragraphs(g.note));
      body.push(g.tables.length ? `<ul>${g.tables.map((t) => `<li>${tableLink(t.schema, t.name)}</li>`).join('')}</ul>` : `<p class="docs-empty">No tables.</p>`, `</section>`);
    });
    body.push(`</div>`);
  }

  // Sticky notes
  if (schema.notes.length) {
    body.push(`<div id="notes" class="docs-stack">`, `<h2>Notes</h2>`);
    schema.notes.forEach((n, i) => body.push(`<section id="${noteIds[i]}" class="docs-card">`, `<h3>${esc(n.name)}</h3>`, paragraphs(n.text), `</section>`));
    body.push(`</div>`);
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Puddle">
<title>${esc(options.title)}</title>
<style>
:root {
  color-scheme: light dark;
${declarations(DOCS_TOKENS, options.tokens.light)}
}
@media (prefers-color-scheme: dark) {
  :root {
${declarations(DOCS_TOKENS, options.tokens.dark).replace(/^/gm, '  ')}
  }
}
${DOCS_CSS.trim()}
</style>
</head>
<body>
<main>
${body.join('\n')}
</main>
<script>
${SEARCH_SCRIPT.trim()}
</script>
</body>
</html>
`;
}

// ------------------------------------------------------------------------------------------------------------ Markdown

/** One table cell: pipes escaped, line breaks as <br>, so a value can't break the table. */
const cell = (v: string) => v.replace(/\|/g, '\\|').replace(/\r?\n|\r/g, '<br>');

/** Text outside code: Markdown's own characters escaped, so a name reads as written. */
const mdText = (v: string) => v.replace(/([\\`*_[\]<>#|])/g, '\\$1').replace(/\r?\n|\r/g, ' ');

/** A note as Markdown: written as is (DBML notes are Markdown), with raw HTML turned off. */
const mdNote = (note: string) => note.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** A code span that holds any text, backticks included. */
function code(v: string): string {
  const runs = v.match(/`+/g) ?? [];
  const fence = '`'.repeat(Math.max(0, ...runs.map((r) => r.length)) + 1);
  const pad = v.startsWith('`') || v.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${v}${pad}${fence}`;
}

const mdTable = (head: string[], rows: string[][]) => [`| ${head.join(' | ')} |`, `|${head.map(() => ' --- ').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');

/** The anchor GitHub gives a heading: lower case, punctuation dropped, spaces as hyphens. */
const githubSlug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');

/** The same content as GitHub-flavoured Markdown, with the diagram as a Mermaid erDiagram. */
export function writeDocsMarkdown(schema: DbmlSchema, options: { title: string; subtitle?: string }): string {
  // Headings in document order, so the anchors match the ones GitHub makes.
  const slug = slugger(githubSlug);
  slug(options.title);
  slug('Contents');
  if (schema.tables.length) slug('Diagram');
  const tablesSlug = schema.tables.length ? slug('Tables') : '';
  const tableIds = new Map(schema.tables.map((t) => [`${t.schema}.${t.name}`, slug(qualified(t.schema, t.name))]));
  const enumsSlug = schema.enums.length ? slug('Enums') : '';
  const enumIds = new Map(schema.enums.map((e) => [`${e.schema}.${e.name}`, slug(qualified(e.schema, e.name))]));
  const groupsSlug = schema.groups.length ? slug('Table groups') : '';
  const groupIds = schema.groups.map((g) => slug(g.name));
  const notesSlug = schema.notes.length ? slug('Notes') : '';
  const noteIds = schema.notes.map((n) => slug(n.name));
  const tableLink = (s: string, name: string) => {
    const id = tableIds.get(`${s}.${name}`);
    return id ? `[${code(qualified(s, name))}](#${id})` : code(qualified(s, name));
  };

  const out: string[] = [`# ${mdText(options.title)}`, ''];
  const p = schema.project;
  const meta = [p?.name && `Project ${p.name}`, p?.databaseType, count(schema.tables.length, 'table'), count(schema.refs.length, 'ref'), count(schema.enums.length, 'enum')].filter(Boolean) as string[];
  out.push(mdText(meta.join(' · ')), '');
  if (options.subtitle) out.push(mdText(options.subtitle), '');
  if (p?.note?.trim()) out.push(mdNote(p.note), '');

  out.push('## Contents', '');
  if (schema.tables.length) out.push(`- [Tables](#${tablesSlug})`, ...schema.tables.map((t) => `  - ${tableLink(t.schema, t.name)}`));
  if (schema.enums.length) out.push(`- [Enums](#${enumsSlug})`, ...schema.enums.map((e) => `  - [${code(qualified(e.schema, e.name))}](#${enumIds.get(`${e.schema}.${e.name}`)})`));
  if (schema.groups.length) out.push(`- [Table groups](#${groupsSlug})`, ...schema.groups.map((g, i) => `  - [${mdText(g.name)}](#${groupIds[i]})`));
  if (schema.notes.length) out.push(`- [Notes](#${notesSlug})`, ...schema.notes.map((n, i) => `  - [${mdText(n.name)}](#${noteIds[i]})`));
  if (!schema.tables.length && !schema.enums.length && !schema.groups.length && !schema.notes.length) out.push('The schema is empty.');
  out.push('');

  if (schema.tables.length) out.push('## Diagram', '', '```mermaid', writeMermaid(schema).trimEnd(), '```', '');

  if (schema.tables.length) {
    out.push('## Tables', '');
    for (const t of schema.tables) {
      out.push(`### ${mdText(qualified(t.schema, t.name))}`, '');
      if (t.alias) out.push(`Alias ${code(t.alias)}`, '');
      if (t.note?.trim()) out.push(mdNote(t.note), '');
      const rows = t.columns.map((c) => {
        const e = enumOf(schema, c);
        return [code(c.name), e ? `[${code(c.type)}](#${enumIds.get(`${e.schema}.${e.name}`)})` : code(c.type), columnSettings(c).join(', '), c.default ? code(defaultText(c.default)) : '', c.note ? mdNote(c.note) : ''];
      });
      out.push(mdTable(['Column', 'Type', 'Settings', 'Default', 'Note'], rows), '');
      if (t.indexes.length) {
        out.push('**Indexes**', '', mdTable(['Columns', 'Name', 'Settings', 'Note'], t.indexes.map((ix) => [code(indexParts(ix)), ix.name ? mdText(ix.name) : '', indexSettings(ix).join(', '), ix.note ? mdNote(ix.note) : ''])), '');
      }
      if (t.checks.length) out.push('**Checks**', '', ...t.checks.map((ch) => `- ${code(ch.expression)}${ch.name ? ` (${mdText(ch.name)})` : ''}`), '');
      const refs = refsOf(schema, t);
      if (refs.length) {
        const rows = refs.map((r) => [
          code(r.columns.join(', ')),
          [r.cardinality, r.optional && 'optional here', r.otherOptional && 'optional there'].filter(Boolean).join(', ') + (r.ref.name ? ` (${mdText(r.ref.name)})` : ''),
          `${tableLink(r.other.schema, r.other.table)} ${code(`(${r.other.columns.join(', ')})`)}`,
          refActions(r.ref).join(', '),
        ]);
        out.push('**Refs**', '', mdTable(['Columns', 'Relationship', 'Other table', 'Actions'], rows), '');
      }
    }
  }

  if (schema.enums.length) {
    out.push('## Enums', '');
    for (const e of schema.enums) out.push(`### ${mdText(qualified(e.schema, e.name))}`, '', mdTable(['Value', 'Note'], e.values.map((v) => [code(v.name), v.note ? mdNote(v.note) : ''])), '');
  }

  if (schema.groups.length) {
    out.push('## Table groups', '');
    for (const g of schema.groups) {
      out.push(`### ${mdText(g.name)}`, '');
      if (g.note?.trim()) out.push(mdNote(g.note), '');
      out.push(g.tables.length ? g.tables.map((t) => `- ${tableLink(t.schema, t.name)}`).join('\n') : 'No tables.', '');
    }
  }

  if (schema.notes.length) {
    out.push('## Notes', '');
    for (const n of schema.notes) out.push(`### ${mdText(n.name)}`, '', mdNote(n.text), '');
  }

  return `${out.join('\n').trimEnd()}\n`;
}
