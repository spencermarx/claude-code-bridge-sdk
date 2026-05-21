// @aclarify/claude-code-sdk
//
// Public barrel. Everything exported from this file is part of the public API.

export { claude } from './claude';
export {
  BudgetExceededError,
  CLIError,
  ClaudeError,
  InterruptedError,
  KilledError,
  MaxTurnsExceededError,
  PermissionDeniedError,
  SessionNotFoundError,
  TimeoutError,
} from './errors';
export { run } from './run';
export type { RunHandle, RunOptions } from './run';
export { session } from './session';
export type { Session, SessionOptions } from './session';
export { pool } from './pool';
export type { Pool, PoolEvent, PoolOptions } from './pool';
export { inspect, list } from './inspect';
export type { InspectOptions, SessionSnapshot } from './inspect';

export type {
  AskUserHandler,
  AskUserQuestionItem,
  AskUserRequest,
  AskUserResponse,
} from './internal/ask-user';
export type { ModelInfo, SlashCommand } from './internal/commands';

export type {
  FinalResult,
  Options,
  SessionStatus,
  // upstream passthroughs
  CanUseTool,
  HookCallback,
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
} from './types';

// Re-export upstream MCP tool-authoring helpers verbatim.
export { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';

export const version = '0.1.0';
