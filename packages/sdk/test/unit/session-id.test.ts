import { describe, expect, it } from 'vitest';
import { extractInitSessionId } from '../../src/internal/session-id';
import { assistantMessage, initMessage, resultMessage } from './_fixtures';

describe('extractInitSessionId', () => {
  it('returns the session id for system/init messages', () => {
    expect(extractInitSessionId(initMessage('abc-123'))).toBe('abc-123');
  });

  it('returns undefined for assistant messages', () => {
    expect(extractInitSessionId(assistantMessage('abc-123', 'hi'))).toBeUndefined();
  });

  it('returns undefined for result messages', () => {
    expect(extractInitSessionId(resultMessage('abc-123'))).toBeUndefined();
  });
});
