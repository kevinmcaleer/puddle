// Export › Mermaid on the Schema view: the view on show as an erDiagram block, to copy into a README or download.
import { useState } from 'react';
import { copyText, saveBlob } from '../export/deliver';
import { Button, Dialog } from '../ui';
import type { DetailLevel } from './diagram/geometry';
import { writeMermaid } from './mermaid';
import type { DbmlSchema } from './model';

export function ExportMermaidDialog({ schema, detail, only, onClose }: { schema: DbmlSchema; detail: DetailLevel; only?: Set<string>; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const text = writeMermaid(schema, { detail, only });
  return (
    <Dialog
      title="Export as Mermaid"
      confirm="Download schema.mmd"
      onClose={onClose}
      onConfirm={() => {
        saveBlob(new Blob([text], { type: 'text/plain' }), 'schema.mmd');
        onClose();
      }}
      className="w-[640px] max-w-[calc(100vw-32px)]"
    >
      <p className="text-label text-ink-muted">An erDiagram of the tables in this view, at its detail level. GitHub draws it inside a mermaid code block.</p>
      <div>
        <Button
          size="sm"
          variant="ghost"
          icon="paste"
          data-autofocus
          onClick={() =>
            void copyText(text).then(
              () => setCopied('Copied the Mermaid.'),
              (e: Error) => setCopied(e.message),
            )
          }
        >
          Copy
        </Button>
      </div>
      <pre className="puddle-schema-sql" tabIndex={0} aria-label="The Mermaid" data-testid="export-mermaid-preview">
        {text}
      </pre>
      {copied && (
        <p className="text-label text-ink-muted" role="status">
          {copied}
        </p>
      )}
    </Dialog>
  );
}
