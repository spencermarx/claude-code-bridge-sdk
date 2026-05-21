// Bridge-specific types live alongside re-exports of the upstream SDK's
// public surface. Re-exporting (not re-declaring) is intentional: every
// upstream version bump propagates new options/messages here without a diff.

import type {
  CanUseTool,
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  McpServerConfig,
  PermissionMode,
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKPermissionDeniedMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage,
  Options as UpstreamOptions,
} from '@anthropic-ai/claude-agent-sdk';

export type {
  CanUseTool,
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  McpServerConfig,
  PermissionMode,
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKPermissionDeniedMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage,
};

/** Re-exported upstream Options — every CLI flag works as-is. */
export type Options = UpstreamOptions;

/** Final result yielded when a run or turn completes successfully. */
export interface FinalResult {
  sessionId: string;
  /** Concatenated assistant text across all assistant messages in the run/turn. */
  text: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  numTurns: number;
  stopReason: string;
  /** The raw upstream result message — escape hatch for power users. */
  raw: SDKResultMessage;
}

/** Lifecycle state of a long-lived Session. */
export type SessionStatus = 'idle' | 'running' | 'interrupted' | 'killed' | 'done' | 'error';
