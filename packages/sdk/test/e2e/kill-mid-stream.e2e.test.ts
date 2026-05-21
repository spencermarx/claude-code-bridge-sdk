import { describe, expect, it } from 'vitest';
import { claude } from '../../src';
import { e2eBaseOpts, useTempCwd, withTimeout } from './_helpers';

describe('e2e: kill mid-stream', () => {
  const cwd = useTempCwd();

  it('run().kill() during streaming returns control and the handle settles', async () => {
    const ac = withTimeout(60_000);
    const r = claude.run({
      ...e2eBaseOpts,
      cwd: cwd(),
      abortController: ac,
      // A long, structured task — increases the odds that we get the kill in
      // before the result naturally settles. The test below tolerates either
      // outcome (rejected by kill OR resolved before kill propagated).
      prompt:
        'Write a 500-word detailed essay about prime numbers between 1 and 1000. Include examples.',
    });

    let firstChunkSeen = false;
    let killed = false;
    let killCallReturned = false;
    try {
      for await (const _ of r.text()) {
        if (!firstChunkSeen) {
          firstChunkSeen = true;
          killed = true;
          // Don't await — let kill propagate while we keep iterating.
          void r.kill().then(() => {
            killCallReturned = true;
          });
        }
      }
    } catch {
      // Iterator may throw if kill races with the next message.
    }

    // We received at least one text chunk and successfully issued kill.
    expect(firstChunkSeen).toBe(true);
    expect(killed).toBe(true);

    // The run handle settles one way or the other — either rejected (kill won
    // the race) or resolved (model finished before kill propagated). Both are
    // valid outcomes; what matters is no hang.
    const outcome = await r.result.then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    );
    expect(['resolved', 'rejected']).toContain(outcome);

    // Allow the kill call's own promise to land (no leaked microtasks).
    await new Promise((res) => setTimeout(res, 50));
    expect(killCallReturned).toBe(true);
  });
});
