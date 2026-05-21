/**
 * Counting semaphore — bounds concurrency for `pool.map()` et al.
 * Implementation is intentionally trivial: a FIFO queue of waiters.
 *
 *   const sem = new Semaphore(4);
 *   await sem.acquire();
 *   try { await work(); } finally { sem.release(); }
 */
export class Semaphore {
  private _permits: number;
  private _waiters: Array<() => void> = [];

  constructor(permits: number) {
    if (permits <= 0 || !Number.isFinite(permits)) {
      // Treat Infinity (or non-positive) as "unbounded".
      this._permits = Number.POSITIVE_INFINITY;
    } else {
      this._permits = permits;
    }
  }

  async acquire(): Promise<void> {
    if (this._permits === Number.POSITIVE_INFINITY) return;
    if (this._permits > 0) {
      this._permits--;
      return;
    }
    return new Promise<void>((resolve) => this._waiters.push(resolve));
  }

  release(): void {
    if (this._permits === Number.POSITIVE_INFINITY) return;
    const next = this._waiters.shift();
    if (next) next();
    else this._permits++;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
