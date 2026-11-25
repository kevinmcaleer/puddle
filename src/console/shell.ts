// Running a shell command: each statement in turn, its answer added to the shell's history. Queries and DESCRIBE are
// answered from DuckDB; statements that make or change tables go into a SQL node's script (see shellChange.ts) and
// the shell shows the table's first rows; dot commands answer from the project.
import { useSession } from '../app/session';
import {
  compileShellCount,
  compileShellDescribe,
  compileShellPreview,
  compileShellQuery,
  compileShellTable,
  customSqlErrorLine,
  DOT_COMMANDS,
  INPUT_NAME,
  likePattern,
  readShellCommand,
  schemaStatement,
  SHELL_ROW_LIMIT,
  shellNames,
  sqlReads,
  type ShellStatement,
} from '../compiler';
import { isCancelled, tableColumns, tableRows, toEngineError, type EngineClient } from '../engine';
import { applySample } from '../flow/sampling';
import { currentSample } from '../flow/sample';
import { useFlowStore } from '../flow/status';
import { nodeById, useProjectStore, type ColumnSchema, type Project } from '../model';
import { viewNode } from '../results/pin';
import { NODE_KIND, type NodeKind } from '../ui/nodeKinds';
import { makeSqlNode } from './actions';
import { useConsoleDraft, type ShellOutput } from './draft';
import { planShellChange, tableNodeOf, type ShellTouch } from './shellChange';

/** The project as the results table shows it (with its sample, if any), as it is now. */
function viewProject(): Project {
  const p = useProjectStore.getState().history.present;
  return applySample(p, currentSample(p));
}

/** Select a node and show its rows in the results table. */
export function viewTable(nodeId: string) {
  useSession.getState().select(nodeId);
  viewNode(nodeId);
}

/** Keep the prompt's query as a SQL node after the viewed node; its answer in the shell says where it went. */
export function keepAsSqlNode(viewedId: string, query: string) {
  const added = makeSqlNode(viewedId, query);
  if (!added) return;
  const { entries, update } = useConsoleDraft.getState();
  const last = entries[entries.length - 1];
  if (last?.output.kind === 'rows' && last.command.trim() === query.trim()) update(last.id, { kind: 'kept', nodeId: added, name: nodeById(useProjectStore.getState().history.present, added)?.name ?? 'the SQL node' });
}

/** Statements run together: changes one after another are one step, so one undo takes them back. */
function grouped(statements: ShellStatement[]): ShellStatement[][] {
  const groups: ShellStatement[][] = [];
  for (const s of statements) {
    const last = groups[groups.length - 1];
    if (s.kind === 'change' && last?.[0]?.kind === 'change') last.push(s);
    else groups.push([s]);
  }
  return groups;
}

const plain = (rows: Record<string, unknown>[]) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])));

/**
 * Run a shell command: each statement answered in the shell's history, in order. Stops at the first statement that
 * fails. Returns what to announce to a screen reader, if anything.
 */
export async function runShellCommand(engine: EngineClient, command: string, viewedId: string | undefined): Promise<string | undefined> {
  const draft = useConsoleDraft.getState();
  draft.remember(command.trim());
  let said: string | undefined;
  for (const group of grouped(readShellCommand(command))) {
    const ok = group[0]!.kind === 'change' ? await runChange(engine, group, viewedId) : await runOne(engine, group[0]!, viewedId);
    if (ok === false) break;
    if (typeof ok === 'string') said = ok;
  }
  return said;
}

/** The name `input` stands for, when the statement reads it. */
function inputName(project: Project, viewedId: string | undefined, sql: string): string | undefined {
  if (!viewedId || !sqlReads(sql).includes(INPUT_NAME)) return undefined;
  return nodeById(project, viewedId)?.name;
}

async function answer(engine: EngineClient, entryId: number, sql: string, query: string, names: string[], title?: string): Promise<boolean> {
  const { update } = useConsoleDraft.getState();
  try {
    const t0 = performance.now();
    const r = await engine.query(sql, { label: 'Running the shell command', supersede: 'console' });
    update(entryId, { kind: 'rows', columns: tableColumns(r.table), rows: plain(tableRows(r.table)), ms: performance.now() - t0, ...(title ? { title } : {}) });
    return true;
  } catch (e) {
    if (isCancelled(e)) {
      update(entryId, { kind: 'text', text: 'Stopped.' });
      return false;
    }
    const err = toEngineError(e);
    update(entryId, { kind: 'error', title: 'DuckDB refused the query', message: err.message, line: customSqlErrorLine(sql, query, err.detail ?? err.message, names) });
    return false;
  }
}

async function runOne(engine: EngineClient, s: ShellStatement, viewedId: string | undefined): Promise<boolean | string> {
  const { add, update, clear } = useConsoleDraft.getState();
  const project = viewProject();
  const names = shellNames(project, viewedId);
  switch (s.kind) {
    case 'refused': {
      add({ command: s.text, output: { kind: 'error', title: 'The shell can’t do this', message: `${s.problem[0]!.toUpperCase()}${s.problem.slice(1)}.` } });
      return false;
    }
    case 'query':
    case 'describe': {
      const id = add({ command: s.text, ...(inputName(project, viewedId, s.query) ? { input: inputName(project, viewedId, s.query) } : {}), output: { kind: 'running' } });
      let sql: string;
      try {
        sql = s.kind === 'query' ? compileShellQuery(project, names, s.query, SHELL_ROW_LIMIT) : compileShellDescribe(project, names, s);
      } catch (e) {
        update(id, { kind: 'error', title: 'This query can’t run', message: (e as Error).message });
        return false;
      }
      return answer(engine, id, sql, s.query, [...names.keys()]);
    }
    case 'tables': {
      const statuses = useFlowStore.getState().nodes;
      const tables = [...names]
        .filter(([name]) => name !== INPUT_NAME)
        .map(([, nodeId]) => nodeById(project, nodeId)!)
        .filter((n) => !s.pattern || likePattern(s.pattern, n.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((n) => {
          const st = statuses[n.id]?.status;
          return { name: n.name, nodeId: n.id, type: NODE_KIND[n.type as NodeKind]?.label ?? n.type, ...(st?.state === 'ok' ? { columns: st.columns.length } : {}) };
        });
      add({ command: s.text, output: { kind: 'tables', tables } });
      return true;
    }
    case 'dot': {
      if (s.name === 'clear') {
        clear();
        return 'The shell is cleared';
      }
      if (s.name === 'help') {
        const text = [
          'DuckDB SQL runs here against the project: every node is a table by its name, and the viewed node is input.',
          '',
          '  SELECT ... FROM name          answer a query (up to 200 rows)',
          '  DESCRIBE name | SHOW name     its columns and types; SUMMARIZE name for statistics; EXPLAIN SELECT ...',
          '  SHOW TABLES                   the tables, as .tables',
          '  CREATE TABLE name AS SELECT   a new table, kept in a SQL node with a node of its own on the canvas',
          '  CREATE TABLE name (col TYPE)  a new empty table; then INSERT INTO name VALUES (...)',
          '  INSERT, UPDATE, DELETE        change a table the shell (or a SQL script) made',
          '  ALTER TABLE, DROP TABLE       add, drop or rename its columns; rename or drop it',
          '',
          ...DOT_COMMANDS.map((d) => `  ${d.usage.padEnd(30)}${d.does}`),
          '',
          'Up and down bring back earlier commands. Ctrl+Z undoes a change. Files and databases are added as sources from the Add menu.',
        ].join('\n');
        add({ command: s.text, output: { kind: 'text', text, code: true } });
        return true;
      }
      if (s.name === 'schema') {
        const id = add({ command: s.text, output: { kind: 'running' } });
        const wanted = [...names].filter(([name]) => name !== INPUT_NAME && (!s.arg || name === s.arg.replace(/^"(.*)"$/, '$1').toLowerCase()));
        if (!wanted.length) {
          update(id, { kind: 'error', title: 'No such table', message: `There’s no table ${s.arg}: .tables lists them.` });
          return false;
        }
        const lines: string[] = [];
        for (const [name, nodeId] of wanted) {
          const n = nodeById(project, nodeId)!;
          const st = useFlowStore.getState().nodes[nodeId]?.status;
          let columns: ColumnSchema[] | undefined = st?.state === 'ok' ? st.columns : undefined;
          if (!columns) {
            try {
              columns = await engine.describe(compileShellTable(project, names, name), { label: 'Reading columns' });
            } catch (e) {
              lines.push(`-- ${n.name}: ${toEngineError(e).message}`);
              continue;
            }
          }
          lines.push(schemaStatement(n.name, columns));
        }
        update(id, { kind: 'text', text: lines.join('\n'), code: true });
        return true;
      }
      return false;
    }
    default:
      return false;
  }
}

/** What a change did, in words: Created sales, Inserted into sales... */
function said(t: ShellTouch): string {
  switch (t.change) {
    case 'create':
    case 'declare':
      return `Created ${t.table}.`;
    case 'replace':
      return `Made ${t.table} again.`;
    case 'insert':
      return `Inserted rows into ${t.table}.`;
    case 'update':
      return `Updated ${t.table}.`;
    case 'delete':
      return `Deleted rows from ${t.table}.`;
    case 'alter':
      return `Changed ${t.table}’s columns.`;
    case 'rename':
      return `Renamed ${t.from} to ${t.table}.`;
    case 'drop':
      return `Dropped ${t.table}.`;
  }
}

async function runChange(engine: EngineClient, group: ShellStatement[], viewedId: string | undefined): Promise<boolean | string> {
  const { add, update, hostId, setHost } = useConsoleDraft.getState();
  const store = useProjectStore.getState();
  const texts = group.map((s) => s.text);
  const before = store.history.present;
  const id = add({ command: texts.join(';\n'), ...(inputName(before, viewedId, texts.join(';\n')) ? { input: inputName(before, viewedId, texts.join(';\n')) } : {}), output: { kind: 'running' } });
  const plan = planShellChange(before, texts, viewedId, hostId);
  if ('problem' in plan) {
    update(id, { kind: 'error', title: 'This can’t run', message: `${plan.problem[0]!.toUpperCase()}${plan.problem.slice(1)}.` });
    return false;
  }
  store.apply(() => plan.project);
  setHost(plan.hostId);
  // A new SQL node is selected, so its script is in the inspector; the rows shown (and `input`) stay as they were.
  if (plan.created) useSession.getState().select(plan.hostId);
  const message = plan.touched.map(said).join(' ');
  // The last table touched that is still there: shown here, its node a click away.
  const shown = [...plan.touched].reverse().find((t) => t.change !== 'drop');
  const after = viewProject();
  const nodeId = shown ? tableNodeOf(after, plan.hostId, shown.table) : undefined;
  if (!nodeId) {
    update(id, { kind: 'table', message });
    return message;
  }
  const output: ShellOutput = { kind: 'table', message, nodeId };
  try {
    const counted = await engine.query(compileShellCount(after, nodeId), { label: 'Counting the table’s rows' });
    const n = Number(Object.values(tableRows(counted.table)[0] ?? {})[0] ?? 0);
    const r = await engine.query(compileShellPreview(after, nodeId), { label: 'Reading the table', supersede: 'console' });
    update(id, { ...output, message: `${message} ${shown!.table} has ${n} ${n === 1 ? 'row' : 'rows'}.`, columns: tableColumns(r.table), rows: plain(tableRows(r.table)) });
    return `${message} ${shown!.table} has ${n} ${n === 1 ? 'row' : 'rows'}`;
  } catch (e) {
    if (isCancelled(e)) {
      update(id, output);
      return message;
    }
    // Kept in the script all the same: the node says what is wrong, and Ctrl+Z takes the change back.
    const err = toEngineError(e);
    update(id, { kind: 'error', title: 'DuckDB refused the change', message: `${err.message} The change is in the script; Ctrl+Z takes it back.` });
    return false;
  }
}
