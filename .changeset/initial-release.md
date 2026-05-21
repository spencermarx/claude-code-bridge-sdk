---
'claude-code-bridge-sdk': patch
---

Initial release of `claude-code-bridge-sdk` — a thin TypeScript bridge SDK over `@anthropic-ai/claude-agent-sdk`.

Highlights:

- `claude.run(opts)` — awaitable + iterable one-shot handle with `.sessionId`, `.text()`, `.result`, `.kill()`, `.interrupt()`.
- `claude.session(opts)` — long-lived stateful agent with `.send()`, `.invoke()`, `.fork()`, `.commands()`, `.models()`, `.setModel()`, `.setPermissionMode()`, `.snapshot()`.
- `claude.pool(opts)` — concurrency-capped orchestrator with `map`, `race`, `broadcast`, `pipeline`, unified `events()`, and `kill('all')`.
- `claude.inspect(sessionId, { cwd })` / `claude.list({ cwd })` — read-only snapshots of any session by id, including across processes.
- First-class `onAskUser` handler for Claude Code's `AskUserQuestion` tool.
- Re-exports upstream `Options`, `SDKMessage`, all hook types, MCP helpers (`createSdkMcpServer`, `tool`).
- Typed `ClaudeError` hierarchy with stable string codes.
- **ESM-only** by design (matches upstream `@anthropic-ai/claude-agent-sdk`). Use ESM, `.mjs`, TypeScript NodeNext/Bundler, or a bundler. CJS consumers can use dynamic `import('claude-code-bridge-sdk')`.
