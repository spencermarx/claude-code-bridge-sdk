# CLAUDE.md — e2e tests

E2E tests run the SDK against a real, globally-installed `claude` CLI. They burn API credits and are slow. Treat each one as a budget item.

## Prerequisites (enforced by `_setup.ts`)

Before any test runs, the Vitest `globalSetup` shells out to check:

1. `claude --version` exits 0. (`claude` must be on `PATH`.)
2. Either `ANTHROPIC_API_KEY` is set in the environment OR `claude auth status` reports logged in.

If either check fails the entire e2e project aborts with a single actionable error — never a wall of per-test failures.

Locally, run `pnpm e2e:doctor` to verify both prerequisites without running the suite.

## How to write an e2e test

The canonical shape is:

```ts
import { describe, expect, it } from 'vitest';
import { claude } from '../../src';
import { e2eBaseOpts, useTempCwd, withTimeout } from './_helpers';

describe('e2e: <feature>', () => {
  const cwd = useTempCwd();

  it('<structural contract>', async () => {
    const ac = withTimeout(60_000);
    const r = claude.run({
      ...e2eBaseOpts,            // model + maxTurns + permissionMode
      cwd: cwd(),                // fresh mkdtemp per suite
      abortController: ac,       // own timeout, owns cleanup
      prompt: 'Reply with one word: ok.',
    });

    // Structural assertions only — never assert exact text from the model.
    const final = await r;
    expect(typeof final.sessionId).toBe('string');
    expect(final.text.length).toBeGreaterThan(0);
  });
});
```

## Hard rules

### Cost control

- **Always use `e2eBaseOpts`** unless the test specifically needs different settings. It pins `model: 'claude-haiku-4-5'`, `maxTurns: 3`, `permissionMode: 'plan'`. Each test should cost < $0.01.
- **Always pass `abortController: withTimeout(N)`** with a tight N (30–120s). Tests that time out reach into ongoing turns and burn tokens for no signal.
- **Never set `maxTurns` higher than the test's actual need.** If your prompt should take one turn, set `maxTurns: 1`.

### Determinism

- **Never assert exact model text.** Models drift; tests flake.
  - Bad:  `expect(final.text).toBe('Hello world')`
  - Good: `expect(final.text.toLowerCase()).toMatch(/blue|red/)` or `expect(typeof final.sessionId).toBe('string')`
- **Force tool-only paths via `allowedTools`** when testing tool-handler features. The `ask-user.e2e.test.ts` test allowlists only `AskUserQuestion` so the model has no escape hatch.
- **Wait for upstream's filesystem writes to flush** before reading transcripts. The `inspect.e2e.test.ts` waits 200ms between the run completing and the snapshot read.

### Isolation

- **Always use `useTempCwd()`.** Each describe block creates a fresh `mkdtemp()` directory and removes it on teardown. Don't share state between tests.
- **Each test creates its own `AbortController`.** Reusing one between tests creates aborts that fire mid-other-tests.

### Sessions need a first `send()` to initialize

Upstream emits `system/init` only after consuming the first user message. So:

```ts
const s = claude.session({ ...e2eBaseOpts, cwd: cwd() });
const sid = await s.sessionId;  // ❌ hangs forever
```

Instead:

```ts
const s = claude.session({ ...e2eBaseOpts, cwd: cwd() });
const turn = s.send('hi');      // triggers init
const sid = await s.sessionId;  // ✓ now resolves
```

This applies to `.commands()`, `.models()`, `.fork()` — anything that reads the session's id. Always send first.

## The fixture skill

`test/e2e/fixtures/.claude/skills/demo/SKILL.md` exists for `commands.e2e.test.ts`. The test `cp -r`s the fixture into the temp cwd and runs the session with `settingSources: ['project']` so Claude Code discovers the skill from disk. If you add more skill-dependent tests, follow the same pattern.

## When something flakes

E2E flakes are almost always one of:

1. **Model behavior changed.** Re-read the prompt — is it forcing the desired path or making the model guess? Tighten with `allowedTools`, more imperative wording, or `model: 'claude-sonnet-4-6'` if Haiku doesn't reliably follow tool-use instructions.
2. **Filesystem race.** Add a 200ms `setTimeout` between the SDK-side completion and the on-disk read.
3. **Auth blip.** Re-check `pnpm e2e:doctor`.

Don't add retries inside the test. Either fix the source of the flake or document it as a known limitation in this file.

## Adding a new e2e test

1. Create `<feature>.e2e.test.ts` (the `.e2e.test.ts` suffix matters — `vitest.e2e.config.ts` only picks up that pattern).
2. Import `e2eBaseOpts`, `useTempCwd`, `withTimeout` from `./_helpers`.
3. Write at most 1–3 tests per feature. E2E coverage is structural, not exhaustive — unit tests cover the matrix.
4. Run it once locally before committing: `pnpm -F claude-code-bridge-sdk test:e2e`.
5. Confirm the suite total runtime hasn't ballooned. Aim for <2 minutes total wall time.
