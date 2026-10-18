// Export › SQL on the Schema view: the script that creates the schema in a database, for the dialect picked, shown
// before it is copied or downloaded, with a notice of types written as given and anything else the database can't do.
import { useMemo, useState } from 'react';
import { DIALECT_RULES, exportSql } from '../compiler/ddl/export';
import { DDL_DIALECTS, type DdlDialect } from '../compiler/sql';
import { copyText, saveBlob } from '../export/deliver';
import { Banner, Button, Dialog, Field, Select, Switch } from '../ui';
import type { DbmlSchema } from './model';

/** The dialect picked last, while the app is open. */
let lastDialect: DdlDialect = 'postgres';

export function ExportSqlDialog({ schema, onClose }: { schema: DbmlSchema; onClose: () => void }) {
  const [dialect, setDialect] = useState<DdlDialect>(lastDialect);
  const [records, setRecords] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const out = useMemo(() => exportSql(schema, dialect, { records }), [schema, dialect, records]);
  const hasRecords = schema.records.some((r) => !r.example && r.rows.length);
  const pick = (d: DdlDialect) => {
    lastDialect = d;
    setDialect(d);
    setCopied(null);
  };
  return (
    <Dialog
      title="Export as SQL"
      confirm="Download schema.sql"
      onClose={onClose}
      onConfirm={() => {
        saveBlob(new Blob([out.sql], { type: 'application/sql' }), 'schema.sql');
        onClose();
      }}
      className="w-[720px] max-w-[calc(100vw-32px)]"
    >
      <div className="flex items-end gap-4">
        <Field label="Database" htmlFor="export-sql-dialect">
          <Select id="export-sql-dialect" data-autofocus options={DDL_DIALECTS.map((d) => ({ value: d, label: DIALECT_RULES[d].label }))} value={dialect} onChange={(e) => pick(e.target.value as DdlDialect)} />
        </Field>
        <Switch label="Include records" checked={records} onChange={setRecords} />
        <span className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          icon="paste"
          onClick={() =>
            void copyText(out.sql).then(
              () => setCopied('Copied the script.'),
              (e: Error) => setCopied(e.message),
            )
          }
        >
          Copy
        </Button>
      </div>
      {records && !hasRecords && <p className="text-label text-ink-muted">The schema has no records to include; example records are always left out.</p>}
      {(out.unmapped.length > 0 || out.warnings.length > 0) && (
        <Banner tone="warn" title={`Check before running it on ${DIALECT_RULES[dialect].label}`}>
          <ul className="puddle-schema-sql__notes" data-testid="export-sql-notes">
            {out.unmapped.length > 0 && <li>{out.unmapped.length === 1 ? 'A type' : `${out.unmapped.length} types`} it has no word for, written as given: {out.unmapped.join(', ')}.</li>}
            {out.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Banner>
      )}
      <pre className="puddle-schema-sql" tabIndex={0} aria-label="The script" data-testid="export-sql-preview">
        {out.sql}
      </pre>
      {copied && (
        <p className="text-label text-ink-muted" role="status">
          {copied}
        </p>
      )}
    </Dialog>
  );
}
