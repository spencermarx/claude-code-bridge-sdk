// Concurrent agents demo.
//
// Spawns five short prompts in parallel under a concurrency cap, prints the
// session ids and per-agent cost, and demonstrates the unified pool event
// stream + pool.kill('all').

import { claude } from 'claude-code-bridge-sdk';

const p = claude.pool({
  concurrency: 3,
  defaults: { model: 'claude-haiku-4-5', permissionMode: 'plan' },
});

const colors = ['red', 'blue', 'green', 'yellow', 'purple'];

// Background event observer: prints when each agent starts/ends.
void (async () => {
  for await (const ev of p.events()) {
    if (ev.type === 'started') console.error(`[pool] started ${ev.agentId.slice(0, 8)}`);
    if (ev.type === 'ended') {
      console.error(
        `[pool] ended ${ev.agentId.slice(0, 8)} cost=$${ev.result.costUsd.toFixed(4)}`,
      );
    }
    if (ev.type === 'error') console.error(`[pool] error ${ev.agentId.slice(0, 8)}`, ev.error);
  }
})();

const t0 = Date.now();
const results = await p.map(colors, (color) => ({
  prompt: `Name one fruit that is ${color}. Reply with just the fruit name.`,
}));
const wallMs = Date.now() - t0;

console.error('\n--- results ---');
for (const r of results) {
  console.log(`${r.item} → ${r.result.text.trim()} (session ${r.result.sessionId.slice(0, 8)})`);
}
console.error(`\nwall time: ${wallMs}ms (concurrency cap 3, 5 agents)`);

await p.kill('all');
