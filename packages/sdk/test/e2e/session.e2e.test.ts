import { describe, expect, it } from 'vitest';
import { claude } from '../../src';
import { e2eBaseOpts, useTempCwd, withTimeout } from './_helpers';

describe('e2e: session()', () => {
  const cwd = useTempCwd();

  it('preserves context across two turns', async () => {
    const ac = withTimeout(90_000);
    const s = claude.session({
      ...e2eBaseOpts,
      cwd: cwd(),
      abortController: ac,
    });

    const turn1 = await s.send('Remember the number 42. Reply with one word: ok.');
    expect(turn1.text.toLowerCase()).toContain('ok');

    const turn2 = await s.send(
      'What number did I ask you to remember? Reply with just the number.',
    );
    expect(turn2.text).toMatch(/42/);

    await s.kill();
  });

  it('exposes a sessionId before the first turn resolves', async () => {
    const ac = withTimeout(60_000);
    const s = claude.session({ ...e2eBaseOpts, cwd: cwd(), abortController: ac });
    const handle = s.send('Reply with: hi.');
    const sid = await s.sessionId;
    expect(typeof sid).toBe('string');
    expect(sid.length).toBeGreaterThan(0);
    await handle;
    await s.kill();
  });
});
