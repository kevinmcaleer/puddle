// Cron schedules for the runner. Pure: when a project runs next, and why a schedule can't be read.
import { Cron } from 'croner';

/** Why a schedule can't be used, in plain words, or undefined when it can. */
export function scheduleProblem(schedule: string): string | undefined {
  const text = schedule.trim();
  if (!text) return 'is empty';
  try {
    new Cron(text, { paused: true }).stop();
    return undefined;
  } catch (e) {
    return `isn’t cron syntax (${e instanceof Error ? e.message : String(e)})`;
  }
}

/** When the schedule next fires after `from`, or undefined when it never does or can't be read. */
export function nextRun(schedule: string, from: Date = new Date(), timezone?: string): Date | undefined {
  if (scheduleProblem(schedule)) return undefined;
  const job = new Cron(schedule.trim(), { paused: true, ...(timezone ? { timezone } : {}) });
  const next = job.nextRun(from) ?? undefined;
  job.stop();
  return next;
}
