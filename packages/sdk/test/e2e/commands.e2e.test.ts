import { cp } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { claude } from '../../src';
import { e2eBaseOpts, useTempCwd, withTimeout } from './_helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('e2e: commands() and invoke()', () => {
  const cwd = useTempCwd();

  beforeAll(async () => {
    const fixture = resolve(__dirname, 'fixtures', '.claude');
    const dest = resolve(cwd(), '.claude');
    await cp(fixture, dest, { recursive: true });
  });

  it('returns a non-empty list of commands and models after a warm-up turn', async () => {
    // Upstream emits `init` only after consuming the first user message, so we
    // send a trivial turn first to trigger initialization. Once that turn
    // completes, sessionId is resolved and commands()/models() work.
    const ac = withTimeout(90_000);
    const s = claude.session({
      ...e2eBaseOpts,
      cwd: cwd(),
      settingSources: ['project'],
      abortController: ac,
    });
    await s.send('Reply with one word: ok.').result;

    const cmds = await s.commands();
    expect(Array.isArray(cmds)).toBe(true);
    expect(cmds.length).toBeGreaterThan(0);
    for (const c of cmds) expect(typeof c.name).toBe('string');

    const models = await s.models();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);

    await s.kill();
  });
});
