/**
 * Typed errors emitted by the bridge SDK. Every error has a stable string
 * `code` so consumers can switch on it without instanceof brittleness across
 * bundler boundaries.
 */
export class ClaudeError extends Error {
  readonly code: string;
  readonly sessionId?: string;
  readonly agentId?: string;
  override readonly cause?: unknown;

  constructor(
    message: string,
    opts: { code?: string; sessionId?: string; agentId?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.code = opts.code ?? 'CLAUDE_ERROR';
    if (opts.sessionId !== undefined) this.sessionId = opts.sessionId;
    if (opts.agentId !== undefined) this.agentId = opts.agentId;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

export class SessionNotFoundError extends ClaudeError {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`, { code: 'SESSION_NOT_FOUND', sessionId });
  }
}

export class PermissionDeniedError extends ClaudeError {
  readonly tool: string;
  constructor(tool: string, reason?: string) {
    super(`Tool '${tool}' was denied: ${reason ?? 'no reason'}`, { code: 'PERMISSION_DENIED' });
    this.tool = tool;
  }
}

export class MaxTurnsExceededError extends ClaudeError {
  constructor() {
    super('Maximum turns exceeded', { code: 'MAX_TURNS_EXCEEDED' });
  }
}

export class BudgetExceededError extends ClaudeError {
  readonly costUsd: number;
  readonly limitUsd: number;
  constructor(costUsd: number, limitUsd: number) {
    super(`Budget exceeded: $${costUsd.toFixed(4)} > $${limitUsd.toFixed(4)}`, {
      code: 'BUDGET_EXCEEDED',
    });
    this.costUsd = costUsd;
    this.limitUsd = limitUsd;
  }
}

export class InterruptedError extends ClaudeError {
  constructor() {
    super('Operation was interrupted', { code: 'INTERRUPTED' });
  }
}

export class KilledError extends ClaudeError {
  constructor() {
    super('Operation was killed', { code: 'KILLED' });
  }
}

export class CLIError extends ClaudeError {
  readonly exitCode: number | undefined;
  readonly stderr: string | undefined;
  constructor(message: string, opts: { exitCode?: number; stderr?: string; cause?: unknown } = {}) {
    super(message, {
      code: 'CLI_ERROR',
      ...(opts.cause !== undefined ? { cause: opts.cause } : {}),
    });
    if (opts.exitCode !== undefined) this.exitCode = opts.exitCode;
    if (opts.stderr !== undefined) this.stderr = opts.stderr;
  }
}

export class TimeoutError extends ClaudeError {
  constructor(message: string) {
    super(message, { code: 'TIMEOUT' });
  }
}
