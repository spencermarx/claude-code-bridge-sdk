import type { HookCallback, HookCallbackMatcher } from '../types';

/**
 * Mirrors the upstream `AskUserQuestionInput.questions` element. Exposed at the
 * bridge boundary so host apps don't have to import from `@anthropic-ai/claude-agent-sdk/sdk-tools`.
 */
export interface AskUserQuestionItem {
  question: string;
  header: string;
  options: Array<{
    label: string;
    description: string;
    preview?: string;
  }>;
  multiSelect: boolean;
}

export interface AskUserRequest {
  questions: AskUserQuestionItem[];
  sessionId: string;
  agentId: string;
  toolUseId: string;
  /** Aborted when the SDK kills the run/session before the host has responded. */
  signal: AbortSignal;
}

export interface AskUserResponse {
  /** Keyed by question text. String for single-select, string[] for multi-select. */
  answers: Record<string, string | string[]>;
  /** Optional per-question notes that mirror upstream `annotations`. */
  annotations?: Record<string, { notes?: string; preview?: string }>;
}

export type AskUserHandler = (req: AskUserRequest) => Promise<AskUserResponse>;

interface SessionContext {
  agentId: string;
  /** Read the session id at hook-fire time (it may not be known when the hook is registered). */
  getSessionId: () => string;
}

/**
 * Build the PreToolUse hook entry that intercepts the AskUserQuestion tool.
 *
 * Mechanism: in headless SDK mode, Claude Code's built-in AskUserQuestion has
 * no TTY to render the picker, and `PostToolUse` does not fire for this
 * special tool. So we intercept at `PreToolUse`:
 *
 *   1. Capture `tool_input.questions`.
 *   2. Call the host's `onAskUser` with the questions.
 *   3. Return `permissionDecision: 'deny'` so the tool never actually runs,
 *      and embed the host's answers in `permissionDecisionReason`. The model
 *      receives the answers as the tool's effective output.
 *
 * If no `onAskUser` is provided, the hook is never registered.
 */
export function buildAskUserHook(
  onAskUser: AskUserHandler,
  ctx: SessionContext,
): HookCallbackMatcher {
  const handler: HookCallback = async (input, toolUseId, options) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const pre = input as typeof input & { tool_name?: string; tool_input?: unknown };
    if (pre.tool_name !== 'AskUserQuestion') return {};

    const toolInput = (pre.tool_input ?? {}) as { questions?: AskUserQuestionItem[] };
    const questions = toolInput.questions ?? [];

    try {
      const response = await onAskUser({
        questions,
        sessionId: ctx.getSessionId(),
        agentId: ctx.agentId,
        toolUseId: toolUseId ?? '',
        signal: options.signal,
      });

      const normalizedAnswers: Record<string, string> = {};
      for (const [key, value] of Object.entries(response.answers)) {
        normalizedAnswers[key] = Array.isArray(value) ? value.join(', ') : value;
      }

      // Embed the answer JSON in the denial reason. The model receives this
      // as the tool_result content and can reason about it directly.
      const payload = {
        intercepted_by: 'claude-code-bridge-sdk',
        answers: normalizedAnswers,
        ...(response.annotations ? { annotations: response.annotations } : {}),
      };

      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse' as const,
          permissionDecision: 'deny' as const,
          permissionDecisionReason: JSON.stringify(payload),
        },
      };
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse' as const,
          permissionDecision: 'deny' as const,
          permissionDecisionReason: JSON.stringify({
            intercepted_by: 'claude-code-bridge-sdk',
            error: `Host onAskUser handler rejected: ${errMessage}`,
          }),
        },
      };
    }
  };

  return {
    matcher: 'AskUserQuestion',
    hooks: [handler],
  };
}
