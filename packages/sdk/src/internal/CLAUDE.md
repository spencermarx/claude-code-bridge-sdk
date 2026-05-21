# CLAUDE.md — internal modules

Everything in this directory is implementation detail. Nothing here is exported from `src/index.ts`. If you're tempted to export something, ask first whether it should live in `src/` proper instead.

## The keystone: `dual.ts`

`DualHandle` is the most carefully-designed object in the SDK. It's a single class instance that is **simultaneously**:

- `AsyncIterable<SDKMessage>` — `for await (const msg of handle)`
- `PromiseLike<FinalResult>` — `await handle` (via a `.then()` method)
- A holder of side-channel observable promises (`.sessionId`, `.result`)

### Invariants (do not break)

1. **Single background pump.** One `for await (const message of source)` loop in `_pump()` consumes the upstream `AsyncIterable<SDKMessage>` exactly once. There is no replay, no multi-consumer buffering.
2. **`.sessionId` resolves on the first `system/init` message.** Not on `result`. Tests in `test/unit/dual.test.ts` pin this order.
3. **Single iteration.** Calling `[Symbol.asyncIterator]()` twice on the same handle throws. The error message tells users to do their iteration and their `await` in that order on the same instance.
4. **Both promises must settle.** If the upstream ends without `init` or without `result`, `_pump()`'s `finally` block rejects the still-pending deferreds with a precise error. Never leave a hanging promise.
5. **`kill()` awaits the underlying pump to drain.** Callers know cleanup is complete when `kill()` resolves.
6. **`then()` is a real method on the class.** It's required by the `PromiseLike` contract — Biome's `noThenProperty` rule is suppressed inline with a comment.

### Text-stream dedupe

`text()` yields strings. When the upstream's `includePartialMessages` is on, both `stream_event` text-deltas and full `assistant` messages arrive for the same turn. We dedupe by the assistant message's `uuid`: if a `text_delta` was emitted with that uuid, suppress the full message's text. Test: `dual.test.ts > text() > suppresses the assistant message when partial deltas covered the same turn`.

### Why TS-private (`private _foo`) instead of `#foo`

tsdown's transform path emits runtime helpers from `@oxc-project/runtime` for `#`-private fields, which we'd then need as a dep. TS-private is compile-time-only and the bundle stays clean. **Do not switch back to `#`-private.**

## `deferred.ts`

`Deferred<T>` is a Promise paired with externally-exposed `resolve` / `reject`. Two non-obvious invariants:

1. **Idempotent settlement.** Calling `resolve` or `reject` after the first call is a no-op. A `_settled` flag enforces this.
2. **Pre-emptive unhandled-rejection swallow.** The constructor attaches a `.catch(() => {})` so that a deferred that's rejected before any consumer attaches doesn't trip Node's `unhandledRejection`. The actual consumer's `await` still throws.

## `pushable.ts`

`Pushable<T>` is a single-producer, **single-consumer** AsyncIterable backed by an in-memory queue. Two consumers will steal each other's messages.

Used in two places:
- `session.ts` inbound: user messages → upstream `query()`'s streaming-input parameter
- `session.ts` outbound (per-turn): messages from the upstream Query → the active turn's `DualHandle`

If you find yourself wanting to broadcast to multiple consumers, **don't** extend `Pushable` — add a new file (`broadcast.ts`) for that semantics, and leave `Pushable` minimal.

## `session-id.ts`

A tiny pure function: takes an `SDKMessage`, returns `string | undefined`. Resolves to the session id only for `system/init` messages. Don't add other extraction helpers here — keep it single-purpose.

## `semaphore.ts`

Bounds concurrency for `pool.map()`. Notable details:

- **`Number.POSITIVE_INFINITY` is the unbounded sentinel.** `new Semaphore(Infinity)` is a no-op pass-through. The pool's `concurrency` option defaults to this.
- **`acquire()` is FIFO**, not priority-based.
- **`run(fn)`** is the idiomatic wrapper — it acquires, runs, and releases even if `fn` throws.

## `ask-user.ts` — the AskUserQuestion interception

This is the SDK's most nuanced piece. Read it carefully before changing anything.

### The mechanism

Claude Code's built-in `AskUserQuestion` tool has no TTY in headless SDK mode. Empirically, upstream's `PostToolUse` hook **does not fire** for it (verified via diagnostic — `PreToolUse` fires reliably, `PostToolUse` does not). So we can't intercept post-execution and substitute output.

What we do instead:
1. Register a `PreToolUse` hook with `matcher: 'AskUserQuestion'`.
2. When it fires, call the host's `onAskUser` with the unmarshalled `questions`.
3. Return `permissionDecision: 'deny'` with the answers JSON-encoded into `permissionDecisionReason`.
4. The model receives the denial reason as the tool's effective output.

### Why this is acceptable

- The model parses the JSON in the denial reason and behaves as if it received an answer. E2e test `ask-user.e2e.test.ts` verifies the round-trip works.
- Multi-select answers from the host (`string[]`) are joined with commas to match upstream's wire format (single-string-per-question, comma-separated).
- Host handler exceptions are caught and surfaced as a deny with `error` instead of crashing the run.

### Audit-trail caveat (surface to users)

Transcripts and telemetry will show a "denied tool call" entry for every `AskUserQuestion`. This is intentional but surprising — surface it in `README.md` if you change the mechanism, and update `src/run.ts`'s `onAskUser` JSDoc.

### Composition with user-provided hooks

`run.ts` and `session.ts` both compose this hook **after** any user-supplied `PreToolUse` hooks: `[...existing, askHook]`. User hooks get the first say; if they short-circuit with a decision, ours doesn't run.

## `commands.ts`

Normalizes upstream's `SlashCommand` and `ModelInfo` types into bridge-side `SlashCommand` and `ModelInfo`. Keep these **thin** — only surface fields upstream actually provides. The previous version had fabricated `source: 'builtin' | ...` and `userInvocable: boolean` fields; those got removed because we didn't actually know how to populate them. Don't reintroduce fabricated fields.

`formatInvocation(name, args?)`:
- Strips a leading `/` if present.
- Validates the name against `/^[A-Za-z0-9_\-:.]+$/` and **throws** on violation. This blocks protocol-injection via newlines, NULs, embedded `/`, or shell metacharacters.
- `args` passes through as free text — it's a chat message body, not a shell argument.

## `transcript.ts`

Walks `SessionMessage[]` (returned by upstream's `getSessionMessages`) and derives stats for `inspect.ts`.

### Non-obvious facts about Claude Code's on-disk JSONL

- The JSONL contains `user` and `assistant` wrappers (and sundry meta entries like `queue-operation`). It does **NOT** contain `result` messages — those are streamed in-memory only.
- Completion is detected via the **last `assistant` message's `stop_reason`**. Terminal reasons: `end_turn`, `stop_sequence`, `max_tokens`. **`tool_use` is NOT terminal** (the model expects to be re-invoked with the tool result).
- Cost is not persisted. `totalCostUsd` is always `null` from a disk read. Token counts (`input_tokens`, `output_tokens`) are summed from assistant `usage` fields.

### `derivedStatus` rules

| Condition | Status |
|---|---|
| Any assistant message with a terminal `stop_reason` | `completed` |
| No turn-end, no messages at all | `unknown` |
| No turn-end, mtime ≥ `staleAfterMs` old | `interrupted` |
| No turn-end, mtime fresh | `active` |

The `staleAfterMs` default is 60_000.

`appearsActive` is just `derivedStatus === 'active'`. It is **a heuristic, not a lock.** Document this in any code that uses it.
