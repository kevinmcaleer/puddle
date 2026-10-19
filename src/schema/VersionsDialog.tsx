// Versions on the Schema view: named points in the schema's history, kept in the project. Save the DBML as it is,
// then compare any version with the current text or another version: the changes in words grouped by table, both
// DBML texts with the differing lines marked, and the migration script that takes the older to the newer.
import { useMemo, useState } from 'react';
import { migrationSql } from '../compiler';
import { DIALECT_RULES } from '../compiler/ddl/export';
import { DDL_DIALECTS, type DdlDialect } from '../compiler/sql';
import { copyText, saveBlob } from '../export/deliver';
import type { Project, SchemaVersion } from '../model';
import { Banner, Button, cx, Dialog, Field, formatBytes, formatInstant, Menu, Section, Select, Tabs, TextInput } from '../ui';
import { diffLines, diffSchemas, type SchemaChange } from './diff';
import { qualified } from './model';
import { parseDbml } from './parse';
import { deleteSchemaVersion, nextVersionLabel, renameSchemaVersion, restoreSchemaVersion, saveSchemaVersion, versionsSize } from './versions';

type Apply = (edit: (p: Project) => Project) => void;
type Tab = 'changes' | 'dbml' | 'migration';

/** The current text, as a side of a comparison. */
const CURRENT = '';

let lastDialect: DdlDialect = 'postgres';

const ACTION_CLASS: Record<SchemaChange['action'], string> = { add: 'is-added', remove: 'is-removed', change: 'is-changed' };

export function VersionsDialog({ project, apply, onClose }: { project: Project; apply: Apply; onClose: () => void }) {
  const versions = project.schema.versions;
  const [label, setLabel] = useState('');
  const [from, setFrom] = useState<string | null>(versions[0]?.id ?? null);
  const [to, setTo] = useState(CURRENT);
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);
  const [tab, setTab] = useState<Tab>('changes');
  const [dialect, setDialect] = useState<DdlDialect>(lastDialect);
  const [said, setSaid] = useState<string | null>(null);

  const textOf = (id: string) => (id === CURRENT ? project.schema.dbml : (versions.find((v) => v.id === id)?.dbml ?? ''));
  const nameOf = (id: string) => (id === CURRENT ? 'the current text' : (versions.find((v) => v.id === id)?.label ?? ''));
  const older = from != null && versions.some((v) => v.id === from) ? from : null;
  const compared = useMemo(() => {
    if (older == null) return null;
    const a = textOf(older);
    const b = textOf(to);
    const sa = parseDbml(a).schema;
    const sb = parseDbml(b).schema;
    return { diff: diffSchemas(sa, sb), lines: diffLines(a, b), schemas: [sa, sb] as const };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [older, to, project.schema.dbml, versions]);
  const migration = useMemo(() => (compared ? migrationSql(compared.schemas[0], compared.schemas[1], dialect) : null), [compared, dialect]);

  const save = () => {
    let id = '';
    apply((p) => {
      const r = saveSchemaVersion(p, label, new Date());
      id = r.id;
      return r.project;
    });
    setLabel('');
    if (id) setFrom(id);
  };
  const copy = (text: string, done: string) =>
    void copyText(text).then(
      () => setSaid(done),
      (e: Error) => setSaid(e.message),
    );

  return (
    <Dialog title="Schema versions" onClose={onClose} className="w-[960px] max-w-[calc(100vw-32px)]">
      <div className="puddle-schema-versions">
        <div className="puddle-schema-versions__list">
          <div className="flex items-end gap-2">
            <Field label="Label" htmlFor="version-label">
              <TextInput
                id="version-label"
                value={label}
                placeholder={nextVersionLabel(versions)}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => {
                  // Enter saves the version rather than submitting the dialog.
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  save();
                }}
                data-autofocus
              />
            </Field>
            <Button variant="primary" icon="plus" onClick={save}>
              Save version
            </Button>
          </div>
          <p className="text-label text-ink-muted" data-testid="versions-size">
            {versions.length ? `${versions.length} ${versions.length === 1 ? 'version adds' : 'versions add'} ${formatBytes(versionsSize(versions))} to the project file.` : 'No versions yet. Save one to come back to it or compare with it.'}
          </p>
          <ul className="ui-steps" aria-label="Versions" data-testid="versions">
            {versions.map((v: SchemaVersion) => (
              <li key={v.id} className={cx('ui-step', older === v.id && 'is-selected')} data-testid={`version-${v.label}`}>
                {renaming?.id === v.id ? (
                  <TextInput
                    aria-label="Version label"
                    value={renaming.label}
                    autoFocus
                    onChange={(e) => setRenaming({ id: v.id, label: e.target.value })}
                    onBlur={() => {
                      apply((p) => renameSchemaVersion(p, v.id, renaming.label));
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        setRenaming(null);
                      }
                    }}
                  />
                ) : (
                  <button type="button" className="ui-step__label flex items-baseline gap-2 text-left" aria-pressed={older === v.id} onClick={() => setFrom(v.id)}>
                    <span className="min-w-0 flex-1 truncate">{v.label}</span>
                    <span className="ui-metric">{formatInstant(v.at)}</span>
                  </button>
                )}
                <Menu
                  label={`Actions for ${v.label}`}
                  button={{ variant: 'ghost', size: 'sm', icon: 'more', iconOnly: true }}
                  items={[
                    { label: 'Restore', hint: 'Make this the current text; Undo takes it back', onSelect: () => apply((p) => restoreSchemaVersion(p, v.id)) },
                    { label: 'Rename…', onSelect: () => setRenaming({ id: v.id, label: v.label }) },
                    { label: 'Delete', onSelect: () => apply((p) => deleteSchemaVersion(p, v.id)) },
                  ]}
                />
              </li>
            ))}
          </ul>
        </div>
        <div className="puddle-schema-versions__compare">
          {older == null || !compared ? (
            <p className="text-ink-muted">Save a version, then pick it to see what changed since.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <p className="pb-2">
                  From <strong>{nameOf(older)}</strong> to
                </p>
                <Select
                  aria-label="Compare with"
                  value={to}
                  options={[{ value: CURRENT, label: 'The current text' }, ...versions.filter((v) => v.id !== older).map((v) => ({ value: v.id, label: v.label }))]}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
              <Tabs
                items={[
                  { id: 'changes', label: 'Changes', count: compared.diff.changes.length },
                  { id: 'dbml', label: 'DBML' },
                  { id: 'migration', label: 'Migration' },
                ]}
                value={tab}
                onChange={(id) => setTab(id as Tab)}
              />
              {tab === 'changes' && (
                <div className="flex flex-col gap-3" data-testid="version-changes">
                  {!compared.diff.changes.length && <p className="text-ink-muted">No changes.</p>}
                  {compared.diff.tables
                    .filter((t) => t.changes.length)
                    .map((t) => (
                      <Section key={`${t.schema}.${t.name}`} title={qualified(t.schema, t.name)} count={t.changes.length}>
                        <ul className="puddle-schema-changes">
                          {t.changes.map((c, i) => (
                            <li key={i} className={ACTION_CLASS[c.action]}>
                              {c.text}
                            </li>
                          ))}
                        </ul>
                      </Section>
                    ))}
                  {[...compared.diff.enums, ...compared.diff.other].length > 0 && (
                    <Section title="Enums and the rest" count={compared.diff.enums.length + compared.diff.other.length}>
                      <ul className="puddle-schema-changes">
                        {[...compared.diff.enums, ...compared.diff.other].map((c, i) => (
                          <li key={i} className={ACTION_CLASS[c.action]}>
                            {c.text}
                          </li>
                        ))}
                      </ul>
                    </Section>
                  )}
                </div>
              )}
              {tab === 'dbml' && (
                <pre className="puddle-schema-sql puddle-schema-linediff" tabIndex={0} aria-label="The DBML, older and newer" data-testid="version-dbml">
                  {compared.lines.map((l, i) => (
                    <span key={i} className={cx('puddle-schema-linediff__line', l.op === 'added' && 'is-added', l.op === 'removed' && 'is-removed')}>
                      {l.op === 'added' ? '+ ' : l.op === 'removed' ? '- ' : '  '}
                      {l.text}
                      {'\n'}
                    </span>
                  ))}
                </pre>
              )}
              {tab === 'migration' && migration && (
                <>
                  <div className="flex items-end gap-2">
                    <Field label="Database" htmlFor="migration-dialect">
                      <Select
                        id="migration-dialect"
                        value={dialect}
                        options={DDL_DIALECTS.map((d) => ({ value: d, label: DIALECT_RULES[d].label }))}
                        onChange={(e) => {
                          lastDialect = e.target.value as DdlDialect;
                          setDialect(lastDialect);
                        }}
                      />
                    </Field>
                    <Button size="sm" variant="ghost" icon="paste" onClick={() => copy(migration.sql, 'Copied the migration.')}>
                      Copy
                    </Button>
                    <Button size="sm" variant="ghost" icon="export" onClick={() => saveBlob(new Blob([migration.sql], { type: 'application/sql' }), 'migration.sql')}>
                      Download migration.sql
                    </Button>
                  </div>
                  {migration.lossy.length > 0 && (
                    <div data-testid="migration-lossy">
                      <Banner tone="warn" title="These statements lose data">
                        <ul>
                          {migration.lossy.map((l) => (
                            <li key={l}>{l}</li>
                          ))}
                        </ul>
                      </Banner>
                    </div>
                  )}
                  {migration.warnings.length > 0 && (
                    <Banner tone="info" title="To do by hand">
                      <ul>
                        {migration.warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    </Banner>
                  )}
                  <pre className="puddle-schema-sql" tabIndex={0} aria-label="The migration" data-testid="migration-preview">
                    {migration.sql}
                  </pre>
                  <p className="text-label text-ink-muted">A preview to read and run by hand: Puddle doesn’t connect to databases.</p>
                </>
              )}
              {said && (
                <p className="text-label text-ink-muted" role="status">
                  {said}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
