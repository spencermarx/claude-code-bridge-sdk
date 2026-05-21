// Kill + fork demo.
//
//   A. Start a session, kill it mid-turn, confirm we receive an error.
//   B. Start a session, complete a turn, fork it into a branch, prove the
//      branch has a different sessionId than the parent.

import { claude } from '@aclarify/claude-code-sdk';

// --- A. Kill mid-turn -------------------------------------------------------

async function killMidTurn(): Promise<void> {
  console.error('[A] starting agent on a long task, killing after 1s…');
  const s = claude.session({ model: 'claude-haiku-4-5' });
  const turn = s.send('Count slowly from 1 to 1000, one number per line.');
  setTimeout(() => {
    void s.kill();
  }, 1000);
  try {
    await turn;
    console.error('[A] turn completed before kill (race lost — fine for the demo).');
  } catch (err) {
    console.error('[A] turn rejected after kill:', (err as Error).message);
  }
  console.error(`[A] session status: ${s.status}`);
}

// --- B. Fork a session ------------------------------------------------------

async function forkSession(): Promise<void> {
  console.error('\n[B] starting agent and remembering a fact…');
  const parent = claude.session({ model: 'claude-haiku-4-5', permissionMode: 'plan' });
  await parent.send('Remember the color is blue. Reply: ok.');
  const parentId = await parent.sessionId;
  console.error(`[B] parent sessionId: ${parentId}`);

  console.error('[B] forking…');
  const branch = parent.fork();
  const branchId = await branch.sessionId;
  console.error(`[B] branch sessionId: ${branchId}`);
  console.error(`[B] same id?: ${parentId === branchId}`); // expected: false

  const r = await branch.send('What color did I tell you? Reply with one word.');
  console.error(`[B] branch recalled: ${r.text.trim()}`);

  await parent.kill();
  await branch.kill();
}

await killMidTurn();
await forkSession();
