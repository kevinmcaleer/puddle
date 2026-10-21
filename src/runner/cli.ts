// puddle-run: run a .puddle.json once, or watch a folder and run each project on its schedule.
//   puddle-run run <project.puddle.json> [--out <folder>]
//   puddle-run watch <folder> [--out <folder>] [--poll <seconds>]
//   puddle-run check <project.puddle.json>
//   puddle-run analyse <file>
//   puddle-run schema <project.puddle.json | schema.dbml> [--check] [--ddl <dialect> <out.sql>] …
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { Cron } from 'croner';
import { readProjectFile } from '../persistence/migrate';
import { analyseFile, describeAnalysis, sniffFile } from './analyse';
import type { Project, Source } from '../model';
import { openDb } from './db';
import { runProject, runSucceeded } from './run';
import { nextRun, scheduleProblem } from './schedule';
import { SCHEMA_USAGE, schemaCommand } from './schema';
import { placeSources } from './sources';
import { existsSync } from 'node:fs';
import { formatLabel } from '../canvas/formatLabel';

const say = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

function readProject(path: string): Project {
  return readProjectFile(readFileSync(path, 'utf8'));
}

async function fetchText(href: string): Promise<string> {
  const r = await fetch(href);
  if (!r.ok) throw new Error(`${href} answered ${r.status}`);
  return r.text();
}

/** Run one project file once; outputs go to `out`, by default an `out` folder beside the project file. */
export async function runOnce(path: string, out?: string): Promise<boolean> {
  const file = resolve(path);
  const project = readProject(file);
  const folder = dirname(file);
  const outDir = out ? resolve(out) : join(folder, 'out');
  say(`Running ${project.name} (${basename(file)}) into ${outDir}`);
  const db = await openDb();
  try {
    const { log } = await runProject(project, { folder, outDir, db, fetchText, fetchImpl: fetch, log: say });
    say(`Finished ${project.name} in ${log.durationMs} ms: ${log.outputs.map((o) => `${o.nodeName} ${o.status}`).join(', ') || 'no Output nodes'}`);
    return runSucceeded(log);
  } finally {
    await db.close();
  }
}

/**
 * A file found for a source whose content no longer looks like the format the project reads it as: the file was
 * replaced by something else, or saved in another format. Only a sure or likely sniff of a plain file is trusted;
 * an archive is read by its entry, and a sniff that can't tell says nothing.
 */
export function formatChanged(source: Source, path: string): string | undefined {
  if (source.kind !== 'file' || source.archive) return undefined;
  let sniffed;
  try {
    sniffed = sniffFile(path);
  } catch (e) {
    return `looks like ${e instanceof Error ? e.message : String(e)}`;
  }
  if (sniffed.confidence === 'unsure' || sniffed.format === source.format) return undefined;
  // CSV and TSV are read by the same reader, with the delimiter the project saved.
  if ((sniffed.format === 'csv' || sniffed.format === 'tsv') && (source.format === 'csv' || source.format === 'tsv')) return undefined;
  return `now looks like ${formatLabel(sniffed.format)}, not ${formatLabel(source.format)} as the project reads it (${sniffed.reason.replace(/\.$/, '')})`;
}

/** Say what a run of this project would do: its sources, its outputs and its schedule. */
export function check(path: string, out = (line: string) => console.log(line)): boolean {
  const file = resolve(path);
  const project = readProject(file);
  const folder = dirname(file);
  let ok = true;
  out(`${project.name}`);
  for (const p of placeSources(project, folder, existsSync)) {
    if (p.path === undefined) ok = false;
    const changed = p.path ? formatChanged(p.source, p.path) : undefined;
    if (changed) ok = false;
    out(`  source ${p.source.name}: ${p.path === undefined ? p.reason : p.path || 'pasted text'}${changed ? `; ${changed}` : ''}`);
  }
  for (const n of project.nodes) if (n.type === 'output') out(`  output ${n.name}: ${n.outputSpec.format}`);
  const schedule = project.settings.schedule;
  if (!schedule) out('  schedule: none (set one in the Project tab to run it from a folder)');
  else {
    const problem = scheduleProblem(schedule);
    if (problem) {
      ok = false;
      out(`  schedule: “${schedule}” ${problem}`);
    } else out(`  schedule: ${schedule}, next at ${nextRun(schedule)?.toISOString() ?? 'never'}`);
  }
  return ok;
}

/** Sniff, read and analyse one file, and print what the Issues panel would list. True when nothing is wrong with it. */
export async function analyse(path: string, out = (line: string) => console.log(line)): Promise<boolean> {
  const db = await openDb();
  try {
    const result = await analyseFile(path, db, { fetchText, fetchImpl: fetch });
    for (const line of describeAnalysis(result)) out(line);
    return result.issues.every((i) => i.severity === 'info');
  } finally {
    await db.close();
  }
}

interface Watched {
  mtime: number;
  schedule: string;
  job: Cron;
}

/** Every project file in the folder (not its subfolders). */
export const projectFiles = (folder: string) => readdirSync(folder).filter((f) => f.endsWith('.puddle.json')).map((f) => join(folder, f)).sort();

/**
 * Watch a folder: each project file with a schedule runs on it; a file that changes is read again and rescheduled,
 * one that goes is dropped. Polling every `pollMs` keeps it working on network mounts where file events don't arrive.
 */
export function watch(folder: string, { out, pollMs = 30_000 }: { out?: string; pollMs?: number } = {}): () => void {
  const root = resolve(folder);
  const watched = new Map<string, Watched>();
  const outDir = out ? resolve(out) : join(root, 'out');
  const running = new Set<string>();

  const scan = () => {
    let files: string[];
    try {
      files = projectFiles(root);
    } catch (e) {
      say(`Can’t read ${root}: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    for (const [file, w] of watched)
      if (!files.includes(file)) {
        w.job.stop();
        watched.delete(file);
        say(`${basename(file)} is gone; no longer scheduled`);
      }
    for (const file of files) {
      const mtime = statSync(file).mtimeMs;
      const had = watched.get(file);
      if (had && had.mtime === mtime) continue;
      let project: Project;
      try {
        project = readProject(file);
      } catch (e) {
        say(`${basename(file)} can’t be read: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const schedule = project.settings.schedule?.trim() ?? '';
      if (had && had.schedule === schedule) {
        had.mtime = mtime;
        continue;
      }
      had?.job.stop();
      watched.delete(file);
      if (!schedule) {
        say(`${basename(file)} has no schedule; set one in the Project tab`);
        continue;
      }
      const problem = scheduleProblem(schedule);
      if (problem) {
        say(`${basename(file)}: schedule “${schedule}” ${problem}`);
        continue;
      }
      const job = new Cron(schedule, { protect: true }, async () => {
        if (running.has(file)) return;
        running.add(file);
        try {
          await runOnce(file, outDir);
        } catch (e) {
          say(`${basename(file)} failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          running.delete(file);
        }
      });
      watched.set(file, { mtime, schedule, job });
      say(`${basename(file)}: runs on “${schedule}”, next at ${job.nextRun()?.toISOString() ?? 'never'}`);
    }
  };

  scan();
  say(`Watching ${root} for .puddle.json files (every ${Math.round(pollMs / 1000)} s); outputs go to ${outDir}`);
  const timer = setInterval(scan, pollMs);
  return () => {
    clearInterval(timer);
    for (const w of watched.values()) w.job.stop();
  };
}

/** The command line's arguments as a command, its target and its flags. */
export function parseArgs(argv: string[]): { command: string; target?: string; out?: string; poll?: number } {
  const [command = 'help', ...rest] = argv;
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith('--')) flags[a.slice(2)] = rest[++i] ?? '';
    else positional.push(a);
  }
  return { command, target: positional[0], out: flags.out, poll: flags.poll ? Number(flags.poll) : undefined };
}

const USAGE = `puddle-run: run Puddle projects outside the browser, on DuckDB's native build.

  puddle-run run <project.puddle.json> [--out <folder>]    run every Output node once
  puddle-run watch <folder> [--out <folder>] [--poll <s>]   run each project on its schedule
  puddle-run check <project.puddle.json>                    say where its sources are and when it runs
  puddle-run analyse <file>                                 list the issues the editor would find in a file
  puddle-run schema <project.puddle.json | schema.dbml> …   check the schema, write its SQL, docs or a migration

Outputs, the run log (<project>.run.json) and the quality report (<project>.quality.md) go to --out,
by default an out/ folder beside the project file. Source files are found by their runner path (set on the
source in the editor), or by name beside the project file or in its sources/ folder.

${SCHEMA_USAGE}`;

async function main(argv: string[]) {
  const { command, target, out, poll } = parseArgs(argv);
  if (command === 'schema') {
    process.exitCode = schemaCommand(argv.slice(1), { readFile: (f) => readFileSync(f, 'utf8'), writeFile: (f, t) => writeFileSync(f, t), out: (l) => console.log(l), err: (l) => console.error(l) });
    return;
  }
  if (command === 'run' && target) process.exitCode = (await runOnce(target, out)) ? 0 : 1;
  else if (command === 'check' && target) process.exitCode = check(target) ? 0 : 1;
  else if (command === 'analyse' && target) process.exitCode = (await analyse(target)) ? 0 : 1;
  else if (command === 'watch' && target) {
    const stop = watch(target, { out, pollMs: poll ? poll * 1000 : undefined });
    const quit = () => {
      stop();
      process.exit(0);
    };
    process.on('SIGINT', quit);
    process.on('SIGTERM', quit);
  } else {
    console.log(USAGE);
    process.exitCode = command === 'help' ? 0 : 2;
  }
}

if (process.argv[1] && /puddle-run|cli\.(ts|mjs|js)$/.test(process.argv[1])) void main(process.argv.slice(2));
