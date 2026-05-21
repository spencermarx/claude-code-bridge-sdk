// One-shot streaming demo.
//
// Verifies the four core promises of `@aclarify/claude-code-sdk`:
//   1. iteration of messages works
//   2. `.text()` streams text deltas as they arrive
//   3. `.sessionId` resolves on system/init — before the first text token
//   4. awaiting the handle returns a FinalResult with cost + usage
//
// Run with:
//   ANTHROPIC_API_KEY=… node --experimental-strip-types index.ts
// or with the workspace runner:
//   pnpm -F @aclarify/example-01-one-shot-streaming start

import { claude } from '@aclarify/claude-code-sdk';

const prompt = process.argv.slice(2).join(' ') || 'Write a haiku about TypeScript.';

const handle = claude.run({
  prompt,
  model: 'claude-haiku-4-5',
  // includePartialMessages enables per-token streaming.
  includePartialMessages: true,
});

// Print session id the moment upstream emits the init message. This proves
// the SDK surfaces the id before the final result is available.
handle.sessionId
  .then((id) => console.error(`\n[session] ${id}\n`))
  .catch((err) => console.error('[session] failed:', err));

for await (const chunk of handle.text()) {
  process.stdout.write(chunk);
}

const final = await handle;
console.error(
  `\n\n[done] cost=$${final.costUsd.toFixed(4)} ` +
    `in=${final.inputTokens} out=${final.outputTokens} ` +
    `dur=${final.durationMs}ms turns=${final.numTurns} stop=${final.stopReason}`,
);
