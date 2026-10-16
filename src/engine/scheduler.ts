import { cancelled, stopped, toEngineError } from './errors';
import type { Activity, Priority } from './types';

interface Job<T> {
  run: (signal: AbortSignal) => Promise<T>;
  priority: Priority;
  supersede?: string;
  label?: string;
  controller: AbortController;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
  /** Set when a background job is pre-empted so it is retried rather than rejected. */
  preempted?: boolean;
  /** Set when Stop cancelled it, so it is rejected as stopped rather than superseded. */
  stopped?: boolean;
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
  private current: Activity | null = null;
  private readonly listeners = new Set<(a: Activity | null) => void>();

  constructor(private readonly clock: () => number = Date.now) {}

  submit<T>(run: (signal: AbortSignal) => Promise<T>, opts: { priority?: Priority; supersede?: string; signal?: AbortSignal; label?: string } = {}): Promise<T> {
    const priority = opts.priority ?? 'preview';
    return new Promise<T>((resolve, reject) => {
      const job: Job<T> = { run, priority, supersede: opts.supersede, label: opts.label, controller: new AbortController(), resolve, reject };
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

  /** The job running now, or null when the engine is idle. */
  get activity(): Activity | null {
    return this.current;
  }

  /** Hear when a job starts running or the engine goes idle. */
  subscribe(fn: (a: Activity | null) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /**
   * Stop: cancel the running job in DuckDB and drop everything queued. Each one rejects as stopped, so the UI can
   * say so and offer to run it again. Returns how many jobs were stopped.
   */
  stop(): number {
    const all = [...this.preview, ...this.background, ...(this.running ? [this.running] : [])];
    for (const j of all) this.cancel(j, true);
    return all.length;
  }

  private setActivity(a: Activity | null) {
    this.current = a;
    for (const fn of this.listeners) fn(a);
  }

  private cancelWhere(pred: (j: Job<unknown>) => boolean) {
    for (const j of [...this.preview, ...this.background]) if (pred(j)) this.cancel(j);
    if (this.running && pred(this.running)) this.cancel(this.running);
  }

  private cancel(job: Job<unknown>, stop = false) {
    job.preempted = false;
    if (stop) job.stopped = true;
    job.controller.abort();
    const drop = (q: Job<unknown>[]) => {
      const i = q.indexOf(job);
      if (i >= 0) q.splice(i, 1);
      return i >= 0;
    };
    if (drop(this.preview) || drop(this.background)) job.reject(stop ? stopped() : cancelled());
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
        this.setActivity({ label: job.label ?? 'Running a query', priority: job.priority, startedAt: this.clock() });
        try {
          const value = await job.run(job.controller.signal);
          if (job.controller.signal.aborted) throw job.stopped ? stopped() : cancelled();
          job.resolve(value);
        } catch (e) {
          if (job.preempted) {
            job.preempted = false;
            job.controller = new AbortController();
            this.background.unshift(job);
          } else {
            job.reject(job.stopped ? stopped() : job.controller.signal.aborted ? cancelled() : toEngineError(e));
          }
        } finally {
          this.running = null;
        }
        if (!this.preview.length && !this.background.length) this.setActivity(null);
      }
    } finally {
      this.pumping = false;
    }
  }
}
