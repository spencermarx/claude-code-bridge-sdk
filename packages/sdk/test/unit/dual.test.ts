import { describe, expect, it } from 'vitest';
import { DualHandle } from '../../src/internal/dual';
import type { SDKMessage } from '../../src/types';
import {
  assistantMessage,
  asyncSource,
  initMessage,
  resultMessage,
  streamTextDelta,
} from './_fixtures';

function makeHandle(messages: SDKMessage[], opts?: { delayMs?: number; throwAfter?: number }) {
  const ac = new AbortController();
  return new DualHandle(asyncSource(messages, opts), { abortController: ac });
}

describe('DualHandle', () => {
  describe('sessionId', () => {
    it('resolves on the init message', async () => {
      const h = makeHandle([
        initMessage('sess-1'),
        assistantMessage('sess-1', 'hi'),
        resultMessage('sess-1'),
      ]);
      expect(await h.sessionId).toBe('sess-1');
    });

    it('resolves before the result promise', async () => {
      const h = makeHandle(
        [initMessage('sess-2'), assistantMessage('sess-2', 'hi'), resultMessage('sess-2')],
        { delayMs: 5 },
      );
      const order: string[] = [];
      h.sessionId.then(() => order.push('sessionId'));
      h.result.then(() => order.push('result'));
      await h.result;
      expect(order).toEqual(['sessionId', 'result']);
    });

    it('rejects if the source ends with no init', async () => {
      const h = makeHandle([assistantMessage('x', 'hi')]);
      await expect(h.sessionId).rejects.toThrow();
    });

    it('rejects if the source throws before init', async () => {
      const h = makeHandle([initMessage('s'), resultMessage('s')], { throwAfter: 0 });
      await expect(h.sessionId).rejects.toThrow('mock source threw');
    });
  });

  describe('await handle → FinalResult', () => {
    it('resolves with the final result', async () => {
      const h = makeHandle([
        initMessage('sess-3'),
        assistantMessage('sess-3', 'hello world'),
        resultMessage('sess-3', {
          text: 'hello world',
          costUsd: 0.005,
          inputTokens: 42,
          outputTokens: 13,
          durationMs: 1234,
          numTurns: 1,
          stopReason: 'end_turn',
        }),
      ]);
      const r = await h;
      expect(r.sessionId).toBe('sess-3');
      expect(r.text).toBe('hello world');
      expect(r.costUsd).toBe(0.005);
      expect(r.inputTokens).toBe(42);
      expect(r.outputTokens).toBe(13);
      expect(r.durationMs).toBe(1234);
      expect(r.numTurns).toBe(1);
      expect(r.stopReason).toBe('end_turn');
      expect(r.raw.type).toBe('result');
    });

    it('rejects when the upstream throws', async () => {
      const h = makeHandle(
        [initMessage('sess-x'), assistantMessage('sess-x', 'hi'), resultMessage('sess-x')],
        { throwAfter: 1 },
      );
      await expect(h.result).rejects.toThrow('mock source threw');
    });

    it('rejects when stream ends without a result message', async () => {
      const h = makeHandle([initMessage('sess-y'), assistantMessage('sess-y', 'hi')]);
      await expect(h.result).rejects.toThrow();
    });
  });

  describe('AsyncIterable<SDKMessage>', () => {
    it('yields every message in order', async () => {
      const h = makeHandle([
        initMessage('sess-i'),
        assistantMessage('sess-i', 'one'),
        assistantMessage('sess-i', 'two'),
        resultMessage('sess-i'),
      ]);
      const types: string[] = [];
      for await (const m of h) types.push(m.type);
      expect(types).toEqual(['system', 'assistant', 'assistant', 'result']);
    });

    it('throws when iterated twice', async () => {
      const h = makeHandle([initMessage('s'), resultMessage('s')]);
      // first iteration consumed
      for await (const _ of h) {
        // drain
      }
      expect(() => h[Symbol.asyncIterator]()).toThrow('cannot iterate twice');
    });

    it('iteration finishes and then await resolves with FinalResult', async () => {
      const h = makeHandle([
        initMessage('sess-j'),
        assistantMessage('sess-j', 'hi'),
        resultMessage('sess-j', { text: 'hi' }),
      ]);
      const collected: string[] = [];
      for await (const m of h) collected.push(m.type);
      const r = await h;
      expect(r.text).toBe('hi');
      expect(collected.at(-1)).toBe('result');
    });
  });

  describe('text()', () => {
    it('emits text from each assistant message when no partials present', async () => {
      const h = makeHandle([
        initMessage('s'),
        assistantMessage('s', 'Hello, '),
        assistantMessage('s', 'world!'),
        resultMessage('s'),
      ]);
      const chunks: string[] = [];
      for await (const t of h.text()) chunks.push(t);
      expect(chunks).toEqual(['Hello, ', 'world!']);
    });

    it('emits text from stream_event deltas when present', async () => {
      const h = makeHandle([
        initMessage('s'),
        streamTextDelta('s', 'Hel'),
        streamTextDelta('s', 'lo'),
        resultMessage('s'),
      ]);
      const chunks: string[] = [];
      for await (const t of h.text()) chunks.push(t);
      expect(chunks).toEqual(['Hel', 'lo']);
    });

    it('suppresses the assistant message when partial deltas covered the same turn', async () => {
      // text deltas share a uuid that's then echoed on the completed assistant
      // message. Our deduper should drop the assistant chunk so we don't double-emit.
      const sharedUuid = '00000000-0000-0000-0000-deadbeefdead';
      const h = makeHandle([
        initMessage('s'),
        streamTextDelta('s', 'Hel', sharedUuid),
        streamTextDelta('s', 'lo', sharedUuid),
        // assistant message echoes the same uuid (matches our fixtures pattern)
        {
          type: 'assistant',
          parent_tool_use_id: null,
          uuid: sharedUuid,
          session_id: 's',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
        } as unknown as import('../../src/types').SDKMessage,
        resultMessage('s'),
      ]);
      const chunks: string[] = [];
      for await (const t of h.text()) chunks.push(t);
      expect(chunks).toEqual(['Hel', 'lo']);
    });
  });

  describe('kill / abort', () => {
    it('signals abort and rejects in-flight result', async () => {
      const h = makeHandle([initMessage('s'), assistantMessage('s', 'hi')], { delayMs: 100 });
      const killP = h.kill();
      expect(h.signal.aborted).toBe(true);
      await killP; // should not throw
      await expect(h.result).rejects.toThrow();
    });
  });
});
