import { describe, expect, it } from 'vitest';
import { claude } from '../../src';
import { e2eBaseOpts, useTempCwd, withTimeout } from './_helpers';

describe('e2e: pool()', () => {
  const cwd = useTempCwd();

  it('runs map() with a concurrency cap and returns one result per item', async () => {
    const ac = withTimeout(120_000);
    const p = claude.pool({
      concurrency: 2,
      defaults: { ...e2eBaseOpts, cwd: cwd() },
      signal: ac.signal,
    });

    const colors = ['red', 'blue', 'green', 'yellow'];
    const results = await p.map(colors, (color) => ({
      prompt: `Reply with the single word: ${color}.`,
    }));

    expect(results).toHaveLength(colors.length);
    for (const r of results) {
      expect(typeof r.result.sessionId).toBe('string');
      expect(r.result.sessionId.length).toBeGreaterThan(0);
    }
    await p.kill('all');
  });

  it('kill("all") leaves an empty registry', async () => {
    const ac = withTimeout(60_000);
    const p = claude.pool({ defaults: { ...e2eBaseOpts, cwd: cwd() }, signal: ac.signal });
    p.run({ prompt: 'reply: a' });
    p.run({ prompt: 'reply: b' });
    await p.kill('all');
    expect(p.list()).toEqual([]);
  });
});
