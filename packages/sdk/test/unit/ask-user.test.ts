import { describe, expect, it, vi } from 'vitest';
import { type AskUserHandler, buildAskUserHook } from '../../src/internal/ask-user';
import type { HookCallback } from '../../src/types';

describe('buildAskUserHook', () => {
  it('returns a matcher pinned to AskUserQuestion', () => {
    const onAskUser: AskUserHandler = vi.fn(async () => ({ answers: {} }));
    const matcher = buildAskUserHook(onAskUser, {
      agentId: 'agent-1',
      getSessionId: () => 'sess-1',
    });
    expect(matcher.matcher).toBe('AskUserQuestion');
    expect(matcher.hooks).toHaveLength(1);
  });

  it('does nothing when the hook fires for the wrong event', async () => {
    const onAskUser: AskUserHandler = vi.fn(async () => ({ answers: {} }));
    const matcher = buildAskUserHook(onAskUser, {
      agentId: 'agent-1',
      getSessionId: () => 'sess-1',
    });
    const hook = matcher.hooks[0] as HookCallback;
    const result = await hook({ hook_event_name: 'PostToolUse' } as never, 'tool-use-1', {
      signal: new AbortController().signal,
    });
    expect(result).toEqual({});
    expect(onAskUser).not.toHaveBeenCalled();
  });

  it('does nothing for non-AskUserQuestion tools', async () => {
    const onAskUser: AskUserHandler = vi.fn(async () => ({ answers: {} }));
    const matcher = buildAskUserHook(onAskUser, {
      agentId: 'agent-1',
      getSessionId: () => 'sess-1',
    });
    const hook = matcher.hooks[0] as HookCallback;
    const result = await hook(
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } } as never,
      'tool-use-2',
      { signal: new AbortController().signal },
    );
    expect(result).toEqual({});
    expect(onAskUser).not.toHaveBeenCalled();
  });

  it('calls onAskUser and returns a deny decision carrying the answers JSON', async () => {
    const onAskUser: AskUserHandler = vi.fn(async () => ({ answers: { 'What color?': 'blue' } }));
    const matcher = buildAskUserHook(onAskUser, {
      agentId: 'agent-1',
      getSessionId: () => 'sess-1',
    });
    const hook = matcher.hooks[0] as HookCallback;
    const result = await hook(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'AskUserQuestion',
        tool_input: {
          questions: [
            {
              question: 'What color?',
              header: 'Color',
              options: [
                { label: 'blue', description: 'sky' },
                { label: 'red', description: 'fire' },
              ],
              multiSelect: false,
            },
          ],
        },
      } as never,
      'tool-use-3',
      { signal: new AbortController().signal },
    );

    expect(onAskUser).toHaveBeenCalledOnce();
    const out = result as {
      hookSpecificOutput?: {
        hookEventName?: string;
        permissionDecision?: string;
        permissionDecisionReason?: string;
      };
    };
    expect(out.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
    expect(out.hookSpecificOutput?.permissionDecision).toBe('deny');
    const reason = out.hookSpecificOutput?.permissionDecisionReason ?? '';
    const parsed = JSON.parse(reason) as { answers: Record<string, string> };
    expect(parsed.answers['What color?']).toBe('blue');
  });

  it('joins multi-select answers with comma when the host returns an array', async () => {
    const onAskUser: AskUserHandler = vi.fn(async () => ({
      answers: { 'Pick features?': ['auth', 'billing'] },
    }));
    const matcher = buildAskUserHook(onAskUser, {
      agentId: 'agent-1',
      getSessionId: () => 'sess-1',
    });
    const hook = matcher.hooks[0] as HookCallback;
    const result = await hook(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'AskUserQuestion',
        tool_input: {
          questions: [
            { question: 'Pick features?', header: 'Features', options: [], multiSelect: true },
          ],
        },
      } as never,
      'tool-use-4',
      { signal: new AbortController().signal },
    );
    const out = result as {
      hookSpecificOutput?: { permissionDecisionReason?: string };
    };
    const parsed = JSON.parse(out.hookSpecificOutput?.permissionDecisionReason ?? '{}') as {
      answers: Record<string, string>;
    };
    expect(parsed.answers['Pick features?']).toBe('auth, billing');
  });

  it('surfaces an error payload when the host rejects', async () => {
    const onAskUser: AskUserHandler = vi.fn(async () => {
      throw new Error('boom');
    });
    const matcher = buildAskUserHook(onAskUser, {
      agentId: 'agent-1',
      getSessionId: () => 'sess-1',
    });
    const hook = matcher.hooks[0] as HookCallback;
    const result = await hook(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'AskUserQuestion',
        tool_input: { questions: [] },
      } as never,
      'tool-use-5',
      { signal: new AbortController().signal },
    );
    const out = result as {
      hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
    };
    expect(out.hookSpecificOutput?.permissionDecision).toBe('deny');
    const parsed = JSON.parse(out.hookSpecificOutput?.permissionDecisionReason ?? '{}') as {
      error?: string;
    };
    expect(parsed.error).toMatch(/boom/);
  });
});
