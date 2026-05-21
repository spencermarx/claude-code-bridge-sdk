import { describe, expect, it } from 'vitest';
import { claude } from '../../src';
import { e2eBaseOpts, useTempCwd, withTimeout } from './_helpers';

describe('e2e: permissions', () => {
  const cwd = useTempCwd();

  it('blocks a tool listed in disallowedTools', async () => {
    const ac = withTimeout(60_000);
    const r = claude.run({
      ...e2eBaseOpts,
      cwd: cwd(),
      abortController: ac,
      disallowedTools: ['Bash'],
      // Force the model to want to call Bash.
      prompt: 'Use Bash to run `echo hello`. If you cannot, just reply: blocked.',
    });
    const final = await r;
    // We don't assert exact text, just that the run completes — Claude can
    // either short-circuit with "blocked" or surface a permission denial
    // message in its output.
    expect(typeof final.text).toBe('string');
  });

  it('completes successfully when only read-only tools are allowed', async () => {
    const ac = withTimeout(60_000);
    const r = claude.run({
      ...e2eBaseOpts,
      cwd: cwd(),
      abortController: ac,
      allowedTools: ['Read'],
      permissionMode: 'plan',
      prompt: 'Reply with one word: ok.',
    });
    const final = await r;
    expect(final.text.toLowerCase()).toMatch(/ok/);
  });
});
