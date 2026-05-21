# CLAUDE.md — examples

Each subdirectory is an independent workspace package that consumes `@aclarify/claude-code-sdk` via `workspace:*`. Examples have two purposes:

1. **Documentation by execution.** Each one demonstrates one capability end-to-end.
2. **Install-path smoke test.** Because they consume `workspace:*`, every example exercises the same resolution path a real user would hit.

## Conventions

Every example follows the same skeleton:

```
<NN>-<feature-name>/
  package.json         private: true, type: module, name: @aclarify/example-<NN>-<feature-name>
  tsconfig.json        extends @aclarify/tsconfig-claude-sdk/base.json, noEmit: true
  index.ts             top-level await, ESM imports from @aclarify/claude-code-sdk
```

The `name` field uses the prefix `@aclarify/example-` so `pnpm -F @aclarify/example-…` works as a recursive selector.

`scripts.start` is `node --experimental-strip-types index.ts`. This lets you `pnpm -F <example> start` without a build step. The `tsconfig.json`'s `noEmit: true` is intentional — we typecheck but never emit.

## Numbering scheme

Numbers reflect the original docs index, with gaps allowed for future additions:

- `01-one-shot-streaming` — `claude.run()`, `.text()`, `FinalResult`
- `02-resume-session`     — `kill()`, persist `sessionId`, `claude.session({ resume })`
- `03-concurrent-agents`  — `claude.pool({ concurrency })`, `events()`, `kill('all')`
- `04-kill-and-fork`      — `kill()` mid-stream, `.fork()` branches
- `05-custom-mcp-tool`    — (reserved; not yet implemented)
- `06-ask-user`           — `onAskUser` handler intercepting `AskUserQuestion`
- `07-commands-and-skills` — `commands()`, `models()`, `invoke()` against a fixture skill
- `08-inspect-dashboard`  — `claude.list({ cwd })`, `claude.inspect(id)`

## Adding a new example

1. Pick the next unused number.
2. Copy the structure of `examples/01-one-shot-streaming/` — package.json, tsconfig.json, index.ts.
3. Update `package.json#name` to `@aclarify/example-<NN>-<feature-name>`.
4. Run `pnpm install` from the repo root to wire `workspace:*` links.
5. Run `pnpm -F @aclarify/example-<NN>-<feature-name> typecheck` to verify.
6. Make sure the example runs with **only a global `claude` CLI + `ANTHROPIC_API_KEY`** — no extra setup. Use `mkdtemp` for any scratch state.
7. Reference the example in `examples/CLAUDE.md` (this file) under "Numbering scheme".

## Hard rules

- **Top-level `await` is fine.** Examples are ESM modules and Node supports it.
- **Use `process.stderr` for diagnostic / framing output, `process.stdout` for the model's actual output.** Lets users pipe one without the other.
- **Hardcode `model: 'claude-haiku-4-5'`** unless the example specifically demonstrates model switching. Examples should cost <$0.01 to run once.
- **Set `permissionMode: 'plan'`** unless the example demonstrates editing files. Plan mode keeps examples safe in any cwd.
- **Clean up on exit.** If an example creates a temp dir, `try/finally` unlink it. Examples will be run by curious users in their home directories — don't leave artifacts.

## What NOT to do

- Don't pin to a hardcoded sessionId or filesystem path — examples are self-contained.
- Don't depend on the `claude` CLI being authenticated in a specific way; examples should work with either `ANTHROPIC_API_KEY` or a prior `claude auth login`.
- Don't add npm dependencies beyond `@aclarify/claude-code-sdk` (workspace) and dev deps. If an example needs `inquirer` or similar, it's a sign the SDK should expose a helper instead.
- Don't add a "framework" or shared helper across examples. Each example is self-contained and self-explanatory — copy-paste over abstraction.
