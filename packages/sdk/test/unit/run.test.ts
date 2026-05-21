import { describe, expect, it, vi } from 'vitest';

// Mock the upstream `query` function so unit tests don't spawn the real CLI.
// The mock returns an async generator wrapping our fixture messages plus an
// `interrupt()` method to mirror the upstream `Query` interface.
vi.mock('@anthropic-ai/claude-agent-sdk', async () => {
  return {
    query: vi.fn((_params: { prompt: unknown; options?: unknown }) => {
      const messages = mockQueueRef.value;
      let i = 0;
      const gen = {
        async next() {
          if (i >= messages.length) return { value: undefined as unknown, done: true as const };
          return { value: messages[i++], done: false as const };
        },
        async return(value: unknown) {
          i = messages.length;
          return { value, done: true as const };
        },
        async throw(err: unknown) {
          throw err;
        },
        interrupt: vi.fn(async () => {}),
        [Symbol.asyncIterator]() {
          return this;
        },
      };
      return gen;
    }),
  };
});

// Shared mock queue reference, populated per-test.
const mockQueueRef: { value: unknown[] } = { value: [] };

import { run } from '../../src/run';
import { assistantMessage, initMessage, resultMessage } from './_fixtures';

describe('run()', () => {
  it('returns a handle that streams messages and resolves the final result', async () => {
    mockQueueRef.value = [
      initMessage('sid-run-1'),
      assistantMessage('sid-run-1', 'hi'),
      resultMessage('sid-run-1', { text: 'hi', costUsd: 0.01 }),
    ];
    const h = run({ prompt: 'say hi' });
    const types: string[] = [];
    for await (const m of h) types.push(m.type);
    expect(types).toEqual(['system', 'assistant', 'result']);
    const final = await h.result;
    expect(final.sessionId).toBe('sid-run-1');
    expect(final.text).toBe('hi');
    expect(final.costUsd).toBe(0.01);
  });

  it('exposes sessionId before result completes', async () => {
    mockQueueRef.value = [
      initMessage('sid-early'),
      assistantMessage('sid-early', 'streaming'),
      resultMessage('sid-early'),
    ];
    const h = run({ prompt: 'go' });
    const sid = await h.sessionId;
    expect(sid).toBe('sid-early');
    await h.result;
  });

  it('text() yields per-message chunks when no partials are present', async () => {
    mockQueueRef.value = [
      initMessage('sid-text'),
      assistantMessage('sid-text', 'one '),
      assistantMessage('sid-text', 'two'),
      resultMessage('sid-text'),
    ];
    const h = run({ prompt: 'go' });
    const chunks: string[] = [];
    for await (const t of h.text()) chunks.push(t);
    expect(chunks).toEqual(['one ', 'two']);
  });

  it('throws when iterated twice', async () => {
    mockQueueRef.value = [initMessage('s'), resultMessage('s')];
    const h = run({ prompt: 'p' });
    for await (const _ of h) {
      // drain
    }
    expect(() => h[Symbol.asyncIterator]()).toThrow('cannot iterate twice');
  });
});
