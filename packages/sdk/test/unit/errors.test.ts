import { describe, expect, it } from 'vitest';
import {
  BudgetExceededError,
  CLIError,
  ClaudeError,
  InterruptedError,
  KilledError,
  MaxTurnsExceededError,
  PermissionDeniedError,
  SessionNotFoundError,
  TimeoutError,
} from '../../src/errors';

describe('error hierarchy', () => {
  it('every typed error extends ClaudeError', () => {
    const errs: ClaudeError[] = [
      new SessionNotFoundError('abc'),
      new PermissionDeniedError('Bash', 'reason'),
      new MaxTurnsExceededError(),
      new BudgetExceededError(1, 0.5),
      new InterruptedError(),
      new KilledError(),
      new CLIError('boom'),
      new TimeoutError('took too long'),
    ];
    for (const e of errs) {
      expect(e).toBeInstanceOf(ClaudeError);
      expect(typeof e.code).toBe('string');
      expect(e.code.length).toBeGreaterThan(0);
    }
  });

  it('codes are stable strings', () => {
    expect(new SessionNotFoundError('a').code).toBe('SESSION_NOT_FOUND');
    expect(new PermissionDeniedError('Bash').code).toBe('PERMISSION_DENIED');
    expect(new MaxTurnsExceededError().code).toBe('MAX_TURNS_EXCEEDED');
    expect(new BudgetExceededError(1, 0.5).code).toBe('BUDGET_EXCEEDED');
    expect(new InterruptedError().code).toBe('INTERRUPTED');
    expect(new KilledError().code).toBe('KILLED');
    expect(new CLIError('x').code).toBe('CLI_ERROR');
    expect(new TimeoutError('x').code).toBe('TIMEOUT');
  });

  it('BudgetExceededError carries the offending numbers', () => {
    const e = new BudgetExceededError(2.5, 1.0);
    expect(e.costUsd).toBe(2.5);
    expect(e.limitUsd).toBe(1.0);
  });

  it('PermissionDeniedError carries the tool name', () => {
    const e = new PermissionDeniedError('Bash(rm *)', 'too dangerous');
    expect(e.tool).toBe('Bash(rm *)');
    expect(e.message).toMatch(/Bash/);
  });
});
