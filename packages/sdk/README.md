# `@aclarify/claude-code-sdk`

Ergonomic TypeScript SDK for building apps on top of Claude Code.

See the [monorepo README](../../README.md) for the full overview, design rationale, and examples.

## Install

```bash
pnpm add @aclarify/claude-code-sdk
# or
npm install @aclarify/claude-code-sdk
```

## Usage

```ts
import { claude } from '@aclarify/claude-code-sdk';

const r = claude.run({ prompt: 'Hello' });
for await (const chunk of r.text()) process.stdout.write(chunk);
const final = await r;
console.log(final.sessionId, final.costUsd);
```

## License

MIT
