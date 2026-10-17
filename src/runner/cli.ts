// puddle-run: run a .puddle.json once, or watch a folder and run each project on its schedule.
//   puddle-run run <project.puddle.json> [--out <folder>]
//   puddle-run watch <folder> [--out <folder>] [--poll <seconds>]
//   puddle-run check <project.puddle.json>
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { Cron } from 'croner';
import { readProjectFile } from '../persistence/migrate';
import type { Project } from '../model';
import { openDb } from './db';
import { runProject, runSucceeded } from './run';
import { nextRun, scheduleProblem } from './schedule';
import { placeSources } from './sources';
import { existsSync } from 'node:fs';

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
    const { log } = await runProject(project, { folder, outDir, db, fetchText, log: say });
    say(`Finished ${project.name} in ${log.durationMs} ms: ${log.outputs.map((o) => `${o.nodeName} ${o.status}`).join(', ') || 'no Output nodes'}`);
    return runSucceeded(log);
  } finally {
    await db.close();
  }
}

/** Say what a run of this project would do: its sources, its outputs and its schedule. */
export function check(path: string): boolean {
  const file = resolve(path);
  const project = readProject(file);
  const folder = dirname(file);
  let ok = true;
  console.log(`${project.name}`);
  for (const p of placeSources(project, folder, existsSync)) {
    if (p.path === undefined) ok = false;
    console.log(`  source ${p.source.name}: ${p.path === undefined ? p.reason : p.path || 'pasted text'}`);
  }
  for (const n of project.nodes) if (n.type === 'output') console.log(`  output ${n.name}: ${n.outputSpec.format}`);
  const schedule = project.settings.schedule;
  if (!schedule) console.log('  schedule: none (set one in the Project tab to run it from a folder)');
  else {
    const problem = scheduleProblem(schedule);
    if (problem) {
      ok = false;
      console.log(`  schedule: “${schedule}” ${problem}`);
    } else console.log(`  schedule: ${schedule}, next at ${nextRun(schedule)?.toISOString() ?? 'never'}`);
  }
  return ok;
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

Outputs, the run log (<project>.run.json) and the quality report (<project>.quality.md) go to --out,
by default an out/ folder beside the project file. Source files are found by their runner path (set on the
source in the editor), or by name beside the project file or in its sources/ folder.`;

async function main(argv: string[]) {
  const { command, target, out, poll } = parseArgs(argv);
  if (command === 'run' && target) process.exitCode = (await runOnce(target, out)) ? 0 : 1;
  else if (command === 'check' && target) process.exitCode = check(target) ? 0 : 1;
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
