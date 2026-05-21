import { randomUUID } from 'node:crypto';
import type { FinalResult, SDKMessage, SDKResultMessage } from '../types';
import { Deferred } from './deferred';
import { extractInitSessionId } from './session-id';

/**
 * The keystone primitive. Wraps an upstream `AsyncIterable<SDKMessage>` and
 * exposes the same payload through three lenses on a single object:
 *
 *   1. AsyncIterable<SDKMessage>  — `for await (const msg of handle) { … }`
 *   2. PromiseLike<FinalResult>   — `const r = await handle;`
 *   3. Convenience helpers        — `handle.sessionId`, `handle.text()`, `handle.result`
 *
 * A single background pump consumes the source once and feeds a queue. Both
 * iteration and `then` are non-destructive *with respect to each other* — the
 * pump runs regardless of which consumer attached first. However, iterating
 * the same handle twice is rejected: messages are not replayed.
 */
export interface DualHandleInit {
  /** AbortController whose signal was passed to the upstream source. */
  abortController: AbortController;
  /** Optional graceful interrupt — defaults to abort(). */
  interrupt?: () => Promise<void> | void;
  /** Override the local agent id. Mostly for tests. */
  id?: string;
}

export class DualHandle implements AsyncIterable<SDKMessage>, PromiseLike<FinalResult> {
  readonly id: string;
  readonly signal: AbortSignal;
  private readonly _abortController: AbortController;
  private readonly _interrupt: (() => Promise<void> | void) | undefined;

  private readonly _sessionIdDeferred = new Deferred<string>();
  private readonly _resultDeferred = new Deferred<FinalResult>();

  private readonly _queue: SDKMessage[] = [];
  private _queueIndex = 0;
  private _iterated = false;
  private _done = false;
  private _pumpError: unknown = undefined;
  private _waiters: Array<(r: IteratorResult<SDKMessage>) => void> = [];

  private _accumulatedText = '';
  private _currentSessionId: string | undefined;

  constructor(source: AsyncIterable<SDKMessage>, init: DualHandleInit) {
    this.id = init.id ?? randomUUID();
    this._abortController = init.abortController;
    this.signal = init.abortController.signal;
    this._interrupt = init.interrupt;
    void this._pump(source);
  }

  // ----- public observable promises -----------------------------------------

  get sessionId(): Promise<string> {
    return this._sessionIdDeferred.promise;
  }

  get result(): Promise<FinalResult> {
    return this._resultDeferred.promise;
  }

  get currentSessionId(): string | undefined {
    return this._currentSessionId;
  }

  // ----- PromiseLike --------------------------------------------------------

  // biome-ignore lint/suspicious/noThenProperty: implementing PromiseLike requires a `then` method
  then<TResult1 = FinalResult, TResult2 = never>(
    onfulfilled?: ((value: FinalResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this._resultDeferred.promise.then(onfulfilled, onrejected);
  }

  // ----- AsyncIterable<SDKMessage> ------------------------------------------

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    if (this._iterated) {
      throw new Error(
        'DualHandle: cannot iterate twice. Messages are not buffered for replay. ' +
          'If you need both iteration and await, do them in that order on the same handle.',
      );
    }
    this._iterated = true;
    return {
      next: () => this._nextMessage(),
      return: async (value) => {
        // Caller broke out of the for-await loop early.
        return { value, done: true };
      },
      throw: async (err) => {
        throw err;
      },
    };
  }

  /**
   * Text-only stream. Yields text deltas from partial assistant messages when
   * `includePartialMessages` is enabled upstream, otherwise yields one chunk
   * per completed assistant message. Suppresses the full-message chunk when
   * partial deltas have already been emitted for the same turn.
   */
  text(): AsyncIterable<string> {
    return {
      [Symbol.asyncIterator]: () => this._textIterator(),
    };
  }

  // ----- lifecycle ----------------------------------------------------------

  async interrupt(): Promise<void> {
    if (this._interrupt) {
      await this._interrupt();
    } else {
      this._abortController.abort();
    }
  }

  async kill(): Promise<void> {
    this._abortController.abort();
    // Wait for the pump to terminate so callers know cleanup is done.
    try {
      await this._resultDeferred.promise;
    } catch {
      // expected — result rejects with the abort error
    }
  }

  // ----- internals ----------------------------------------------------------

  private async _pump(source: AsyncIterable<SDKMessage>): Promise<void> {
    try {
      for await (const message of source) {
        // Resolve sessionId on the first init system message.
        const sid = extractInitSessionId(message);
        if (sid !== undefined) {
          this._currentSessionId = sid;
          this._sessionIdDeferred.resolve(sid);
        }

        // Accumulate text from completed assistant messages so we can build
        // FinalResult.text without re-walking the queue.
        if (message.type === 'assistant') {
          const blocks = (message.message?.content ?? []) as Array<{
            type: string;
            text?: string;
          }>;
          for (const b of blocks) {
            if (b.type === 'text' && typeof b.text === 'string') {
              this._accumulatedText += b.text;
            }
          }
        }

        this._queue.push(message);
        this._drainWaiters();

        // Resolve final result the moment a `result` message arrives.
        if (message.type === 'result') {
          const final = this._buildFinalResult(message);
          this._resultDeferred.resolve(final);
        }
      }
    } catch (err) {
      this._pumpError = err;
      this._sessionIdDeferred.reject(err);
      this._resultDeferred.reject(err);
    } finally {
      this._done = true;
      this._drainWaiters();
      // If no `result` was seen, settle both promises so consumers don't hang.
      if (!this._sessionIdDeferred.settled) {
        this._sessionIdDeferred.reject(
          new Error('Stream ended before system/init message arrived'),
        );
      }
      if (!this._resultDeferred.settled) {
        this._resultDeferred.reject(
          this._pumpError ?? new Error('Stream ended before result message arrived'),
        );
      }
    }
  }

  private async _nextMessage(): Promise<IteratorResult<SDKMessage>> {
    if (this._queueIndex < this._queue.length) {
      const value = this._queue[this._queueIndex++] as SDKMessage;
      return { value, done: false };
    }
    if (this._done) {
      if (this._pumpError !== undefined) throw this._pumpError;
      return { value: undefined, done: true };
    }
    return new Promise<IteratorResult<SDKMessage>>((resolve, reject) => {
      this._waiters.push((r) => {
        if (this._pumpError !== undefined && r.done) reject(this._pumpError);
        else resolve(r);
      });
    });
  }

  private _drainWaiters(): void {
    while (this._waiters.length > 0) {
      const waiter = this._waiters.shift();
      if (!waiter) break;
      if (this._queueIndex < this._queue.length) {
        const value = this._queue[this._queueIndex++] as SDKMessage;
        waiter({ value, done: false });
      } else if (this._done) {
        waiter({ value: undefined, done: true });
      } else {
        // shouldn't happen — re-queue
        this._waiters.unshift(waiter);
        return;
      }
    }
  }

  private _buildFinalResult(message: SDKResultMessage): FinalResult {
    const sessionId = message.session_id;
    this._currentSessionId = sessionId;
    const usage =
      (message as SDKResultMessage & { usage?: { input_tokens?: number; output_tokens?: number } })
        .usage ?? {};
    const text =
      message.subtype === 'success' && typeof message.result === 'string'
        ? message.result
        : this._accumulatedText;
    return {
      sessionId,
      text,
      costUsd: message.total_cost_usd ?? 0,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      durationMs: message.duration_ms ?? 0,
      numTurns: message.num_turns ?? 0,
      stopReason: (message as SDKResultMessage & { stop_reason?: string | null }).stop_reason ?? '',
      raw: message,
    };
  }

  private async *_textIterator(): AsyncGenerator<string, void, void> {
    // Track whether we've emitted text_delta chunks for the current turn so we
    // can suppress duplicate emission from the completed assistant message.
    const emittedPartialsForUuid = new Set<string>();
    let currentTurnUuid: string | undefined;

    for (let i = 0; ; i++) {
      // wait for next message or end
      while (i >= this._queue.length && !this._done) {
        await new Promise<void>((resolve) => {
          this._waiters.push(() => resolve());
          this._drainWaiters();
        });
      }
      if (i >= this._queue.length) {
        if (this._pumpError !== undefined) throw this._pumpError;
        return;
      }
      const msg = this._queue[i] as SDKMessage;

      if (msg.type === 'stream_event') {
        const event = (msg as { event?: unknown }).event as
          | { type?: string; delta?: { type?: string; text?: string }; index?: number }
          | undefined;
        const parentUuid = (msg as { uuid?: string }).uuid;
        if (parentUuid) currentTurnUuid = parentUuid;
        if (
          event?.type === 'content_block_delta' &&
          event.delta?.type === 'text_delta' &&
          typeof event.delta.text === 'string'
        ) {
          if (currentTurnUuid) emittedPartialsForUuid.add(currentTurnUuid);
          yield event.delta.text;
        }
      } else if (msg.type === 'assistant') {
        const uuid = (msg as { uuid?: string }).uuid;
        if (uuid && emittedPartialsForUuid.has(uuid)) {
          // already emitted via deltas
          continue;
        }
        const blocks = (msg.message?.content ?? []) as Array<{ type: string; text?: string }>;
        for (const b of blocks) {
          if (b.type === 'text' && typeof b.text === 'string' && b.text.length > 0) {
            yield b.text;
          }
        }
      }
    }
  }
}
