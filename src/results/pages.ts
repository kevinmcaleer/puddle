export type Row = Array<string | null>;

/**
 * Loads a result in pages as the grid scrolls. Pages are fetched once, in the order asked, and dropped
 * when the loader is replaced (a new viewed node or a changed upstream gets a new loader).
 */
export class PageLoader {
  private readonly pages = new Map<number, Row[]>();
  private readonly inflight = new Map<number, Promise<void>>();
  private listeners = new Set<() => void>();
  error: unknown = null;

  constructor(
    private readonly fetchPage: (page: number) => Promise<Row[]>,
    readonly pageSize: number,
  ) {}

  /** The row if its page has arrived, otherwise undefined (the grid draws a loading cell). */
  row(index: number): Row | undefined {
    return this.pages.get(Math.floor(index / this.pageSize))?.[index % this.pageSize];
  }

  /** Rows on pages that have arrived so far. */
  get loadedRows(): number {
    let n = 0;
    for (const p of this.pages.values()) n += p.length;
    return n;
  }

  has(page: number) {
    return this.pages.has(page);
  }

  /** Make sure every page touching rows [first, first + count) is loaded or loading. */
  ensure(first: number, count: number): Promise<void> {
    const from = Math.max(0, Math.floor(first / this.pageSize));
    const to = Math.max(from, Math.floor((first + Math.max(count, 1) - 1) / this.pageSize));
    const jobs: Promise<void>[] = [];
    for (let page = from; page <= to; page++) jobs.push(this.load(page));
    return Promise.all(jobs).then(() => undefined);
  }

  private load(page: number): Promise<void> {
    if (this.pages.has(page)) return Promise.resolve();
    const running = this.inflight.get(page);
    if (running) return running;
    const job = this.fetchPage(page).then(
      (rows) => {
        this.pages.set(page, rows);
        this.inflight.delete(page);
        this.emit();
      },
      (e: unknown) => {
        this.inflight.delete(page);
        this.error = e;
        this.emit();
        throw e;
      },
    );
    this.inflight.set(page, job);
    return job;
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}
