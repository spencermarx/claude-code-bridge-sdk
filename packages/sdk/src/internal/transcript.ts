import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * Walk a list of session messages and compute the derived fields used in
 * `SessionSnapshot`. Pure / no I/O — upstream's `getSessionMessages` is the
 * single source of truth for reading the JSONL.
 *
 * NOTE: Claude Code persists `user` and `assistant` messages to the on-disk
 * JSONL, but NOT the streamed `result` events. We detect completion via
 * the last assistant message's `stop_reason` — a terminal reason (e.g.
 * `'end_turn'`) means the turn completed naturally. Mid-turn or tool-call
 * stops are not treated as completion.
 */
export interface DerivedStats {
  numTurns: number;
  /** Total cost in USD — null when the transcript doesn't carry it. */
  totalCostUsd: number | null;
  lastModel: string | null;
  inputTokens: number;
  outputTokens: number;
  /** True if the most recent assistant message ended a turn cleanly. */
  sawTurnEnd: boolean;
  /** True if the transcript has at least one assistant or user message. */
  sawAnyMessage: boolean;
}

const TERMINAL_STOP_REASONS = new Set([
  'end_turn',
  'stop_sequence',
  'max_tokens',
  // tool_use is NOT terminal — model expects to be re-invoked with the result.
]);

export function deriveStats(messages: SessionMessage[]): DerivedStats {
  let numTurns = 0;
  let lastModel: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let sawTurnEnd = false;
  let sawAnyMessage = false;

  for (const m of messages) {
    if (m.type === 'assistant' || m.type === 'user') sawAnyMessage = true;
    if (m.type !== 'assistant') continue;

    const inner = m.message as
      | {
          model?: string;
          stop_reason?: string | null;
          usage?: { input_tokens?: number; output_tokens?: number };
        }
      | undefined;
    if (!inner) continue;
    if (typeof inner.model === 'string') lastModel = inner.model;
    if (inner.usage) {
      inputTokens += inner.usage.input_tokens ?? 0;
      outputTokens += inner.usage.output_tokens ?? 0;
    }
    if (inner.stop_reason && TERMINAL_STOP_REASONS.has(inner.stop_reason)) {
      numTurns += 1;
      sawTurnEnd = true;
    }
  }

  return {
    numTurns,
    totalCostUsd: null, // upstream doesn't persist cost to disk
    lastModel,
    inputTokens,
    outputTokens,
    sawTurnEnd,
    sawAnyMessage,
  };
}

export type DerivedStatus = 'completed' | 'active' | 'interrupted' | 'unknown';

export function deriveStatus(
  stats: DerivedStats,
  lastActivityMs: number | null,
  staleAfterMs: number,
  now: number = Date.now(),
): DerivedStatus {
  if (stats.sawTurnEnd) return 'completed';
  if (!stats.sawAnyMessage) return 'unknown';
  if (lastActivityMs == null) return 'unknown';
  const ageMs = now - lastActivityMs;
  return ageMs > staleAfterMs ? 'interrupted' : 'active';
}
