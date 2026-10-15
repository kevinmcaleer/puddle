import { cancelled, toEngineError } from './errors';
import type { Priority } from './types';

interface Job<T> {
  run: (signal: AbortSignal) => Promise<T>;
  priority: Priority;
  supersede?: string;
  controller: AbortController;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
  /** Set when a background job is pre-empted so it is retried rather than rejected. */
  preempted?: boolean;
}

/**
 * Runs engine jobs one at a time. Preview jobs go ahead of background jobs, and a preview arriving while a
 * background job runs pre-empts it (the background job is cancelled in DuckDB and requeued). Jobs with the
 * same supersede key cancel the earlier one.
 */
export class Scheduler {
  private preview: Job<unknown>[] = [];
  private background: Job<unknown>[] = [];
  private running: Job<unknown> | null = null;
  private pumping = false;

  submit<T>(run: (signal: AbortSignal) => Promise<T>, opts: { priority?: Priority; supersede?: string; signal?: AbortSignal } = {}): Promise<T> {
    const priority = opts.priority ?? 'preview';
    return new Promise<T>((resolve, reject) => {
      const job: Job<T> = { run, priority, supersede: opts.supersede, controller: new AbortController(), resolve, reject };
      if (opts.signal) {
        if (opts.signal.aborted) return reject(cancelled());
        opts.signal.addEventListener('abort', () => this.cancel(job as Job<unknown>), { once: true });
      }
      if (job.supersede) this.cancelWhere((j) => j.supersede === job.supersede);
      (priority === 'preview' ? this.preview : this.background).push(job as Job<unknown>);
      if (priority === 'preview' && this.running?.priority === 'background') {
        this.running.preempted = true;
        this.running.controller.abort();
      }
      queueMicrotask(() => void this.pump());
    });
  }

  /** Number of jobs queued or running, for tests and the status strip. */
  get size() {
    return this.preview.length + this.background.length + (this.running ? 1 : 0);
  }

  private cancelWhere(pred: (j: Job<unknown>) => boolean) {
    for (const j of [...this.preview, ...this.background]) if (pred(j)) this.cancel(j);
    if (this.running && pred(this.running)) this.cancel(this.running);
  }

  private cancel(job: Job<unknown>) {
    job.preempted = false;
    job.controller.abort();
    const drop = (q: Job<unknown>[]) => {
      const i = q.indexOf(job);
      if (i >= 0) q.splice(i, 1);
      return i >= 0;
    };
    if (drop(this.preview) || drop(this.background)) job.reject(cancelled());
    // A running job is rejected by pump() once DuckDB returns, so its result is never delivered.
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        const job = this.preview.shift() ?? this.background.shift();
        if (!job) break;
        this.running = job;
        try {
          const value = await job.run(job.controller.signal);
          if (job.controller.signal.aborted) throw cancelled();
          job.resolve(value);
        } catch (e) {
          if (job.preempted) {
            job.preempted = false;
            job.controller = new AbortController();
            this.background.unshift(job);
          } else {
            job.reject(job.controller.signal.aborted ? cancelled() : toEngineError(e));
          }
        } finally {
          this.running = null;
        }
      }
    } finally {
      this.pumping = false;
    }
  }
}
