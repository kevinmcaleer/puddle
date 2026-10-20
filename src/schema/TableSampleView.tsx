// The data sample in a table's popover on the Schema diagram: its first rows in a compact grid, and how many there are.
import { useEffect, useState } from 'react';
import { useEngineStore } from '../app/engine';
import { useSchemaTables } from '../schemaTables/state';
import { SAMPLE_ROWS, tableSample, type TableSample } from '../schemaTables/sample';
import { useProject } from '../model';
import type { DbmlSchema, Table } from './model';

/** `nodeId` names the node whose rows to show, for a table drawn from the canvas; else it's the table's Schema table node. */
export function TableSampleView({ schema, table, nodeId }: { schema: DbmlSchema; table: Table; nodeId?: string }) {
  const project = useProject();
  const engine = useEngineStore((s) => s.engine);
  // A rebuilt schema can change what the node holds.
  const built = useSchemaTables((s) => s.built);
  const [sample, setSample] = useState<TableSample | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    tableSample(engine, project, schema, table, nodeId).then(
      (s) => live && (setSample(s), setProblem(null)),
      (e: Error) => live && setProblem(e.message),
    );
    return () => {
      live = false;
    };
  }, [engine, project, schema, table, nodeId, built]);

  if (problem) return <p className="puddle-schema-sample__note">No sample: {problem}</p>;
  if (!sample) return <p className="puddle-schema-sample__note">Reading a sample…</p>;
  if (!sample.rows.length) return <p className="puddle-schema-sample__note">{sample.from === 'records' ? 'No rows yet: no records in the DBML, and no Schema table node.' : `No rows in ${sample.from.name} yet.`}</p>;
  return (
    <div className="puddle-schema-sample" data-testid="schema-sample">
      <table>
        <thead>
          <tr>
            {sample.columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sample.rows.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j} className={v == null ? 'is-null' : undefined}>
                  {v ?? 'null'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="puddle-schema-sample__note">
        {sample.total != null && sample.total > SAMPLE_ROWS ? `First ${SAMPLE_ROWS} of ${sample.total} rows` : `${sample.rows.length} ${sample.rows.length === 1 ? 'row' : 'rows'}`}
        {sample.from === 'records' ? ', from the records in the DBML' : `, from ${sample.from.name}`}
      </p>
    </div>
  );
}
