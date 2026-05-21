import { describe, expect, it } from 'vitest';
import { claude } from '../../src';
import { e2eBaseOpts, useTempCwd, withTimeout } from './_helpers';

describe('e2e: inspect() + list()', () => {
  const cwd = useTempCwd();

  it('inspect() returns a completed snapshot after a finished run', async () => {
    const ac = withTimeout(60_000);
    const r = claude.run({
      ...e2eBaseOpts,
      cwd: cwd(),
      abortController: ac,
      prompt: 'Reply with one word: hello.',
    });
    const sessionId = await r.sessionId;
    await r;

    // Small wait so the upstream's filesystem writer flushes the JSONL.
    await new Promise((res) => setTimeout(res, 200));

    const snap = await claude.inspect(sessionId, { cwd: cwd() });
    expect(snap.exists).toBe(true);
    expect(snap.derivedStatus).toBe('completed');
    expect(snap.numTurns).toBeGreaterThanOrEqual(1);
    expect(snap.inputTokens).toBeGreaterThan(0);
    expect(snap.outputTokens).toBeGreaterThan(0);
    expect(snap.lastActivity).toBeInstanceOf(Date);
  });

  it('list() returns at least one snapshot for the cwd', async () => {
    const ac = withTimeout(60_000);
    const r = claude.run({
      ...e2eBaseOpts,
      cwd: cwd(),
      abortController: ac,
      prompt: 'Reply with one word: again.',
    });
    await r.sessionId;
    await r;
    await new Promise((res) => setTimeout(res, 200));

    const all = await claude.list({ cwd: cwd() });
    expect(all.length).toBeGreaterThanOrEqual(1);
    for (const s of all) {
      expect(typeof s.sessionId).toBe('string');
    }
  });

  it('inspect() of a non-existent id returns exists:false', async () => {
    const snap = await claude.inspect('00000000-0000-0000-0000-000000000000', { cwd: cwd() });
    expect(snap.exists).toBe(false);
  });
});
