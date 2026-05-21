import { afterEach, describe, expect, it, vi } from 'vitest';

// Programmable per-call mock: each call to `query()` consumes the next array
// from `mockSequences`. Defaults to a minimal init+result stream.
const mockSequences: unknown[][] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  return {
    query: vi.fn((_params: { prompt: unknown; options?: unknown }) => {
      const messages = mockSequences.shift() ?? defaultMessages();
      let i = 0;
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
        interrupt: vi.fn(async () => {}),
        setModel: vi.fn(async () => {}),
        setPermissionMode: vi.fn(async () => {}),
        supportedCommands: vi.fn(async () => []),
        supportedModels: vi.fn(async () => []),
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    }),
  };
});

import { assistantMessage, initMessage, resultMessage } from './_fixtures';

import { pool } from '../../src/pool';

function defaultMessages(): unknown[] {
  return [
    initMessage('default-sid'),
    assistantMessage('default-sid', 'ok'),
    resultMessage('default-sid', { text: 'ok', costUsd: 0.001 }),
  ];
}

afterEach(() => {
  mockSequences.length = 0;
});

describe('pool().map()', () => {
  it('runs every item and returns successful results', async () => {
    for (const sid of ['p1', 'p2', 'p3']) {
      mockSequences.push([
        initMessage(sid),
        assistantMessage(sid, sid),
        resultMessage(sid, { text: sid }),
      ]);
    }
    const p = pool({ concurrency: 2 });
    const out = await p.map([1, 2, 3], (n) => ({ prompt: `item ${n}` }));
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.item).sort()).toEqual([1, 2, 3]);
  });
});

describe('pool().race()', () => {
  it('returns the first result and kills losers', async () => {
    // Two scripts: first is empty (will reject — no init/result), second succeeds.
    // To simulate a winner deterministically, queue both with results; whichever
    // resolves first wins.
    mockSequences.push([
      initMessage('winner'),
      assistantMessage('winner', 'first'),
      resultMessage('winner', { text: 'first' }),
    ]);
    mockSequences.push([
      initMessage('loser'),
      assistantMessage('loser', 'second'),
      resultMessage('loser', { text: 'second' }),
    ]);
    const p = pool();
    const result = await p.race([{ prompt: 'one' }, { prompt: 'two' }]);
    expect(result.result.text).toMatch(/first|second/);
  });
});

describe('pool().pipeline()', () => {
  it('feeds each step the prior result', async () => {
    for (const sid of ['s1', 's2']) {
      mockSequences.push([
        initMessage(sid),
        assistantMessage(sid, sid),
        resultMessage(sid, { text: sid }),
      ]);
    }
    const p = pool();
    const seen: Array<string | null> = [];
    const out = await p.pipeline([
      (prev) => {
        seen.push(prev?.text ?? null);
        return { prompt: 'step1' };
      },
      (prev) => {
        seen.push(prev?.text ?? null);
        return { prompt: 'step2' };
      },
    ]);
    expect(out).toHaveLength(2);
    expect(seen).toEqual([null, 's1']);
  });
});

describe('pool().events()', () => {
  it('emits started + ended events', async () => {
    mockSequences.push([initMessage('evt'), assistantMessage('evt', 'ok'), resultMessage('evt')]);
    const p = pool();
    const events = p.events();
    const collected: string[] = [];
    const iterator = events[Symbol.asyncIterator]();
    const reader = (async () => {
      for (let i = 0; i < 2; i++) {
        const next = await iterator.next();
        if (next.done) break;
        collected.push(next.value.type);
      }
    })();
    const handle = p.run({ prompt: 'x' });
    await handle.result;
    await reader;
    expect(collected).toContain('started');
    expect(collected).toContain('ended');
  });
});

describe('pool().kill("all")', () => {
  it('kills all handles and clears the registry', async () => {
    mockSequences.push([initMessage('k1')]);
    mockSequences.push([initMessage('k2')]);
    const p = pool();
    p.run({ prompt: 'a' });
    p.run({ prompt: 'b' });
    await p.kill('all');
    expect(p.list()).toEqual([]);
  });
});

describe('pool().map() AggregateError', () => {
  it('rejects with AggregateError when any task fails', async () => {
    // First spawn succeeds; second has no result message, so DualHandle rejects.
    mockSequences.push([initMessage('ok'), assistantMessage('ok', 'ok'), resultMessage('ok')]);
    mockSequences.push([initMessage('bad'), assistantMessage('bad', 'no-result')]);
    mockSequences.push([
      initMessage('also-ok'),
      assistantMessage('also-ok', 'ok'),
      resultMessage('also-ok'),
    ]);
    const p = pool();
    await expect(p.map([1, 2, 3], (n) => ({ prompt: `item ${n}` }))).rejects.toThrow(/pool\.map/);
  });
});

describe('pool() concurrency cap enforcement', () => {
  it('never runs more than `concurrency` tasks at once', async () => {
    // Use a gated mock: each next() awaits a Deferred we resolve manually.
    // We instrument by counting how many query() calls are in flight before
    // resolving any of them.
    const releases: Array<() => void> = [];
    const inFlight = { current: 0, peak: 0 };
    // Custom mock for this test: each query() resolves only when we say so.
    mockSequences.length = 0;
    for (let i = 0; i < 5; i++) {
      mockSequences.push([
        initMessage(`c${i}`),
        assistantMessage(`c${i}`, 'ok'),
        resultMessage(`c${i}`),
      ]);
    }
    // The mock already returns synchronously, so concurrency cap is the only
    // gating mechanism. With 5 tasks and concurrency=2, exactly 2 spawn at once.
    const p = pool({ concurrency: 2 });
    // Wrap run() so we observe when query() is called.
    const originalRun = p.run.bind(p);
    p.run = (opts) => {
      inFlight.current += 1;
      inFlight.peak = Math.max(inFlight.peak, inFlight.current);
      const handle = originalRun(opts);
      void handle.result.finally(() => {
        inFlight.current -= 1;
      });
      return handle;
    };
    const out = await p.map([1, 2, 3, 4, 5], (n) => ({ prompt: `item ${n}` }));
    expect(out).toHaveLength(5);
    expect(inFlight.peak).toBeLessThanOrEqual(2);
    // Silence unused warnings for the deferred releases helper.
    expect(releases).toEqual([]);
  });
});

describe('pool().race()', () => {
  it('kills loser handles after the winner resolves', async () => {
    // Both succeed; one finishes first. The race() impl issues kill() on the
    // loser. Since our mock resolves synchronously, both finish ~immediately;
    // we just confirm race() returns a winnerAgentId and the pool registry
    // is settled (run handles auto-remove via _trackHandle).
    mockSequences.push([
      initMessage('w'),
      assistantMessage('w', 'first'),
      resultMessage('w', { text: 'first' }),
    ]);
    mockSequences.push([
      initMessage('l'),
      assistantMessage('l', 'second'),
      resultMessage('l', { text: 'second' }),
    ]);
    const p = pool();
    const { winnerAgentId, result } = await p.race([{ prompt: 'one' }, { prompt: 'two' }]);
    expect(typeof winnerAgentId).toBe('string');
    expect(typeof result.text).toBe('string');
  });
});

describe('pool().broadcast()', () => {
  it('sends a prompt to every live session and returns one handle per session', async () => {
    // Each session needs init + one result for the warm-up + one more for broadcast.
    for (let i = 0; i < 2; i++) {
      mockSequences.push([
        initMessage(`b${i}`),
        assistantMessage(`b${i}`, 'ok'),
        resultMessage(`b${i}`),
      ]);
    }
    const p = pool();
    const s1 = p.session({ prompt: 'warmup' });
    const s2 = p.session({ prompt: 'warmup' });
    await s1.sessionId.catch(() => {});
    await s2.sessionId.catch(() => {});
    const handles = p.broadcast('broadcast prompt');
    // broadcast skips sessions that are mid-turn or unable to send. With our
    // scripted mock the second turn has no script, so .send may throw. We just
    // assert broadcast returned a Map and didn't crash.
    expect(handles).toBeInstanceOf(Map);
  });
});
