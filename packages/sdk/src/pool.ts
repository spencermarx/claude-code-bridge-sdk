import type { AskUserHandler } from './internal/ask-user';
import { Pushable } from './internal/pushable';
import { Semaphore } from './internal/semaphore';
import { type RunHandle, type RunOptions, run } from './run';
import { type Session, type SessionOptions, session } from './session';
import type { FinalResult, Options } from './types';

/** Options for `pool()`. */
export interface PoolOptions {
  /** Defaults merged into every spawn; per-spawn overrides win. */
  defaults?: Partial<Options>;
  /** Maximum simultaneous in-flight agents. Default Infinity (no cap). */
  concurrency?: number;
  /** Default AskUserQuestion handler. Per-spawn `onAskUser` overrides. */
  onAskUser?: AskUserHandler;
  /** Aborts every managed agent when fired. */
  signal?: AbortSignal;
}

/**
 * Unified event emitted across every agent the pool manages.
 *
 * Scope for v0.1: only lifecycle events (`started` / `ended` / `error`).
 * Per-message and ask-user routing through this stream is intentionally
 * deferred — they would require an extra fanout layer that hasn't shown
 * its weight yet. Subscribe to individual handles for per-message data.
 */
export type PoolEvent =
  | { type: 'started'; agentId: string; sessionId: Promise<string> }
  | { type: 'ended'; agentId: string; result: FinalResult }
  | { type: 'error'; agentId: string; error: unknown };

/**
 * Concurrency manager for multiple Claude Code agents.
 *
 * The pool does NOT introduce new lifecycle primitives — `run()` and
 * `session()` remain the way to spawn agents. The pool's value-add is:
 *   1. concurrency limiting (semaphore-backed)
 *   2. one unified event stream across every managed agent
 *   3. `kill('all')` for fanout cleanup
 *   4. high-level patterns: `map`, `race`, `broadcast`, `pipeline`
 */
export interface Pool {
  /** Spawn a one-shot run inside the pool. */
  run(opts: RunOptions): RunHandle;
  /** Spawn a stateful session inside the pool. */
  session(opts?: SessionOptions): Session;

  get(agentId: string): RunHandle | Session | undefined;
  list(): Array<RunHandle | Session>;

  /** Send the same prompt to every live session; returns agentId → handle. */
  broadcast(prompt: string): Map<string, RunHandle>;

  /** Fan-out: one run per item. Concurrency-capped. */
  map<T>(
    items: readonly T[],
    fn: (item: T, index: number) => RunOptions,
  ): Promise<Array<{ item: T; result: FinalResult }>>;

  /** First successful result wins; losers are killed. */
  race(prompts: readonly RunOptions[]): Promise<{ winnerAgentId: string; result: FinalResult }>;

  /** Sequential pipeline; each step receives the prior result. */
  pipeline(steps: ReadonlyArray<(prev: FinalResult | null) => RunOptions>): Promise<FinalResult[]>;

  /** Unified event stream across every managed agent. */
  events(): AsyncIterable<PoolEvent>;

  kill(target: 'all' | string): Promise<void>;
  interrupt(target: 'all' | string): Promise<void>;

  /** Wait until every managed agent has reached a terminal state. */
  drain(): Promise<void>;
}

class PoolImpl implements Pool {
  private _runs = new Map<string, RunHandle>();
  private _sessions = new Map<string, Session>();
  private _semaphore: Semaphore;
  private _opts: PoolOptions;
  private _events: Set<Pushable<PoolEvent>> = new Set();
  private _activeWork: Set<Promise<unknown>> = new Set();

  constructor(opts: PoolOptions = {}) {
    this._opts = opts;
    this._semaphore = new Semaphore(opts.concurrency ?? Number.POSITIVE_INFINITY);
    if (opts.signal) {
      const onAbort = () => {
        void this.kill('all');
      };
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  run(opts: RunOptions): RunHandle {
    const merged: RunOptions = {
      ...this._opts.defaults,
      ...(this._opts.onAskUser ? { onAskUser: this._opts.onAskUser } : {}),
      ...opts,
    };
    const handle = run(merged);
    this._runs.set(handle.id, handle);
    this._emit({ type: 'started', agentId: handle.id, sessionId: handle.sessionId });
    void this._trackHandle(handle);
    return handle;
  }

  session(opts: SessionOptions = {}): Session {
    const merged: SessionOptions = {
      ...this._opts.defaults,
      ...(this._opts.onAskUser ? { onAskUser: this._opts.onAskUser } : {}),
      ...opts,
    };
    const s = session(merged);
    this._sessions.set(s.id, s);
    this._emit({ type: 'started', agentId: s.id, sessionId: s.sessionId });
    // Best-effort cleanup: drop the session from the registry when its
    // internal status reaches a terminal state. Sessions are long-lived so
    // we poll at coarse intervals — the registry is for active introspection,
    // not bookkeeping, and a brief overlap with a dead session is harmless.
    const cleanup = (): void => {
      this._sessions.delete(s.id);
    };
    void s.sessionId.catch(cleanup);
    const interval: NodeJS.Timeout = setInterval(() => {
      if (s.status === 'killed' || s.status === 'error' || s.status === 'done') {
        cleanup();
        clearInterval(interval);
      }
    }, 5000);
    interval.unref?.();
    return s;
  }

  get(agentId: string): RunHandle | Session | undefined {
    return this._runs.get(agentId) ?? this._sessions.get(agentId);
  }

  list(): Array<RunHandle | Session> {
    return [...this._runs.values(), ...this._sessions.values()];
  }

  broadcast(prompt: string): Map<string, RunHandle> {
    const out = new Map<string, RunHandle>();
    for (const s of this._sessions.values()) {
      // Skip dead sessions
      if (s.status === 'killed' || s.status === 'error') continue;
      try {
        const h = s.send(prompt);
        out.set(s.id, h);
      } catch {
        // session may be mid-turn; skip silently
      }
    }
    return out;
  }

  async map<T>(
    items: readonly T[],
    fn: (item: T, index: number) => RunOptions,
  ): Promise<Array<{ item: T; result: FinalResult }>> {
    const errors: unknown[] = [];
    const results: Array<{ item: T; result: FinalResult } | undefined> = new Array(items.length);
    await Promise.all(
      items.map((item, index) =>
        this._semaphore.run(async () => {
          try {
            const opts = fn(item, index);
            const handle = this.run(opts);
            const result = await handle.result;
            results[index] = { item, result };
          } catch (err) {
            errors.push(err);
          }
        }),
      ),
    );
    if (errors.length > 0) {
      throw new AggregateError(errors, `pool.map: ${errors.length} task(s) failed`);
    }
    return results.filter((r): r is { item: T; result: FinalResult } => r !== undefined);
  }

  async race(
    prompts: readonly RunOptions[],
  ): Promise<{ winnerAgentId: string; result: FinalResult }> {
    if (prompts.length === 0) throw new Error('pool.race: prompts must be non-empty');
    const handles = prompts.map((p) => this.run(p));
    try {
      const winner = await Promise.race(
        handles.map(async (h) => ({ winnerAgentId: h.id, result: await h.result })),
      );
      // Kill losers (best-effort).
      await Promise.allSettled(
        handles.filter((h) => h.id !== winner.winnerAgentId).map((h) => h.kill()),
      );
      return winner;
    } catch (err) {
      await Promise.allSettled(handles.map((h) => h.kill()));
      throw err;
    }
  }

  async pipeline(
    steps: ReadonlyArray<(prev: FinalResult | null) => RunOptions>,
  ): Promise<FinalResult[]> {
    const results: FinalResult[] = [];
    let prev: FinalResult | null = null;
    for (const step of steps) {
      const handle = this.run(step(prev));
      prev = await handle.result;
      results.push(prev);
    }
    return results;
  }

  events(): AsyncIterable<PoolEvent> {
    const sink = new Pushable<PoolEvent>();
    this._events.add(sink);
    return sink;
  }

  async kill(target: 'all' | string): Promise<void> {
    const victims: Array<RunHandle | Session> =
      target === 'all'
        ? this.list()
        : [this.get(target)].filter((x): x is RunHandle | Session => x !== undefined);
    await Promise.allSettled(victims.map((v) => v.kill()));
    if (target === 'all') {
      this._runs.clear();
      this._sessions.clear();
      for (const sink of this._events) sink.end();
      this._events.clear();
    } else {
      this._runs.delete(target);
      this._sessions.delete(target);
    }
  }

  async interrupt(target: 'all' | string): Promise<void> {
    const victims: Array<RunHandle | Session> =
      target === 'all'
        ? this.list()
        : [this.get(target)].filter((x): x is RunHandle | Session => x !== undefined);
    await Promise.allSettled(victims.map((v) => v.interrupt()));
  }

  async drain(): Promise<void> {
    // Wait for every in-flight run handle to settle; sessions don't have a
    // global "done" promise (they're long-lived), so we only drain run handles
    // and the work tracked by .map/.race/.pipeline.
    const handlePromises = Array.from(this._runs.values()).map((h) =>
      h.result.catch(() => undefined),
    );
    await Promise.all([...handlePromises, ...this._activeWork]);
  }

  // ---- internals ----------------------------------------------------------

  private _emit(event: PoolEvent): void {
    for (const sink of this._events) sink.push(event);
  }

  private async _trackHandle(handle: RunHandle): Promise<void> {
    try {
      const result = await handle.result;
      this._emit({ type: 'ended', agentId: handle.id, result });
    } catch (err) {
      this._emit({ type: 'error', agentId: handle.id, error: err });
    } finally {
      this._runs.delete(handle.id);
    }
  }
}

/**
 * Create a new pool for orchestrating multiple Claude Code agents.
 *
 * @example
 * ```ts
 * const p = pool({ concurrency: 4, defaults: { model: 'claude-haiku-4-5' } });
 * const results = await p.map(files, (f) => ({ prompt: `Review ${f}` }));
 * await p.kill('all');
 * ```
 */
export function pool(opts: PoolOptions = {}): Pool {
  return new PoolImpl(opts);
}
