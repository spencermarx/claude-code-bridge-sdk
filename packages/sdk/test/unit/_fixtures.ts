import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKResultMessage,
  SDKSystemMessage,
} from '../../src/types';

/**
 * Test helpers that produce minimal-but-typed mock SDK messages.
 * Only the fields our SDK reads are populated; the rest are typed `any` via casts
 * so we don't have to track every upstream field across versions.
 */

let messageCounter = 0;
const nextUuid = (): string =>
  `00000000-0000-0000-0000-${String(++messageCounter).padStart(12, '0')}`;

export function initMessage(
  sessionId: string,
  opts: Partial<SDKSystemMessage> = {},
): SDKSystemMessage {
  return {
    type: 'system',
    subtype: 'init',
    apiKeySource: 'user',
    claude_code_version: '0.0.0-test',
    cwd: '/tmp',
    tools: [],
    mcp_servers: [],
    model: 'claude-haiku-4-5',
    permissionMode: 'default',
    slash_commands: [],
    output_style: 'default',
    skills: [],
    plugins: [],
    uuid: nextUuid(),
    session_id: sessionId,
    ...opts,
  } as SDKSystemMessage;
}

export function assistantMessage(sessionId: string, text: string): SDKAssistantMessage {
  return {
    type: 'assistant',
    parent_tool_use_id: null,
    uuid: nextUuid(),
    session_id: sessionId,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
    },
  } as unknown as SDKAssistantMessage;
}

export function resultMessage(
  sessionId: string,
  opts: {
    text?: string;
    costUsd?: number;
    inputTokens?: number;
    outputTokens?: number;
    durationMs?: number;
    numTurns?: number;
    stopReason?: string;
  } = {},
): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: opts.durationMs ?? 1000,
    duration_api_ms: opts.durationMs ?? 1000,
    is_error: false,
    num_turns: opts.numTurns ?? 1,
    result: opts.text ?? 'final',
    stop_reason: opts.stopReason ?? 'end_turn',
    total_cost_usd: opts.costUsd ?? 0.001,
    usage: {
      input_tokens: opts.inputTokens ?? 10,
      output_tokens: opts.outputTokens ?? 5,
    },
    modelUsage: {},
    permission_denials: [],
    uuid: nextUuid(),
    session_id: sessionId,
  } as unknown as SDKResultMessage;
}

export function streamTextDelta(sessionId: string, text: string, uuid?: string): SDKMessage {
  return {
    type: 'stream_event',
    parent_tool_use_id: null,
    uuid: uuid ?? nextUuid(),
    session_id: sessionId,
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    },
  } as unknown as SDKMessage;
}

/**
 * Build an async iterable that yields the given messages with optional delays
 * (in ms) between them. Useful for testing that sessionId resolves *before* result.
 */
export function asyncSource(
  messages: SDKMessage[],
  opts: { delayMs?: number; throwAfter?: number } = {},
): AsyncIterable<SDKMessage> {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<SDKMessage, void, void> {
      for (let i = 0; i < messages.length; i++) {
        if (opts.throwAfter !== undefined && i === opts.throwAfter) {
          throw new Error('mock source threw');
        }
        if (opts.delayMs) {
          await new Promise((r) => setTimeout(r, opts.delayMs));
        }
        const m = messages[i];
        if (m !== undefined) yield m;
      }
    },
  };
}
