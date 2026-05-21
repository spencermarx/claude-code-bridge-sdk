/**
 * A Promise paired with its resolve/reject functions, exposed for external control.
 * Used wherever the SDK needs to signal completion from outside the Promise executor —
 * e.g. resolving `sessionId` on receipt of the upstream `init` system message.
 */
export class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T | PromiseLike<T>) => void;
  reject!: (reason?: unknown) => void;

  private _settled = false;

  constructor() {
    this.promise = new Promise<T>((res, rej) => {
      this.resolve = (value) => {
        if (this._settled) return;
        this._settled = true;
        res(value);
      };
      this.reject = (reason) => {
        if (this._settled) return;
        this._settled = true;
        rej(reason);
      };
    });
    this.promise.catch(() => {
      // prevent unhandled rejection warning when no one awaits the promise
    });
  }

  get settled(): boolean {
    return this._settled;
  }
}
