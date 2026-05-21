import { randomUUID } from 'node:crypto';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { type AskUserHandler, buildAskUserHook } from './internal/ask-user';
import { DualHandle } from './internal/dual';
import type { FinalResult, Options, SDKMessage, SDKUserMessage } from './types';
import { checkUpstreamCompat } from './version';

/**
 * Options accepted by {@link run}. Extends upstream `Options` verbatim: every
 * field on the upstream type is supported here without re-declaration. The
 * `onAskUser` field is additive — it does not collide with upstream Options.
 */
export interface RunOptions extends Options {
  /** The prompt or streaming-input source. */
  prompt: string | AsyncIterable<SDKUserMessage>;
  /**
   * Optional handler invoked when Claude Code calls the AskUserQuestion tool.
   *
   * Implementation note: in headless SDK mode the built-in AskUserQuestion has
   * no TTY to render the picker and `PostToolUse` does not fire for it. We
   * intercept at `PreToolUse`, call this handler, then return
   * `permissionDecision: 'deny'` with the host's answers JSON-encoded in
   * `permissionDecisionReason`. The model receives the answers as the
   * tool's effective output (with a "denied" trace in the transcript).
   *
   * If omitted, the hook is never registered and AskUserQuestion behaves
   * however the CLI handles it natively (typically a failed turn).
   */
  onAskUser?: AskUserHandler;
}

/**
 * Public handle returned from {@link run}. Backed by an internal `DualHandle`
 * and intentionally narrowed to the stable surface — implementation details
 * stay internal.
 */
export interface RunHandle extends AsyncIterable<SDKMessage>, PromiseLike<FinalResult> {
  /** Stable local id (uuid). Distinct from `sessionId`. Available immediately. */
  readonly id: string;
  /** Resolves on `system/init` (before the first text token). Rejects if the stream ends with no init. */
  readonly sessionId: Promise<string>;
  /** Resolves on the upstream `result` message. Rejects on abort or stream error. */
  readonly result: Promise<FinalResult>;
  /** Synchronous accessor: the session id once it's known, otherwise undefined. */
  readonly currentSessionId: string | undefined;
  /** AbortSignal driving this run. Compose with your own controller via upstream `abortController`. */
  readonly signal: AbortSignal;
  /** Text-only async iterable: deltas if upstream emits partials, otherwise per-turn chunks. */
  text(): AsyncIterable<string>;
  /** Graceful interrupt via the upstream `Query.interrupt()`. */
  interrupt(): Promise<void>;
  /** Hard kill: aborts the underlying AbortController and awaits cleanup. */
  kill(): Promise<void>;
}

/**
 * One-shot, awaitable + iterable invocation of Claude Code.
 *
 * @example
 * ```ts
 * const r = run({ prompt: 'Write a haiku', model: 'claude-haiku-4-5' });
 * const sessionId = await r.sessionId; // resolves on init
 * for await (const chunk of r.text()) process.stdout.write(chunk);
 * const final = await r; // FinalResult
 * ```
 */
export function run(opts: RunOptions): RunHandle {
  checkUpstreamCompat();
  const { prompt, onAskUser, ...rest } = opts;
  const abortController = rest.abortController ?? new AbortController();
  const agentId = randomUUID();

  // If onAskUser is provided, register a PreToolUse hook that intercepts the
  // AskUserQuestion tool and substitutes the host's answer. We compose with
  // any user-supplied PreToolUse hooks rather than clobbering them. Our hook
  // sits LAST in the chain so user hooks can short-circuit first.
  let sessionIdSeen = '';
  let composedHooks = rest.hooks;
  if (onAskUser) {
    const ctx = {
      agentId,
      getSessionId: () => sessionIdSeen,
    };
    const askHook = buildAskUserHook(onAskUser, ctx);
    const existingPreToolUse = rest.hooks?.PreToolUse ?? [];
    composedHooks = {
      ...rest.hooks,
      PreToolUse: [...existingPreToolUse, askHook],
    };
  }

  const source = query({
    prompt,
    options: {
      ...rest,
      ...(composedHooks ? { hooks: composedHooks } : {}),
      abortController,
    },
  });
  const handle = new DualHandle(source, {
    id: agentId,
    abortController,
    interrupt: () => source.interrupt(),
  });
  if (onAskUser) {
    void handle.sessionId.then((id) => {
      sessionIdSeen = id;
    });
  }
  return handle;
}
