// Import SQL on the Schema view: a script pasted or opened from a .sql file, read as DBML in the dialect detected (or
// the one picked), added to the schema or put in its place. What was skipped or worked around is listed before it goes in.
import { useMemo, useRef, useState } from 'react';
import { intoSchema } from '../relationships/dbml';
import { Banner, Button, Dialog, Field, Select } from '../ui';
import { tableId } from './diagram/geometry';
import { qualified, type DbmlSchema } from './model';
import { detectDialect, importSql, skippedText, SQL_DIALECTS, type SqlDialect } from './sql';
import { writeDbml } from './write';

const AUTO = 'auto';

export function ImportSqlDialog({ dbml, schema, onImport, onClose }: { dbml: string; schema: DbmlSchema; onImport: (dbml: string, tables: string[]) => void; onClose: () => void }) {
  const [sql, setSql] = useState('');
  const [picked, setPicked] = useState<SqlDialect | typeof AUTO>(AUTO);
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const [problem, setProblem] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const result = useMemo(() => (sql.trim() ? importSql(sql, picked === AUTO ? undefined : picked) : null), [sql, picked]);
  const detected = useMemo(() => (sql.trim() ? SQL_DIALECTS.find((d) => d.value === detectDialect(sql))?.label : undefined), [sql]);
  const tables = result?.schema.tables ?? [];
  const clashes = mode === 'append' ? tables.filter((t) => schema.tables.some((x) => x.schema === t.schema && x.name === t.name)).map((t) => qualified(t.schema, t.name)) : [];
  const skipped = result ? skippedText(result.skipped) : '';
  const hasText = !!dbml.trim();

  return (
    <Dialog
      title="Import SQL"
      confirm={tables.length ? `Import ${tables.length} ${tables.length === 1 ? 'table' : 'tables'}` : 'Import'}
      confirmDisabled={!tables.length}
      onClose={onClose}
      onConfirm={() => {
        if (!result || !tables.length) return;
        onImport(intoSchema(dbml, writeDbml(result.schema), hasText ? mode : 'replace'), tables.map(tableId));
        onClose();
      }}
      className="w-[720px] max-w-[calc(100vw-32px)]"
    >
      <p className="text-label text-ink-muted">Paste CREATE TABLE statements, a pg_dump, a mysqldump or a SQL Server script. The rows of a dump (INSERT and COPY) become the tables’ records. Everything is read in this browser.</p>
      <textarea
        className="ui-input puddle-schema-import"
        aria-label="SQL"
        data-autofocus
        spellCheck={false}
        placeholder={'CREATE TABLE customers (\n  id integer PRIMARY KEY,\n  email varchar(255) NOT NULL UNIQUE\n);'}
        value={sql}
        onChange={(e) => setSql(e.target.value)}
      />
      <div className="flex items-end gap-4">
        <Field label="Database" htmlFor="import-sql-dialect">
          <Select
            id="import-sql-dialect"
            options={[{ value: AUTO, label: detected ? `Detected: ${detected}` : 'Detect from the script' }, ...SQL_DIALECTS.map((d) => ({ value: d.value, label: d.label }))]}
            value={picked}
            onChange={(e) => setPicked(e.target.value as SqlDialect | typeof AUTO)}
          />
        </Field>
        {hasText && (
          <Field label="Into the schema" htmlFor="import-sql-mode">
            <Select id="import-sql-mode" options={[{ value: 'append', label: 'Add to it' }, { value: 'replace', label: 'Replace it' }]} value={mode} onChange={(e) => setMode(e.target.value as 'append' | 'replace')} />
          </Field>
        )}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" icon="source" onClick={() => file.current?.click()}>
          Open a .sql file
        </Button>
        <input
          ref={file}
          type="file"
          accept=".sql,.ddl,.txt,text/plain,application/sql"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) f.text().then(setSql, (err: Error) => setProblem(err.message));
          }}
        />
      </div>
      {result && (
        <p className="text-label text-ink-muted" role="status" data-testid="import-sql-found">
          {tables.length ? `${tables.length} ${tables.length === 1 ? 'table' : 'tables'}` : 'No tables'}
          {result.schema.refs.length ? `, ${result.schema.refs.length} ${result.schema.refs.length === 1 ? 'ref' : 'refs'}` : ''}
          {result.schema.enums.length ? `, ${result.schema.enums.length} ${result.schema.enums.length === 1 ? 'enum' : 'enums'}` : ''}
          {result.rows ? `, ${result.rows.toLocaleString('en-GB')} ${result.rows === 1 ? 'row' : 'rows'}` : ''} found.
        </p>
      )}
      {(skipped || (result && result.warnings.length > 0)) && (
        <Banner tone="info" title={skipped || 'Read with changes'}>
          {result!.warnings.length > 0 && (
            <ul className="puddle-schema-sql__notes" data-testid="import-sql-warnings">
              {result!.warnings.slice(0, 12).map((w, i) => (
                <li key={i}>
                  Line {w.line}: {w.message}
                </li>
              ))}
              {result!.warnings.length > 12 && <li>And {result!.warnings.length - 12} more.</li>}
            </ul>
          )}
        </Banner>
      )}
      {clashes.length > 0 && (
        <Banner tone="warn" title={`Already in the schema: ${clashes.join(', ')}`}>
          Added as well, they would be there twice. Replace the schema, or rename them in the script first.
        </Banner>
      )}
      {problem && (
        <Banner tone="fail" title="The file couldn’t be read">
          {problem}
        </Banner>
      )}
    </Dialog>
  );
}
