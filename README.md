# `@aclarify/claude-code-sdk`

A thin, ergonomic TypeScript SDK for building apps on top of [Claude Code](https://code.claude.com/).

Wraps the official [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) and adds the missing pieces:

- a **stateful `Session`** with `.send()`, `.invoke()`, `.kill()`, `.fork()`, `.setModel()`, `.commands()`, `.models()`
- a **`Pool`** for orchestrating N concurrent Claude Code instances with `map`, `race`, `broadcast`, `pipeline`, and unified events
- a **`RunHandle`** that is both `await`-able and `for await`-able, with `.sessionId` exposed on `system/init` (before the first token)
- a **first-class `onAskUser` bridge** for Claude Code's `AskUserQuestion` tool (1–4 questions × 2–4 options × optional multiSelect)
- **`commands()` / `models()` / `invoke()`** for slash-command + skill discovery and invocation
- **`inspect()` / `list()`** to snapshot any session's state from disk — across process boundaries

Zero translation of CLI args. Storage-agnostic. Re-exports upstream types verbatim.

## Status

Pre-release. Targets `@anthropic-ai/claude-agent-sdk` ^0.3.0.

## Install

```bash
pnpm add @aclarify/claude-code-sdk
# or
npm install @aclarify/claude-code-sdk
```

The upstream `@anthropic-ai/claude-agent-sdk` is a hard dependency and is installed automatically. The `claude` CLI itself is *not* bundled — install it globally for full functionality:

```bash
npm install -g @anthropic-ai/claude-code
```

### ESM-only

This package is **ESM-only by design**. It only ships `dist/index.js` (ESM) and `dist/index.d.ts`; no CJS bundle is emitted. Upstream `@anthropic-ai/claude-agent-sdk` is itself ESM-only, so a CJS facade here would only mask the real failure mode (`ERR_REQUIRE_ESM` on first `require` of upstream).

Use it from:

- Node ≥ 18.17 with `"type": "module"` in your `package.json`, or
- a `.mjs` file, or
- TypeScript with `"module": "NodeNext"` / `"Bundler"`, or
- any bundler (Vite, Webpack, Rollup, esbuild, tsdown, etc.).

If you need to consume this from CJS, dynamically import:

```js
// in a CommonJS file
async function main() {
  const { claude } = await import('@aclarify/claude-code-sdk');
  // …
}
```

## Quickstart

```ts
import { claude } from '@aclarify/claude-code-sdk';

// One-shot, streaming
const r = claude.run({ prompt: 'Write a haiku about TypeScript' });
for await (const chunk of r.text()) process.stdout.write(chunk);
const final = await r;
console.log(final.sessionId, final.costUsd);
```

## Why this exists vs. raw `@anthropic-ai/claude-agent-sdk`

| Need | Raw agent-sdk | `@aclarify/claude-code-sdk` |
|------|---------------|-----------------------------|
| Stream + collect a final result on one handle | iterate manually, accumulate yourself | `await` AND `for await` on the same object |
| Get `sessionId` before completion | walk messages, watch for `system/init` | `await r.sessionId` |
| Run many agents with a concurrency cap | hand-roll a semaphore | `pool({ concurrency: N })` |
| Kill all in-flight agents | track them yourself | `pool.kill('all')` |
| Multi-turn session with `.send()` ergonomics | feed an AsyncIterable<SDKUserMessage> manually | `session(...).send(prompt)` |
| Fork / resume a session | manually pass `forkSession` + `resume` per call | `s.fork()` / `claude.session({ resume })` |
| Handle Claude's `AskUserQuestion` tool | register a hook + format the output yourself | `onAskUser: ({questions}) => …` |
| List + invoke discoverable commands & skills | call `supportedCommands()` + format `/name args` | `s.commands()` / `s.invoke('name', 'args')` |
| Check if a session is still running across processes | parse `~/.claude/projects/...` JSONLs yourself | `claude.inspect(sessionId)` / `claude.list({ cwd })` |

## API surface

```ts
import { claude, run, session, pool, inspect, list } from '@aclarify/claude-code-sdk';
```

Everything is re-exported as named exports (tree-shake friendly) and on the `claude` namespace (discoverable).

### `run()` — one-shot, awaitable + iterable

```ts
const r = claude.run({
  prompt: 'Refactor auth.ts',
  model: 'claude-sonnet-4-6',
  allowedTools: ['Read', 'Edit'],
  permissionMode: 'acceptEdits',
  onAskUser: async ({ questions }) => ({
    answers: { [questions[0]!.question]: questions[0]!.options[0]!.label },
  }),
});

const sid = await r.sessionId;          // resolves on system/init
for await (const chunk of r.text()) process.stdout.write(chunk);
const final = await r;                  // FinalResult
```

### `session()` — stateful, multi-turn

```ts
const s = claude.session({ model: 'claude-opus-4-7', permissionMode: 'plan' });
const sessionId = await s.sessionId;
await s.send('remember the number 42').result;
await s.send('what number?').result;     // recalls "42"

const branch = s.fork();                 // new sessionId, branched history
await s.kill();
```

### `pool()` — N concurrent agents

```ts
const p = claude.pool({ concurrency: 4, defaults: { model: 'claude-haiku-4-5' } });

// fan-out
const out = await p.map(files, (f) => ({ prompt: `Document ${f}` }));

// race
const winner = await p.race([
  { prompt: 'solve', model: 'claude-opus-4-7' },
  { prompt: 'solve', model: 'claude-sonnet-4-6' },
]);

// unified observability
for await (const ev of p.events()) {
  if (ev.type === 'error') console.error(ev);
}

await p.kill('all');
```

### `inspect()` / `list()` — read-only session snapshots

```ts
const snap = await claude.inspect(sessionId, { cwd: '/repo' });
console.log(snap.derivedStatus);         // 'active' | 'completed' | 'interrupted' | 'unknown'
console.log(snap.numTurns, snap.totalCostUsd);

const all = await claude.list({ cwd: '/repo' });
// sorted by most recent activity first
```

> `appearsActive` is a heuristic based on `mtime` + absence of a `result` message. Pair with your own job registry for authoritative liveness.

### How the `AskUserQuestion` bridge actually works

Claude Code's built-in `AskUserQuestion` tool has no TTY to render a picker in headless SDK mode, and `PostToolUse` does **not** fire for it. The bridge intercepts at `PreToolUse` instead:

1. The model emits a `tool_use` for `AskUserQuestion` with the questions.
2. Our PreToolUse hook calls your `onAskUser` handler with the unmarshalled questions and awaits the response.
3. The hook returns `permissionDecision: 'deny'` with the answers JSON-encoded in `permissionDecisionReason`. The model receives the JSON as the tool result.

You'll see a "denied tool call" entry in the transcript for each AskUserQuestion. That's intentional — it's the only fire-able interception point in v0.1.

## Errors

All errors thrown by the SDK extend `ClaudeError` and carry a stable string `code`:

```ts
import { ClaudeError, KilledError, BudgetExceededError } from '@aclarify/claude-code-sdk';

try {
  await claude.run({ prompt: 'long task' });
} catch (e) {
  if (e instanceof KilledError) /* user clicked stop */;
  if (e instanceof BudgetExceededError) console.log(e.costUsd, e.limitUsd);
}
```

Codes: `SESSION_NOT_FOUND`, `PERMISSION_DENIED`, `MAX_TURNS_EXCEEDED`, `BUDGET_EXCEEDED`, `INTERRUPTED`, `KILLED`, `CLI_ERROR`, `TIMEOUT`.

## Compatibility

| `@aclarify/claude-code-sdk` | `@anthropic-ai/claude-agent-sdk` |
|----------------------------|-----------------------------------|
| 0.1.x                      | ^0.3.0                            |

If the installed upstream is outside the tested range, the SDK logs a one-time `console.warn` on first use. It does not throw.

## Development

This is a [Turborepo](https://turbo.build/) + [pnpm](https://pnpm.io/) monorepo.

```bash
pnpm install
pnpm build
pnpm test            # unit + types
pnpm test:e2e        # requires `claude` on PATH + ANTHROPIC_API_KEY
```

Examples live in `./examples/`. Each is a workspace consumer of the SDK.

## Upstream attribution

This package wraps [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), which is © Anthropic PBC and governed by Anthropic's [Legal Agreements](https://code.claude.com/docs/en/legal-and-compliance). Using `@aclarify/claude-code-sdk` requires that you also accept those terms — the MIT license on this wrapper applies only to the wrapper's source code.

## License

MIT — see [LICENSE](./LICENSE). Wrapper code only; upstream Anthropic packages retain their own terms.
