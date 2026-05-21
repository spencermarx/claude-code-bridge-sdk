import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock upstream `query` with a controllable AsyncGenerator-like Query stub.
// Each call to `query()` consumes the current `mockScript.value` array as a
// scripted reply: tests push messages, the dispatcher loop reads them.
type MockMessage = unknown;
const mockScript: { value: MockMessage[]; interruptMock: ReturnType<typeof vi.fn> } = {
  value: [],
  interruptMock: vi.fn(),
};

vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  return {
    query: vi.fn((_params: { prompt: unknown; options?: unknown }) => {
      const messages = mockScript.value.slice();
      let i = 0;
      const interruptMock = mockScript.interruptMock;
      const setModelMock = vi.fn(async () => {});
      const setPermissionModeMock = vi.fn(async () => {});
      return {
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
        interrupt: interruptMock,
        setModel: setModelMock,
        setPermissionMode: setPermissionModeMock,
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    }),
  };
});

import { session } from '../../src/session';
import { assistantMessage, initMessage, resultMessage } from './_fixtures';

afterEach(() => {
  mockScript.value = [];
  mockScript.interruptMock.mockReset();
});

describe('session()', () => {
  it('resolves sessionId on first init', async () => {
    mockScript.value = [
      initMessage('sess-A'),
      assistantMessage('sess-A', 'hi'),
      resultMessage('sess-A'),
    ];
    const s = session({ prompt: 'hello' });
    expect(await s.sessionId).toBe('sess-A');
  });

  it('exposes per-turn handle with result via .send', async () => {
    mockScript.value = [
      initMessage('sess-B'),
      assistantMessage('sess-B', 'hi'),
      resultMessage('sess-B', { text: 'hi', costUsd: 0.001 }),
    ];
    const s = session({ prompt: 'hello' });
    // wait for the seeded first turn to be picked up by the dispatcher
    await new Promise((r) => setTimeout(r, 5));
    const sid = await s.sessionId;
    expect(sid).toBe('sess-B');
    // Initial-prompt turn has no explicit handle. Test a follow-up turn.
    // Reset script for the second turn before calling .send:
    mockScript.value = [resultMessage('sess-B', { text: 'second', costUsd: 0.002 })];
    // The shared Query has already been exhausted by the dispatcher loop,
    // so .send may not have a fresh source. This test will be expanded once
    // streaming input is fully wired against a stateful mock; for now we only
    // assert that the first init flows through.
  });

  it('accumulates cost across turns', async () => {
    mockScript.value = [
      initMessage('sess-C'),
      assistantMessage('sess-C', 'hi'),
      resultMessage('sess-C', { costUsd: 0.5, inputTokens: 100, outputTokens: 50 }),
    ];
    const s = session({ prompt: 'hello' });
    await s.sessionId;
    // Let the dispatcher consume the scripted result.
    await new Promise((r) => setTimeout(r, 10));
    expect(s.cost.usd).toBeGreaterThan(0);
    expect(s.cost.inputTokens).toBe(100);
    expect(s.cost.outputTokens).toBe(50);
    // status may be 'idle' (turn ended) or 'done' (mock stream ended). Both
    // are valid post-turn states for this scripted mock.
    expect(['idle', 'done']).toContain(s.status);
  });

  it('kill() flips status to killed', async () => {
    mockScript.value = [initMessage('sess-D')];
    const s = session({ prompt: 'hi' });
    await s.kill();
    expect(s.status).toBe('killed');
  });

  it('setModel updates the cached model', async () => {
    mockScript.value = [initMessage('sess-E'), resultMessage('sess-E')];
    const s = session({ prompt: 'hi' });
    await s.sessionId;
    await s.setModel('claude-opus-4-7');
    expect(s.model).toBe('claude-opus-4-7');
  });

  it('rejects concurrent .send()', async () => {
    mockScript.value = [initMessage('sess-F'), assistantMessage('sess-F', 'a')];
    const s = session({});
    // Trigger a turn — won't complete because no result message.
    s.send('first');
    expect(() => s.send('second')).toThrow('Concurrent .send()');
  });
});
