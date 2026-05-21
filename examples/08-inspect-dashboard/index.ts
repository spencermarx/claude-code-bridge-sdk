// Session-state dashboard demo.
//
// Spawn three short runs in this process, capture their session ids, then call
// `claude.list({ cwd })` and print a table showing each session's derived
// status. Simulates a dashboard that polls "are any of my sessions still
// running?" across processes.

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { claude } from '@aclarify/claude-code-sdk';

const cwd = await mkdtemp(join(tmpdir(), 'claude-bridge-dashboard-'));
console.error(`[dashboard] cwd: ${cwd}`);

const colors = ['red', 'blue', 'green'];
const sessionIds: string[] = [];

for (const c of colors) {
  const r = claude.run({
    prompt: `Reply with one word: the color ${c}.`,
    model: 'claude-haiku-4-5',
    cwd,
    permissionMode: 'plan',
  });
  const sid = await r.sessionId;
  await r; // wait for completion
  sessionIds.push(sid);
  console.error(`[dashboard] finished ${c} → ${sid}`);
}

console.error('\n--- snapshot via claude.list ---');
const snapshots = await claude.list({ cwd });
console.table(
  snapshots.map((s) => ({
    sessionId: s.sessionId.slice(0, 8),
    status: s.derivedStatus,
    turns: s.numTurns,
    costUsd: s.totalCostUsd?.toFixed(4) ?? '',
    lastActivity: s.lastActivity?.toISOString() ?? '',
  })),
);

console.error('\n--- per-id inspect (sample) ---');
const target = sessionIds[0];
if (target) {
  const snap = await claude.inspect(target, { cwd });
  console.log(JSON.stringify(snap, null, 2));
}
