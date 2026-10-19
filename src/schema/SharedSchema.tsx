// A schema opened from a share link: read from the link's #fragment, shown read-only (tables can be moved for a better
// look, nothing is kept), with Open in a new project to keep it. An embed link shows only the diagram.
import { useEffect, useMemo, useState } from 'react';
import type { Position } from '../model';
import { Banner, Button, Tabs } from '../ui';
import { SchemaDiagram } from './diagram/SchemaDiagram';
import { parseDbml } from './parse';
import { decodeShare, type SharePayload } from './share';
import { viewPositions, viewTables } from './views';
import './schema.css';

export function SharedSchema({ encoded, embed, onOpen, onLeave }: { encoded: string; embed: boolean; onOpen: (payload: SharePayload) => void; onLeave: () => void }) {
  const [payload, setPayload] = useState<SharePayload | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [viewId, setViewId] = useState('');
  const [moved, setMoved] = useState<Record<string, Position>>({});
  useEffect(() => {
    decodeShare(encoded).then(setPayload, (e: Error) => setProblem(e.message));
  }, [encoded]);
  const schema = useMemo(() => (payload ? parseDbml(payload.dbml).schema : null), [payload]);

  if (problem)
    return (
      <main className="flex h-dvh flex-col items-center justify-center gap-4 p-6" data-testid="shared-schema">
        <Banner tone="fail" title="This link can’t be opened">
          {problem}
        </Banner>
        <Button onClick={onLeave}>Open Puddle</Button>
      </main>
    );
  if (!payload || !schema) return <main className="flex h-dvh items-center justify-center text-ink-muted" data-testid="shared-schema">Reading the schema…</main>;

  const doc = { dbml: payload.dbml, positions: payload.positions ?? {}, detail: payload.detail ?? 'full', views: payload.views ?? [], versions: [] };
  const view = doc.views.find((v) => v.id === viewId);
  const diagram = (
    <div className="puddle-schema__pane h-full">
      <div className="puddle-schema__stage">
        <SchemaDiagram
          key={viewId}
          schema={schema}
          positions={{ ...viewPositions(doc, view), ...moved }}
          detail={view?.detail ?? doc.detail}
          only={viewTables(view)}
          onMove={(m) => setMoved((was) => ({ ...was, ...m }))}
        />
      </div>
    </div>
  );
  if (embed)
    return (
      <main className="h-dvh" data-testid="shared-schema" data-embed="">
        {diagram}
      </main>
    );
  return (
    <main className="flex h-dvh flex-col" data-testid="shared-schema">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2">
        <h1 className="text-title">Shared schema</h1>
        <span className="text-label text-ink-muted">Read-only. The link itself carries the schema; nothing was sent to a server.</span>
        <span className="flex-1" />
        <Button variant="ghost" onClick={onLeave}>
          Open Puddle
        </Button>
        <Button variant="primary" icon="plus" onClick={() => onOpen({ ...payload, positions: { ...doc.positions, ...(view ? {} : moved) } })}>
          Open in a new project
        </Button>
      </header>
      {doc.views.length > 0 && (
        <div className="border-b border-line px-4">
          <Tabs
            items={[{ id: '', label: 'All tables' }, ...doc.views.map((v) => ({ id: v.id, label: v.name }))]}
            value={viewId}
            onChange={(id) => {
              setViewId(id);
              setMoved({});
            }}
          />
        </div>
      )}
      <div className="min-h-0 flex-1">{diagram}</div>
    </main>
  );
}
