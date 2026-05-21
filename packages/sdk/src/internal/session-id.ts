import type { SDKMessage } from '../types';

/**
 * Returns the session id when the upstream emits its first `system/init` message,
 * otherwise `undefined`. Upstream guarantees `init` is the first message of every
 * query and always carries `session_id`.
 */
export function extractInitSessionId(message: SDKMessage): string | undefined {
  if (message.type === 'system' && message.subtype === 'init') {
    return message.session_id;
  }
  return undefined;
}
