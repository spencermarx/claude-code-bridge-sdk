---
'@aclarify/claude-code-sdk': minor
---

Initial release of `@aclarify/claude-code-sdk` — a thin TypeScript bridge SDK over `@anthropic-ai/claude-agent-sdk`.

Highlights:

- `claude.run(opts)` — awaitable + iterable one-shot handle with `.sessionId`, `.text()`, `.result`, `.kill()`, `.interrupt()`.
- `claude.session(opts)` — long-lived stateful agent with `.send()`, `.invoke()`, `.fork()`, `.commands()`, `.models()`, `.setModel()`, `.setPermissionMode()`, `.snapshot()`.
- `claude.pool(opts)` — concurrency-capped orchestrator with `map`, `race`, `broadcast`, `pipeline`, unified `events()`, and `kill('all')`.
- `claude.inspect(sessionId, { cwd })` / `claude.list({ cwd })` — read-only snapshots of any session by id, including across processes.
- First-class `onAskUser` handler for Claude Code's `AskUserQuestion` tool.
- Re-exports upstream `Options`, `SDKMessage`, all hook types, MCP helpers (`createSdkMcpServer`, `tool`).
- Typed `ClaudeError` hierarchy with stable string codes.
