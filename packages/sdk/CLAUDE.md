# CLAUDE.md — `@aclarify/claude-code-sdk`

Package-level guidance. The root `CLAUDE.md` covers monorepo conventions; this file covers what's distinct about working inside the SDK package itself.

## Mental model

The SDK is a **thin bridge**, not a re-implementation. Upstream `@anthropic-ai/claude-agent-sdk` already handles: spawning the `claude` CLI, parsing stream-json, hooks, MCP, permissions, session JSONL persistence, auth. We add exactly the missing pieces:

1. **Lifecycle objects** — `Session`, `Pool` — wrapping upstream's single-shot `query()` with stateful handles users can `.kill()` / `.resume()` / `.fork()`.
2. **Ergonomics on the message stream** — `DualHandle` exposes the same payload as both `AsyncIterable<SDKMessage>` and `PromiseLike<FinalResult>`, with `.sessionId` resolving as soon as `system/init` arrives.
3. **Interception points upstream doesn't surface cleanly** — the `onAskUser` handler intercepts the built-in `AskUserQuestion` tool via a `PreToolUse` deny+JSON trick (see `src/internal/CLAUDE.md`).
4. **Read-only on-disk inspection** — `inspect()` and `list()` snapshot any session by ID, including from other processes.

If you find yourself reimplementing message parsing, subprocess management, or settings resolution, **stop** — that's upstream's job.

## Source layout

```
src/
  index.ts         Public barrel — every export here is part of the stable API
  claude.ts        { run, session, pool, inspect, list } namespace
  run.ts           One-shot RunHandle factory
  session.ts       Stateful multi-turn Session
  pool.ts          Concurrent agent orchestrator
  inspect.ts       inspect() + list() — read-only session snapshots
  types.ts         Re-exports of upstream types + bridge-specific types
  errors.ts        Typed ClaudeError hierarchy with stable string codes
  version.ts       One-time upstream-compat warning (never throws)
  internal/        See packages/sdk/src/internal/CLAUDE.md
```

Anything under `internal/` is **not** part of the public API. Don't add it to the barrel.

## Adding a new public API

The pattern is consistent across `run`, `session`, `pool`, `inspect`:

1. Implementation lives in `src/<feature>.ts`.
2. Unit tests in `test/unit/<feature>.test.ts`, mocking upstream `query()` via the pattern in `test/unit/run.test.ts`.
3. Add the new export to **both** `src/index.ts` (named export) AND `src/claude.ts` (namespace bundle).
4. Update `test/types/public-surface.test-d.ts` with an `expectTypeOf` assertion pinning the shape.
5. If it's a feature users will reach for, add a workspace example under `examples/`.
6. Add an end-to-end test in `test/e2e/<feature>.e2e.test.ts` — see `test/e2e/CLAUDE.md` for the conventions.
7. Add a Changeset: `pnpm changeset` from the repo root.

## Upstream relationship

- **Hard dependency, range `^0.3.0`.** Don't pin tighter without a reason; don't loosen without testing.
- **Re-export, never re-declare.** `Options`, `SDKMessage`, hook types, MCP helpers — all flow through `src/types.ts` and `src/index.ts` straight from `@anthropic-ai/claude-agent-sdk`. A redeclaration is a one-way ticket to drift.
- **Compat check is a `console.warn`, never a throw.** `src/version.ts` runs once on first `run()` or `session()` call. Out-of-range install gets a single warning, not a crash. Users on a newer upstream minor should not be blocked.

## Known footguns to surface in JSDoc

These are real behaviors that surprise users. When you touch related code, double-check the JSDoc still mentions them:

- `Session.sessionId` only resolves **after** the first `send()` reaches the CLI. Upstream emits `init` lazily.
- `Session.send()` is **not concurrent-safe.** Calling it before the previous turn settles throws `ClaudeError(code: 'TURN_IN_PROGRESS')`.
- `Session.messages()` is single-consumer (backed by a `Pushable`). Two callers will steal messages from each other.
- `inspect().appearsActive` is a heuristic (mtime + absence of terminal stop_reason). Not a process-level lock. For authoritative liveness, use a job registry.
- `onAskUser` is wired through a `PreToolUse` deny — the model receives the answer as a denial reason. Audit logs will show "denied tool call" entries for every AskUserQuestion. Intentional. See `src/internal/CLAUDE.md`.
- `formatInvocation` validates command names against `/^[A-Za-z0-9_\-:.]+$/` and throws on the rest. The `args` parameter is free text — it's a message body, not a shell argument.

## Build & test workflow

```bash
pnpm -F @aclarify/claude-code-sdk build
pnpm -F @aclarify/claude-code-sdk typecheck
pnpm -F @aclarify/claude-code-sdk test          # unit + types only
pnpm -F @aclarify/claude-code-sdk test:e2e      # requires claude CLI + ANTHROPIC_API_KEY
pnpm -F @aclarify/claude-code-sdk lint
pnpm -F @aclarify/claude-code-sdk e2e:doctor    # preflight: claude CLI + auth
```

`dist/` should contain exactly four files after a clean build: `index.js`, `index.js.map`, `index.d.ts`, `index.d.ts.map`. If you see `.cjs` or `.d.cts` files, something regressed ESM-only — `test/unit/esm-only.test.ts` should have caught it.

## Public surface check

Before publishing or merging anything that touches `src/index.ts`:

```bash
cd packages/sdk
pnpm pack --pack-destination /tmp
tar tzf /tmp/aclarify-claude-code-sdk-0.1.0.tgz
```

Expect exactly 7 entries: `package/dist/index.{js,js.map,d.ts,d.ts.map}`, `package/package.json`, `package/README.md`, `package/LICENSE`. Anything else (source maps for source files, test artifacts, configs) means `files` in `package.json` drifted.

## Things to refuse

- A request to add CJS output. Read `tsdown.config.ts`'s comment and the `build(sdk): ship as ESM-only` commit before re-opening the question.
- A request to add a logger / OTEL integration in core. Consumers wire their own — we expose seams via the existing event surfaces, not bundled telemetry.
- A request to add a `SessionStore` interface. Users own persistence; we surface session IDs and stop there. That was the explicit v0.1 design.
- A request to add retry / rate limiting. `maxTurns` is upstream's contract. Wrap with `p-retry` or similar at the call site.
