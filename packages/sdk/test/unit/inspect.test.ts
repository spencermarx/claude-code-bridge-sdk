import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState: {
  info: Map<string, { sessionId: string; summary: string; lastModified: number; cwd?: string }>;
  messages: Map<string, unknown[]>;
} = { info: new Map(), messages: new Map() };

vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  return {
    listSessions: vi.fn(async (_opts?: { dir?: string }) => {
      return Array.from(mockState.info.values());
    }),
    getSessionInfo: vi.fn(async (sessionId: string) => {
      return mockState.info.get(sessionId);
    }),
    getSessionMessages: vi.fn(async (sessionId: string) => {
      return mockState.messages.get(sessionId) ?? [];
    }),
  };
});

import { inspect, list } from '../../src/inspect';

beforeEach(() => {
  mockState.info.clear();
  mockState.messages.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

function assistantMsgRow(sid: string, stopReason: string | null) {
  return {
    type: 'assistant',
    uuid: `a-${sid}`,
    session_id: sid,
    parent_tool_use_id: null,
    message: {
      role: 'assistant',
      model: 'claude-haiku-4-5',
      stop_reason: stopReason,
      usage: { input_tokens: 5, output_tokens: 3 },
    },
  };
}

describe('inspect()', () => {
  it('returns exists:false when no transcript is present', async () => {
    const snap = await inspect('does-not-exist');
    expect(snap.exists).toBe(false);
    expect(snap.derivedStatus).toBe('unknown');
    expect(snap.lastActivity).toBeNull();
  });

  it('returns completed when an assistant turn ended cleanly', async () => {
    const now = Date.now();
    mockState.info.set('sid-1', {
      sessionId: 'sid-1',
      summary: 'first',
      lastModified: now - 1000,
      cwd: '/proj',
    });
    mockState.messages.set('sid-1', [assistantMsgRow('sid-1', 'end_turn')]);
    const snap = await inspect('sid-1');
    expect(snap.exists).toBe(true);
    expect(snap.derivedStatus).toBe('completed');
    expect(snap.numTurns).toBe(1);
    expect(snap.lastModel).toBe('claude-haiku-4-5');
    expect(snap.cwd).toBe('/proj');
    expect(snap.appearsActive).toBe(false);
    expect(snap.inputTokens).toBe(5);
    expect(snap.outputTokens).toBe(3);
  });

  it('returns active when no turn-end and mtime is fresh', async () => {
    const now = Date.now();
    mockState.info.set('sid-2', {
      sessionId: 'sid-2',
      summary: '',
      lastModified: now - 2000,
    });
    mockState.messages.set('sid-2', [assistantMsgRow('sid-2', 'tool_use')]);
    const snap = await inspect('sid-2', { staleAfterMs: 60_000 });
    expect(snap.derivedStatus).toBe('active');
    expect(snap.appearsActive).toBe(true);
  });

  it('returns interrupted when no turn-end and mtime is stale', async () => {
    const now = Date.now();
    mockState.info.set('sid-3', {
      sessionId: 'sid-3',
      summary: '',
      lastModified: now - 5 * 60_000,
    });
    mockState.messages.set('sid-3', [assistantMsgRow('sid-3', null)]);
    const snap = await inspect('sid-3', { staleAfterMs: 60_000 });
    expect(snap.derivedStatus).toBe('interrupted');
  });
});

describe('list()', () => {
  it('returns snapshots sorted by most-recent activity', async () => {
    const now = Date.now();
    mockState.info.set('old', { sessionId: 'old', summary: 'o', lastModified: now - 10_000 });
    mockState.info.set('new', { sessionId: 'new', summary: 'n', lastModified: now - 100 });
    mockState.messages.set('old', []);
    mockState.messages.set('new', []);
    const out = await list();
    expect(out.map((s) => s.sessionId)).toEqual(['new', 'old']);
  });
});
