import { describe, expect, it } from 'vitest';
import { claude } from '../../src';
import { e2eBaseOpts, useTempCwd, withTimeout } from './_helpers';

describe('e2e: run()', () => {
  const cwd = useTempCwd();

  it('streams text, resolves sessionId before result, returns a FinalResult', async () => {
    const ac = withTimeout(60_000);
    const r = claude.run({
      ...e2eBaseOpts,
      prompt: 'Reply with exactly: hello',
      cwd: cwd(),
      abortController: ac,
    });

    const sessionId = await r.sessionId;
    expect(typeof sessionId).toBe('string');
    expect(sessionId.length).toBeGreaterThan(0);

    let yielded = 0;
    for await (const chunk of r.text()) {
      if (chunk.length > 0) yielded++;
    }
    expect(yielded).toBeGreaterThanOrEqual(1);

    const final = await r;
    expect(final.sessionId).toBe(sessionId);
    expect(final.inputTokens).toBeGreaterThan(0);
    expect(final.outputTokens).toBeGreaterThan(0);
    expect(final.numTurns).toBeGreaterThanOrEqual(1);
    expect(typeof final.text).toBe('string');
  });

  it('iterates the raw SDKMessage stream and yields at least one assistant message', async () => {
    const ac = withTimeout(60_000);
    const r = claude.run({
      ...e2eBaseOpts,
      prompt: 'Reply with exactly: ok',
      cwd: cwd(),
      abortController: ac,
    });
    let sawAssistant = false;
    let sawResult = false;
    for await (const msg of r) {
      if (msg.type === 'assistant') sawAssistant = true;
      if (msg.type === 'result') sawResult = true;
    }
    expect(sawAssistant).toBe(true);
    expect(sawResult).toBe(true);
  });
});
