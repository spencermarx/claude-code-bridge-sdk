/**
 * An AsyncIterable backed by an in-memory queue. Producers `push` values;
 * consumers iterate. Used by Session for both:
 *
 *   - inbound user messages → upstream `query()` streaming input
 *   - per-turn outbound messages → DualHandle source
 *
 * Tiny and bounded. Multiple readers are not supported — single producer,
 * single consumer.
 */
export class Pushable<T> implements AsyncIterable<T> {
  private _queue: T[] = [];
  private _waiters: Array<{
    resolve: (r: IteratorResult<T>) => void;
    reject: (err: unknown) => void;
  }> = [];
  private _done = false;
  private _error: unknown = undefined;

  push(value: T): void {
    if (this._done || this._error !== undefined) return;
    const waiter = this._waiters.shift();
    if (waiter) {
      waiter.resolve({ value, done: false });
    } else {
      this._queue.push(value);
    }
  }

  end(): void {
    if (this._done) return;
    this._done = true;
    while (this._waiters.length > 0) {
      const w = this._waiters.shift();
      if (w) w.resolve({ value: undefined as unknown as T, done: true });
    }
  }

  fail(err: unknown): void {
    if (this._done) return;
    this._error = err;
    while (this._waiters.length > 0) {
      const w = this._waiters.shift();
      if (w) w.reject(err);
    }
    this._done = true;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this._next(),
      return: async (value) => {
        this.end();
        return { value, done: true };
      },
      throw: async (err) => {
        this.fail(err);
        throw err;
      },
    };
  }

  private _next(): Promise<IteratorResult<T>> {
    if (this._queue.length > 0) {
      return Promise.resolve({ value: this._queue.shift() as T, done: false });
    }
    if (this._error !== undefined) {
      return Promise.reject(this._error);
    }
    if (this._done) {
      return Promise.resolve({ value: undefined as unknown as T, done: true });
    }
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this._waiters.push({ resolve, reject });
    });
  }
}
