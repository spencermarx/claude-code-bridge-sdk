import { randomUUID } from 'node:crypto';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeError } from './errors';
import { type SessionSnapshot, inspect as inspectSession } from './inspect';
import { type AskUserHandler, buildAskUserHook } from './internal/ask-user';
import {
  type ModelInfo,
  type SlashCommand,
  formatInvocation,
  normalizeModelInfo,
  normalizeSlashCommand,
} from './internal/commands';
import { Deferred } from './internal/deferred';
import { DualHandle } from './internal/dual';
import { Pushable } from './internal/pushable';
import { extractInitSessionId } from './internal/session-id';
import type { RunHandle } from './run';
import type { Options, PermissionMode, SDKMessage, SDKUserMessage, SessionStatus } from './types';
import { checkUpstreamCompat } from './version';

/** Options accepted by {@link session}. Extends upstream `Options` verbatim. */
export interface SessionOptions extends Options {
  /** Initial prompt; optional — the session can be empty until `.send()` is called. */
  prompt?: string;
  /** Resume an existing CLI session by id (passed to upstream as `resume`). */
  resume?: string;
  /** Branch from the resumed session into a new session id (passed to upstream as `forkSession`). */
  forkSession?: boolean;
  /** Handler for Claude Code's AskUserQuestion tool. Applies to every turn. */
  onAskUser?: AskUserHandler;
}

/** A long-lived Claude Code instance. Multiple turns share one underlying CLI process. */
export interface Session {
  /** Stable local id (uuid). Distinct from `sessionId`. */
  readonly id: string;
  /**
   * Resolves on the first `system/init` from upstream. NOTE: upstream emits
   * `init` only after consuming the first user message, so this resolves once
   * the first `send()` (or constructor `prompt`) has reached the CLI. If you
   * `await session.sessionId` before sending anything, it will hang.
   */
  readonly sessionId: Promise<string>;
  readonly currentSessionId: string | undefined;
  readonly status: SessionStatus;
  readonly cost: { usd: number; inputTokens: number; outputTokens: number };
  readonly model: string | undefined;

  /** Send a user message; returns a per-turn handle. */
  send(prompt: string): RunHandle;

  /** Invoke a slash command or skill by name. Sugar for `.send('/name args')`. */
  invoke(name: string, args?: string): RunHandle;

  /** All messages from this session across all turns, while it's alive. */
  messages(): AsyncIterable<SDKMessage>;

  /** List slash commands / skills this instance can invoke. */
  commands(): Promise<SlashCommand[]>;

  /** List models this instance can switch to. */
  models(): Promise<ModelInfo[]>;

  setModel(model: string): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;

  interrupt(): Promise<void>;
  kill(): Promise<void>;

  /** Fork into a new branched session. Spawns a new upstream Query with `forkSession: true`. */
  fork(opts?: Partial<SessionOptions>): Session;

  /** Force-refresh an on-disk snapshot of the underlying session id. */
  snapshot(): Promise<SessionSnapshot>;
}

interface UpstreamQueryLike {
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage>;
  interrupt(): Promise<void>;
  setModel(model: string): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  supportedCommands(): Promise<
    Array<{ name: string; description: string; argumentHint: string; aliases?: string[] }>
  >;
  supportedModels(): Promise<
    Array<{
      value: string;
      displayName: string;
      description: string;
      supportsEffort?: boolean;
    }>
  >;
}

class SessionImpl implements Session {
  readonly id: string;
  private _sessionIdDeferred = new Deferred<string>();
  private _currentSessionId: string | undefined;
  private _status: SessionStatus = 'idle';
  private _cost = { usd: 0, inputTokens: 0, outputTokens: 0 };
  private _model: string | undefined;

  private _input: Pushable<SDKUserMessage>;
  private _query: UpstreamQueryLike;
  private _abortController: AbortController;
  private _opts: SessionOptions;

  private _currentTurnPush: Pushable<SDKMessage> | undefined;
  private _currentTurnHandle: DualHandle | undefined;
  private _messageBroadcast: Pushable<SDKMessage> | undefined;

  constructor(opts: SessionOptions = {}) {
    checkUpstreamCompat();
    this.id = randomUUID();
    this._opts = opts;
    this._input = new Pushable<SDKUserMessage>();
    this._abortController = opts.abortController ?? new AbortController();

    // Strip bridge-only fields when forwarding to upstream.
    const { prompt: initialPrompt, onAskUser, ...upstreamOpts } = opts;

    let hooks = upstreamOpts.hooks;
    if (onAskUser) {
      const ctx = {
        agentId: this.id,
        getSessionId: () => this._currentSessionId ?? '',
      };
      const askHook = buildAskUserHook(onAskUser, ctx);
      const existing = upstreamOpts.hooks?.PreToolUse ?? [];
      hooks = {
        ...upstreamOpts.hooks,
        PreToolUse: [...existing, askHook],
      };
    }

    // The upstream `Query` extends AsyncGenerator and exposes interrupt / setModel.
    this._query = query({
      prompt: this._input,
      options: {
        ...upstreamOpts,
        ...(hooks ? { hooks } : {}),
        abortController: this._abortController,
      },
    }) as unknown as UpstreamQueryLike;

    void this._dispatchLoop();

    if (initialPrompt) {
      // Seed the first turn so the session is immediately "running".
      void this._pushPrompt(initialPrompt);
    }
  }

  get sessionId(): Promise<string> {
    return this._sessionIdDeferred.promise;
  }
  get currentSessionId(): string | undefined {
    return this._currentSessionId;
  }
  get status(): SessionStatus {
    return this._status;
  }
  get cost(): { usd: number; inputTokens: number; outputTokens: number } {
    return this._cost;
  }
  get model(): string | undefined {
    return this._model;
  }

  send(prompt: string): RunHandle {
    if (this._status === 'killed' || this._status === 'error') {
      throw new ClaudeError(`Cannot send: session status is ${this._status}`, {
        code: 'SESSION_DEAD',
        agentId: this.id,
      });
    }
    if (this._currentTurnPush) {
      throw new ClaudeError(
        'Concurrent .send() not supported on Session. Await or iterate the previous handle first.',
        { code: 'TURN_IN_PROGRESS', agentId: this.id },
      );
    }
    const turnPush = new Pushable<SDKMessage>();
    const turnAbort = new AbortController();
    // If the session aborts, propagate to the turn.
    if (this._abortController.signal.aborted) {
      turnAbort.abort();
    } else {
      this._abortController.signal.addEventListener('abort', () => turnAbort.abort(), {
        once: true,
      });
    }
    const handle = new DualHandle(turnPush, {
      abortController: turnAbort,
      interrupt: () => this._query.interrupt(),
    });

    // If the sessionId is already known, synthesize an init for this turn so
    // handle.sessionId resolves immediately. Otherwise the upstream init
    // (only on the first turn) will arrive naturally.
    if (this._currentSessionId !== undefined) {
      const synthInit = {
        type: 'system' as const,
        subtype: 'init' as const,
        session_id: this._currentSessionId,
        uuid: randomUUID(),
        model: this._model ?? '',
        cwd: this._opts.cwd ?? '',
        tools: [],
        mcp_servers: [],
        apiKeySource: 'user' as const,
        claude_code_version: '',
        permissionMode: this._opts.permissionMode ?? 'default',
        slash_commands: [],
        output_style: 'default',
        skills: [],
        plugins: [],
      };
      turnPush.push(synthInit as unknown as SDKMessage);
    }

    // CRITICAL ORDERING: assign `_currentTurnPush` BEFORE pushing the user
    // prompt. If the upstream stream-input handler is faster than the
    // micro-task queue, the first message it emits would otherwise have no
    // turn to route to and `handle` would hang on the missing init.
    this._currentTurnPush = turnPush;
    this._currentTurnHandle = handle;
    this._status = 'running';

    void this._pushPrompt(prompt);
    return handle;
  }

  invoke(name: string, args?: string): RunHandle {
    return this.send(formatInvocation(name, args));
  }

  async commands(): Promise<SlashCommand[]> {
    const raw = await this._query.supportedCommands();
    return raw.map(normalizeSlashCommand);
  }

  async models(): Promise<ModelInfo[]> {
    const raw = await this._query.supportedModels();
    return raw.map(normalizeModelInfo);
  }

  messages(): AsyncIterable<SDKMessage> {
    if (!this._messageBroadcast) {
      this._messageBroadcast = new Pushable<SDKMessage>();
    }
    return this._messageBroadcast;
  }

  async setModel(model: string): Promise<void> {
    await this._query.setModel(model);
    this._model = model;
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    await this._query.setPermissionMode(mode);
  }

  async interrupt(): Promise<void> {
    await this._query.interrupt();
    if (this._status === 'running') this._status = 'interrupted';
  }

  async kill(): Promise<void> {
    this._abortController.abort();
    this._input.end();
    this._currentTurnPush?.end();
    this._messageBroadcast?.end();
    this._status = 'killed';
  }

  fork(opts: Partial<SessionOptions> = {}): Session {
    const baseId = this._currentSessionId;
    if (!baseId) {
      throw new Error('Cannot fork: session id not yet resolved');
    }
    return new SessionImpl({
      ...this._opts,
      ...opts,
      resume: baseId,
      forkSession: true,
    });
  }

  async snapshot(): Promise<SessionSnapshot> {
    const sid = await this._sessionIdDeferred.promise;
    const cwd = this._opts.cwd;
    return inspectSession(sid, cwd ? { cwd } : {});
  }

  // ----- internals ----------------------------------------------------------

  private async _pushPrompt(prompt: string): Promise<void> {
    this._input.push({
      type: 'user',
      message: {
        role: 'user',
        content: prompt,
      },
    } as unknown as SDKUserMessage);
  }

  private async _dispatchLoop(): Promise<void> {
    try {
      for await (const msg of this._query) {
        // Capture sessionId + model on init.
        const sid = extractInitSessionId(msg);
        if (sid !== undefined) {
          this._currentSessionId = sid;
          this._sessionIdDeferred.resolve(sid);
          const initMsg = msg as { model?: string };
          if (initMsg.model) this._model = initMsg.model;
        }

        // Broadcast.
        this._messageBroadcast?.push(msg);

        // Forward to the active turn, if any.
        this._currentTurnPush?.push(msg);

        // End-of-turn: accumulate cost, close the turn handle.
        if (msg.type === 'result') {
          const resultMsg = msg as {
            total_cost_usd?: number;
            usage?: { input_tokens?: number; output_tokens?: number };
          };
          this._cost = {
            usd: this._cost.usd + (resultMsg.total_cost_usd ?? 0),
            inputTokens: this._cost.inputTokens + (resultMsg.usage?.input_tokens ?? 0),
            outputTokens: this._cost.outputTokens + (resultMsg.usage?.output_tokens ?? 0),
          };
          this._currentTurnPush?.end();
          this._currentTurnPush = undefined;
          this._currentTurnHandle = undefined;
          this._status = 'idle';
        }
      }
      this._status = this._status === 'killed' ? 'killed' : 'done';
    } catch (err) {
      this._status = 'error';
      this._currentTurnPush?.fail(err);
      this._messageBroadcast?.fail(err);
      this._sessionIdDeferred.reject(err);
    } finally {
      this._currentTurnPush?.end();
      this._messageBroadcast?.end();
      this._input.end();
    }
  }
}

/**
 * Spawn a long-lived Claude Code session. Returns a {@link Session} that owns
 * one underlying upstream `Query` and supports multi-turn conversations via
 * `.send()`.
 *
 * @example
 * ```ts
 * const s = session({ model: 'claude-opus-4-7', permissionMode: 'acceptEdits' });
 * const sid = await s.sessionId;
 * await s.send('remember the number 42').result;
 * await s.send('what number?').result; // -> "42"
 * ```
 */
export function session(opts: SessionOptions = {}): Session {
  return new SessionImpl(opts);
}
