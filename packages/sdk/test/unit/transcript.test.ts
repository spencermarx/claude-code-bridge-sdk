import { describe, expect, it } from 'vitest';
import { deriveStats, deriveStatus } from '../../src/internal/transcript';

// Helper: shape a SessionMessage-ish record matching the on-disk JSONL.
// The wrapper has type === 'user' | 'assistant' | 'system'; the inner
// `message` is the raw Anthropic API payload.
function userMsg() {
  return {
    type: 'user' as const,
    uuid: 'u',
    session_id: 's',
    parent_tool_use_id: null,
    message: { role: 'user', content: 'hello' },
  };
}

function assistantMsg(opts: {
  stop_reason?: string | null;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}) {
  return {
    type: 'assistant' as const,
    uuid: 'a',
    session_id: 's',
    parent_tool_use_id: null,
    message: {
      role: 'assistant',
      model: opts.model ?? 'claude-haiku-4-5',
      stop_reason: opts.stop_reason ?? null,
      content: [],
      usage: {
        input_tokens: opts.inputTokens ?? 0,
        output_tokens: opts.outputTokens ?? 0,
      },
    },
  };
}

describe('deriveStats', () => {
  it('counts assistant messages with terminal stop_reason as turns', () => {
    const stats = deriveStats([
      userMsg(),
      assistantMsg({
        stop_reason: 'end_turn',
        model: 'claude-haiku-4-5',
        inputTokens: 10,
        outputTokens: 5,
      }),
      userMsg(),
      assistantMsg({
        stop_reason: 'end_turn',
        model: 'claude-sonnet-4-6',
        inputTokens: 20,
        outputTokens: 8,
      }),
    ]);
    expect(stats.numTurns).toBe(2);
    expect(stats.lastModel).toBe('claude-sonnet-4-6');
    expect(stats.inputTokens).toBe(30);
    expect(stats.outputTokens).toBe(13);
    expect(stats.sawTurnEnd).toBe(true);
    expect(stats.sawAnyMessage).toBe(true);
  });

  it('does NOT count tool_use stop_reason as a completed turn', () => {
    const stats = deriveStats([userMsg(), assistantMsg({ stop_reason: 'tool_use' })]);
    expect(stats.numTurns).toBe(0);
    expect(stats.sawTurnEnd).toBe(false);
    expect(stats.sawAnyMessage).toBe(true);
  });

  it('handles a transcript with only user messages', () => {
    const stats = deriveStats([userMsg(), userMsg()]);
    expect(stats.numTurns).toBe(0);
    expect(stats.sawTurnEnd).toBe(false);
    expect(stats.sawAnyMessage).toBe(true);
  });

  it('returns sawAnyMessage:false for an empty transcript', () => {
    const stats = deriveStats([]);
    expect(stats.sawAnyMessage).toBe(false);
  });
});

describe('deriveStatus', () => {
  const now = 1_000_000;
  const base = {
    numTurns: 0,
    totalCostUsd: null,
    lastModel: null,
    inputTokens: 0,
    outputTokens: 0,
    sawTurnEnd: false,
    sawAnyMessage: true,
  };

  it('completed when a turn ended cleanly', () => {
    expect(deriveStatus({ ...base, sawTurnEnd: true, numTurns: 1 }, now - 100, 60_000, now)).toBe(
      'completed',
    );
  });
  it('active when no turn-end and mtime is fresh', () => {
    expect(deriveStatus(base, now - 1000, 60_000, now)).toBe('active');
  });
  it('interrupted when no turn-end and mtime is stale', () => {
    expect(deriveStatus(base, now - 200_000, 60_000, now)).toBe('interrupted');
  });
  it('unknown when no messages at all', () => {
    expect(deriveStatus({ ...base, sawAnyMessage: false }, now - 1000, 60_000, now)).toBe(
      'unknown',
    );
  });
});
