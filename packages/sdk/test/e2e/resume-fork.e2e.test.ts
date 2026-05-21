import { describe, expect, it } from 'vitest';
import { claude } from '../../src';
import { e2eBaseOpts, useTempCwd, withTimeout } from './_helpers';

describe('e2e: resume + fork', () => {
  const cwd = useTempCwd();

  it('resumes a killed session by id and recalls prior turn content', async () => {
    const ac1 = withTimeout(60_000);
    const s1 = claude.session({ ...e2eBaseOpts, cwd: cwd(), abortController: ac1 });
    await s1.send('Remember the color blue. Reply: ok.').result;
    const sid = await s1.sessionId;
    await s1.kill();

    const ac2 = withTimeout(60_000);
    const s2 = claude.session({
      ...e2eBaseOpts,
      cwd: cwd(),
      resume: sid,
      abortController: ac2,
    });
    const r = await s2.send('What color did I tell you? Reply with one word.');
    expect(r.text.toLowerCase()).toContain('blue');
    await s2.kill();
  });

  it('fork() produces a new sessionId that differs from the parent', async () => {
    const ac = withTimeout(60_000);
    const parent = claude.session({ ...e2eBaseOpts, cwd: cwd(), abortController: ac });
    await parent.send('Remember the color blue. Reply: ok.').result;
    const parentId = await parent.sessionId;
    await parent.kill();

    const acBranch = withTimeout(60_000);
    const branch = parent.fork({ abortController: acBranch });
    // Forks (like fresh sessions) need a first send to trigger upstream init.
    const r = await branch.send('What color did I tell you? Reply with one word.');
    const branchId = await branch.sessionId;
    expect(branchId).not.toBe(parentId);
    expect(r.text.toLowerCase()).toContain('blue');
    await branch.kill();
  });
});
