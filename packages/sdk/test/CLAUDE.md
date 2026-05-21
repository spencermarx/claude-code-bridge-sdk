# CLAUDE.md — test conventions

Three test categories live under `packages/sdk/test/`:

| Directory | What it tests | Runs in | API calls? |
|---|---|---|---|
| `unit/`  | Behavior of one module, against mocked upstream | `pnpm test` | No |
| `types/` | Compile-time invariants on the public surface | `pnpm test` (vitest typecheck) | No |
| `e2e/`   | The SDK end-to-end against a real `claude` CLI | `pnpm test:e2e` only | Yes — costs money |

`pnpm test` runs **only** unit + types. E2E is opt-in via `pnpm test:e2e` (see `test/e2e/CLAUDE.md`).

## Unit tests

### Mock upstream `query()`

Every test that touches `run()` / `session()` / `pool()` mocks `@anthropic-ai/claude-agent-sdk` via `vi.mock`. The pattern is in `test/unit/run.test.ts` and `test/unit/pool.test.ts`. The mock returns an async generator with `.interrupt()`, `.setModel()`, `.setPermissionMode()`, `.supportedCommands()`, `.supportedModels()` methods — the methods our code calls. **Add more methods to the mock when you call new ones from src/**, otherwise tests pass but production breaks.

### Use `_fixtures.ts`

`test/unit/_fixtures.ts` exports typed mock-message builders:

```ts
initMessage('sid-1')                              // system/init with that session id
assistantMessage('sid-1', 'hello')                // assistant text block
resultMessage('sid-1', { text: 'hi', costUsd: 0.001, … })
streamTextDelta('sid-1', 'Hel', uuid?)            // stream_event content_block_delta text_delta
asyncSource([…messages], { delayMs?, throwAfter? }) // async iterable wrapper
```

Use these — don't hand-roll message objects. The fixtures encode the real-world envelope shape (uuid, session_id, parent_tool_use_id) so tests stay close to production traffic.

### Don't test internals through the public API by accident

If you're testing `DualHandle` behavior, import `DualHandle` directly. If you're testing `run()`, mock upstream and don't touch `DualHandle` internals. The dependency direction matters — testing `run()` through `DualHandle` couples two tests to one bug.

### Naming

`<feature>.test.ts` for unit tests, one per module under test. `_fixtures.ts` and `_*` prefixes for shared helpers (excluded from test discovery only if you also exclude them in the vitest include glob — currently they're allowed to be imported freely).

## Type tests (`test/types/public-surface.test-d.ts`)

Vitest's `typecheck` feature runs these via `tsc`. They use `expectTypeOf` from `expect-type` to assert:

- Re-exported upstream types are **identical** (`toEqualTypeOf<UpstreamOptions>()`) — catches drift.
- Public interfaces have the documented shape (`SessionSnapshot.derivedStatus` is the right union).
- `RunHandle` is both `AsyncIterable<SDKMessage>` and `PromiseLike<FinalResult>`.

When you add a public export, add a `.test-d.ts` assertion. When you change the shape of a public type, the type test should be the first thing to fail.

## ESM-only invariants

`test/unit/esm-only.test.ts` reads `packages/sdk/package.json` at test time and asserts:

- `type === 'module'`
- `exports['.']` has **no** `require` condition
- `main` ends in `.js` (not `.cjs`)
- No `module` field present

If a PR re-introduces dual ESM/CJS or a `require` path, these tests fail loudly. Don't disable them — read the `build(sdk): ship as ESM-only` commit instead.

## What to assert

- **Structure, not nondeterminism.** For mocked tests, exact values are fine (you control the mock). For e2e tests against the live model, only assert structural properties (`typeof`, `.length > 0`, `toMatch(/blue|red/)`).
- **Both throw paths and result paths.** When a function can reject or throw, test both. `DualHandle` errors propagate through both the AsyncIterable AND the Promise — test that.
- **Cleanup happens.** Especially for `kill()` semantics: after kill, status flips, in-flight promises reject, and resources are released.

## What to skip

- **Don't test Biome's job.** No "must be camelCase" assertions, no "must use type imports" tests.
- **Don't test trivial getters.** If a field is just `return this._cost`, skip the test.
- **Don't write smoke tests that only call the function with no assertions.** Either assert something specific or delete the test.

## Adding a test

1. Decide unit / type / e2e (use the matrix at the top).
2. For unit: copy the `vi.mock('@anthropic-ai/claude-agent-sdk', …)` block from `run.test.ts` or `pool.test.ts`; tweak the script.
3. For e2e: see `test/e2e/CLAUDE.md`.
4. Run `pnpm test` (and `pnpm test:e2e` if applicable) before committing.
5. Tests + the code they cover land in the **same commit**.
