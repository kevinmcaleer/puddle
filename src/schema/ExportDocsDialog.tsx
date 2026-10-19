// Export › Docs on the Schema view: one self-contained HTML page documenting the schema (with the diagram of All
// tables and of each view) or the same as Markdown. Each view's diagram is drawn off screen to be pictured.
import { useRef, useState } from 'react';
import { saveBlob } from '../export/deliver';
import type { SchemaDoc } from '../model';
import { Dialog, Field, Select } from '../ui';
import { exportBounds, pictureOf } from './diagram/exportImage';
import { layoutDiagram } from './diagram/geometry';
import { SchemaDiagram } from './diagram/SchemaDiagram';
import { defaultDocsTokens, writeDocsHtml, writeDocsMarkdown } from './docs';
import type { DbmlSchema } from './model';
import { viewPositions, viewTables } from './views';

type Format = 'html' | 'markdown';

/** The diagrams the docs show: All tables, then each view. */
const pictured = (doc: SchemaDoc) => [{ name: 'All tables', view: undefined }, ...doc.views.map((v) => ({ name: v.name, view: v }))];

export function ExportDocsDialog({ schema, doc, title, onClose }: { schema: DbmlSchema; doc: SchemaDoc; title: string; onClose: () => void }) {
  const [format, setFormat] = useState<Format>('html');
  const stage = useRef<HTMLDivElement>(null);
  const name = (title || 'schema').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'schema';
  const download = () => {
    if (format === 'markdown') {
      saveBlob(new Blob([writeDocsMarkdown(schema, { title })], { type: 'text/markdown' }), `${name}.md`);
      return onClose();
    }
    const svgs = [...(stage.current?.querySelectorAll<SVGSVGElement>('[data-testid="schema-diagram"]') ?? [])];
    const views = pictured(doc).flatMap(({ name: viewName, view }, i) => {
      const svg = svgs[i];
      const diagram = layoutDiagram(schema, viewPositions(doc, view), { detail: view?.detail ?? doc.detail, only: viewTables(view) });
      return svg && diagram.tables.length ? [{ name: viewName, svg: pictureOf(svg, exportBounds(diagram), { theme: 'light', transparent: false }).svg }] : [];
    });
    saveBlob(new Blob([writeDocsHtml(schema, { title, views, tokens: defaultDocsTokens() })], { type: 'text/html' }), `${name}.html`);
    onClose();
  };
  return (
    <Dialog title="Export docs" confirm={format === 'html' ? `Download ${name}.html` : `Download ${name}.md`} onClose={onClose} onConfirm={download} className="w-[480px] max-w-[calc(100vw-32px)]">
      <p className="text-label text-ink-muted">
        A page documenting every table, its columns, keys, indexes and refs, the enums and groups, with a contents list and a search box. It loads nothing from anywhere, so it opens offline and can be put on any web server or emailed.
      </p>
      <Field label="Format" htmlFor="docs-format">
        <Select
          id="docs-format"
          value={format}
          options={[
            { value: 'html', label: 'HTML page, with the diagrams' },
            { value: 'markdown', label: 'Markdown, with a Mermaid diagram' },
          ]}
          onChange={(e) => setFormat(e.target.value as Format)}
          data-autofocus
        />
      </Field>
      {format === 'html' && (
        <div ref={stage} className="puddle-schema-offstage" aria-hidden="true" inert>
          {pictured(doc).map(({ name: viewName, view }) => (
            <div key={viewName} className="puddle-schema-offstage__pane">
              <SchemaDiagram schema={schema} positions={viewPositions(doc, view)} detail={view?.detail ?? doc.detail} only={viewTables(view)} onMove={() => undefined} />
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
