import { EngineError, isCancelled, isStopped } from './errors';
import { Scheduler } from './scheduler';

/** A job that finishes when released, and notices aborts the way DuckDB's cancelSent does. */
function gate<T>(value: T, log: string[], name: string) {
  let release!: () => void;
  const done = new Promise<void>((r) => (release = r));
  const run = async (signal: AbortSignal) => {
    log.push(`start ${name}`);
    await Promise.race([done, new Promise<void>((r) => signal.addEventListener('abort', () => r(), { once: true }))]);
    if (signal.aborted) {
      log.push(`abort ${name}`);
      throw new Error('INTERRUPT Error: Interrupted!');
    }
    log.push(`end ${name}`);
    return value;
  };
  return { run, release: () => release() };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('Scheduler', () => {
  it('cancels a queued preview when a newer one supersedes it', async () => {
    const s = new Scheduler();
    const log: string[] = [];
    const a = s.submit(async () => 'a', { supersede: 'preview' });
    const b = s.submit(async () => 'b', { supersede: 'preview' });
    await expect(a).rejects.toSatisfy(isCancelled);
    await expect(b).resolves.toBe('b');
    expect(log).toEqual([]);
  });

  it('cancels a running preview and never delivers its result', async () => {
    const s = new Scheduler();
    const log: string[] = [];
    const slow = gate('old rows', log, 'old');
    const first = s.submit(slow.run, { supersede: 'preview' });
    await tick();
    const second = s.submit(async () => 'new rows', { supersede: 'preview' });
    await expect(first).rejects.toSatisfy(isCancelled);
    await expect(second).resolves.toBe('new rows');
    expect(log).toEqual(['start old', 'abort old']);
  });

  it('drops a result that arrives after its job was cancelled', async () => {
    const s = new Scheduler();
    const controller = new AbortController();
    let finish!: (v: string) => void;
    const p = s.submit(() => new Promise<string>((r) => (finish = r)), { signal: controller.signal });
    await tick();
    controller.abort();
    finish('late');
    await expect(p).rejects.toSatisfy(isCancelled);
  });

  it('runs previews before background work and pre-empts running background jobs', async () => {
    const s = new Scheduler();
    const log: string[] = [];
    const profile = gate('profile', log, 'profile');
    const bg = s.submit(profile.run, { priority: 'background' });
    await tick();
    const preview = s.submit(async () => {
      log.push('preview');
      return 'rows';
    });
    await expect(preview).resolves.toBe('rows');
    await tick();
    profile.release();
    await expect(bg).resolves.toBe('profile');
    expect(log).toEqual(['start profile', 'abort profile', 'preview', 'start profile', 'end profile']);
  });

  it('orders queued work by priority', async () => {
    const s = new Scheduler();
    const log: string[] = [];
    const job = (name: string) => async () => void log.push(name);
    await Promise.all([s.submit(job('bg1'), { priority: 'background' }), s.submit(job('p1')), s.submit(job('bg2'), { priority: 'background' }), s.submit(job('p2'))]);
    expect(log).toEqual(['p1', 'p2', 'bg1', 'bg2']);
  });

  it('rejects an already-aborted token and wraps errors', async () => {
    const s = new Scheduler();
    await expect(s.submit(async () => 1, { signal: AbortSignal.abort() })).rejects.toSatisfy(isCancelled);
    await expect(s.submit(async () => { throw new Error('Parser Error: syntax error at or near "SELEC"'); })).rejects.toBeInstanceOf(EngineError);
    expect(s.size).toBe(0);
  });

  it('reports the running job, with its label and start time, and goes idle after', async () => {
    let t = 1000;
    const s = new Scheduler(() => t);
    const seen: (string | null)[] = [];
    s.subscribe((a) => seen.push(a ? `${a.label}@${a.startedAt}` : null));
    const log: string[] = [];
    const count = gate(7, log, 'count');
    const done = s.submit(count.run, { priority: 'background', label: 'Counting rows' });
    await tick();
    expect(s.activity).toEqual({ label: 'Counting rows', priority: 'background', startedAt: 1000 });
    t = 2000;
    count.release();
    await expect(done).resolves.toBe(7);
    await s.submit(async () => 1);
    expect(seen).toEqual(['Counting rows@1000', null, 'Running a query@2000', null]);
    expect(s.activity).toBeNull();
  });

  it('Stop cancels the running job in DuckDB and drops the queue, each rejecting as stopped', async () => {
    const s = new Scheduler();
    const log: string[] = [];
    const slow = gate('rows', log, 'slow');
    const running = s.submit(slow.run, { label: 'Exporting' });
    const queued = s.submit(async () => 'never', { priority: 'background' });
    await tick();
    expect(s.stop()).toBe(2);
    await expect(running).rejects.toSatisfy(isStopped);
    await expect(queued).rejects.toSatisfy(isStopped);
    await expect(running).rejects.toMatchObject({ message: 'Stopped before it finished.' });
    expect(log).toEqual(['start slow', 'abort slow']);
    // The engine stays usable.
    await expect(s.submit(async () => 'next')).resolves.toBe('next');
    expect(s.size).toBe(0);
    expect(s.activity).toBeNull();
  });

  it('a stopped background job is not requeued even if a preview pre-empted it', async () => {
    const s = new Scheduler();
    const log: string[] = [];
    const profile = gate('profile', log, 'profile');
    const bg = s.submit(profile.run, { priority: 'background' });
    await tick();
    const preview = s.submit(async () => 'rows');
    s.stop();
    await expect(bg).rejects.toSatisfy(isStopped);
    await expect(preview).rejects.toSatisfy(isStopped);
    expect(s.size).toBe(0);
  });
});
