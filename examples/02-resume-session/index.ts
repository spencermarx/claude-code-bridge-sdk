// Resume-session demo.
//
// Walks through the round-trip:
//   1. Start a session, remember a fact, capture the sessionId, kill the agent.
//   2. Persist the sessionId externally (here: a local file — substitute your DB).
//   3. In a fresh "process" (here: a function call below), spawn a new Session
//      with `resume: <sessionId>` and ask the agent to recall the fact.
//
// In production you'd run step 1 and step 3 in genuinely separate processes.
// For demo purposes we sequence them in one script.

import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { claude } from 'claude-code-bridge-sdk';

const stateFile = join(tmpdir(), `claude-bridge-example-02-${process.pid}.json`);

async function step1RememberAndPersist(): Promise<string> {
  console.error('[1] starting session, remembering "42"…');
  const s = claude.session({
    model: 'claude-haiku-4-5',
    permissionMode: 'plan', // read-only — no edits needed
  });
  const sessionId = await s.sessionId;
  console.error(`[1] sessionId: ${sessionId}`);

  const turn = s.send('Remember the number 42 for me. Reply with one word: ok.');
  await turn; // wait for the result
  await writeFile(stateFile, JSON.stringify({ sessionId }), 'utf8');
  await s.kill();
  console.error(`[1] persisted sessionId to ${stateFile} and killed agent.`);
  return sessionId;
}

async function step3ResumeAndRecall(): Promise<void> {
  const { sessionId } = JSON.parse(await readFile(stateFile, 'utf8')) as { sessionId: string };
  console.error(`\n[3] resuming session ${sessionId}…`);
  const s = claude.session({
    resume: sessionId,
    model: 'claude-haiku-4-5',
    permissionMode: 'plan',
  });
  const turn = s.send('What number did I ask you to remember? Reply with just the number.');
  for await (const chunk of turn.text()) process.stdout.write(chunk);
  const final = await turn;
  console.error(`\n[3] cost=$${final.costUsd.toFixed(4)}`);
  await s.kill();
}

try {
  await step1RememberAndPersist();
  await step3ResumeAndRecall();
} finally {
  await unlink(stateFile).catch(() => {});
}
