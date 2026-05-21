// Slash commands & skills demo.
//
// 1) List every command / skill the agent can invoke.
// 2) List every model it can switch to.
// 3) Invoke a project-local skill by name (`/demo`) — see ./skills/demo/SKILL.md.

import { claude } from 'claude-code-bridge-sdk';

const s = claude.session({
  model: 'claude-haiku-4-5',
  // Point Claude Code at this directory so it picks up `./skills/demo/SKILL.md`.
  cwd: import.meta.dirname,
  settingSources: ['project'],
  permissionMode: 'plan',
});

await s.sessionId;

console.error('--- commands ---');
for (const c of await s.commands()) {
  console.error(`  /${c.name}${c.argumentHint ? ` ${c.argumentHint}` : ''}`);
}

console.error('\n--- models ---');
for (const m of await s.models()) {
  console.error(`  ${m.id} — ${m.displayName}`);
}

console.error('\n--- invoking /demo ---');
const turn = s.invoke('demo');
for await (const chunk of turn.text()) process.stdout.write(chunk);
console.error();

await s.kill();
