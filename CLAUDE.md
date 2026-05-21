# CLAUDE.md

Workspace-level guidance for Claude Code instances working inside this repo. Nested `CLAUDE.md` files in `packages/sdk/`, `packages/sdk/src/internal/`, `packages/sdk/test/`, `packages/sdk/test/e2e/`, and `examples/` have domain-specific instructions — load them when you enter those areas.

## What this repo is

A pnpm + Turborepo monorepo that publishes `claude-code-bridge-sdk` — a thin TypeScript bridge over `@anthropic-ai/claude-agent-sdk`. The SDK adds: stateful `Session`, concurrent `Pool`, `AskUserQuestion` handler, slash-command discovery, and on-disk `inspect()`/`list()`. Nothing here reimplements what upstream already does — every leak of upstream complexity is a bug.

## Layout

```
packages/
  sdk/         claude-code-bridge-sdk — the published package
  tsconfig/    Internal, unpublished shared TS preset
examples/      Eight workspace consumers; each is its own package
.changeset/    Pending semver bumps + changelog entries (do not edit by hand)
.github/       CI + release workflows
```

## Tooling

| Concern | Tool | Notes |
|---|---|---|
| Package manager | **pnpm 9+** | Workspaces; lockfile committed |
| Task runner | **Turbo** | `turbo.json` defines `build` / `typecheck` / `test` / `test:e2e` / `lint` |
| Build | **tsdown** (rolldown-based) | ESM-only; emits `.js` + `.d.ts` only |
| Test | **Vitest 2.x** | Separate config for e2e |
| Lint + format | **Biome** | Single config (`biome.json`); replaces ESLint + Prettier |
| Release | **Changesets** | One markdown file per change; `pnpm changeset` to add |
| TS | **5.x strict** | `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` all on |

## Common commands

Run from the repo root:

```bash
pnpm install              # bootstrap
pnpm build                # turbo run build across all packages
pnpm typecheck            # tsc --noEmit
pnpm test                 # unit + type tests (no API calls)
pnpm test:e2e             # real claude CLI required; costs API credits
pnpm lint                 # biome check .
pnpm format               # biome format --write .
pnpm changeset            # add a changeset for the next release
```

Workspace-scoped (preferred when working inside one package):

```bash
pnpm -F claude-code-bridge-sdk <script>
pnpm -F example-01-one-shot-streaming start
```

## Conventions

- **Conventional Commits.** Every commit message starts with `type(scope): subject`. Allowed types: `feat`, `fix`, `chore`, `docs`, `test`, `ci`, `build`, `refactor`. The scope is the affected area (`sdk`, `repo`, `tsconfig`, `ci`, or nothing for repo-wide docs).
- **One logical change per commit.** Tests + the code they cover land in the same commit. New features add their source + tests + (when applicable) an example in one atomic group.
- **Bridge over wrap.** Re-export upstream types (`type {...} from '@anthropic-ai/claude-agent-sdk'`) — never re-declare. Every redeclaration is one place where we'll drift from upstream.
- **ESM-only.** No `.cjs` artifacts; no `require` conditional in `exports`. Guarded by `packages/sdk/test/unit/esm-only.test.ts`.
- **No emojis in source or commit messages** unless a user explicitly asks.
- **No premature dependencies.** Anything beyond `@anthropic-ai/claude-agent-sdk` (hard) and `zod` (peer-optional, for MCP tool authors) needs justification.
- **No backwards-compat hacks** during pre-1.0; minor bumps may break compatibly with upstream's pace.

## Where things live

| If you need to … | Look in |
|---|---|
| Add a new public API | `packages/sdk/src/` + extend `packages/sdk/src/index.ts` |
| Touch DualHandle / Pushable / Deferred semantics | `packages/sdk/src/internal/CLAUDE.md` first |
| Add a unit test | `packages/sdk/test/unit/` + `_fixtures.ts` helpers |
| Add an e2e test | `packages/sdk/test/e2e/CLAUDE.md` first |
| Modify upstream-options passthrough | `packages/sdk/src/types.ts` re-exports `Options`. Don't fork. |
| Verify package shape | `packages/sdk/test/unit/esm-only.test.ts` enforces ESM-only invariants |
| Document a behavior for users | the relevant `README.md`; for AI-agent guidance, the relevant `CLAUDE.md` |

## What NOT to do

- Don't reach into `@anthropic-ai/claude-agent-sdk`'s implementation files. Only import its public API.
- Don't add `console.log` in source — Biome flags `noConsole`. The one `console.warn` for version drift is marked with a `biome-ignore` and is intentional.
- Don't write `any`. Use `unknown` + narrowing; cast through `as unknown as T` only when bridging untyped upstream payloads (and even then, comment why).
- Don't introduce a new top-level export without first updating the barrel `packages/sdk/src/index.ts` AND the type test `packages/sdk/test/types/public-surface.test-d.ts`.
- Don't add a CJS build path. If you think you need one, read the `build(sdk): ship as ESM-only` commit message first.
