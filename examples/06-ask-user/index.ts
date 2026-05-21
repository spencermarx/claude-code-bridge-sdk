// AskUserQuestion bridge demo.
//
// The host receives the questions Claude would have shown in the TUI picker,
// renders them however it likes (here: stdout + a deterministic auto-answer),
// and returns the answer back to the agent. The agent's final response should
// reflect the chosen answer.

import { claude, type AskUserHandler } from '@aclarify/claude-code-sdk';

const onAskUser: AskUserHandler = async ({ questions }) => {
  const answers: Record<string, string> = {};
  for (const q of questions) {
    // In a real app: render a modal / slash-command / API call to your UI.
    // Here we deterministically pick the first option.
    const pick = q.options[0]?.label ?? 'unknown';
    console.error(`[ask-user] ${q.question} — picking "${pick}"`);
    answers[q.question] = pick;
  }
  return { answers };
};

const r = claude.run({
  prompt:
    'Use the AskUserQuestion tool to ask me which web framework I prefer between React, Vue, and Svelte. Then in your final reply, tell me which one I chose.',
  model: 'claude-haiku-4-5',
  permissionMode: 'plan',
  onAskUser,
});

for await (const chunk of r.text()) process.stdout.write(chunk);
const final = await r;
console.error(`\n[done] sessionId=${final.sessionId} cost=$${final.costUsd.toFixed(4)}`);
