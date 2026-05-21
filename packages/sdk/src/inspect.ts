import { getSessionInfo, getSessionMessages, listSessions } from '@anthropic-ai/claude-agent-sdk';
import { type DerivedStatus, deriveStats, deriveStatus } from './internal/transcript';

/** On-disk snapshot of a session, computed by reading upstream's JSONL transcript. */
export interface SessionSnapshot {
  sessionId: string;
  exists: boolean;
  /** Last modification time of the transcript file, or null if it doesn't exist. */
  lastActivity: Date | null;
  /** Number of result messages seen so far. */
  numTurns: number;
  /** Sum of cost across result messages in the transcript, or null if none seen. */
  totalCostUsd: number | null;
  /** Most recent model recorded in the transcript. */
  lastModel: string | null;
  /** Sum of input tokens across all assistant turns. */
  inputTokens: number;
  /** Sum of output tokens across all assistant turns. */
  outputTokens: number;
  /** True if the transcript has no terminal stop_reason AND its mtime is fresh. */
  appearsActive: boolean;
  /** "completed" | "active" | "interrupted" | "unknown". See JSDoc on the type. */
  derivedStatus: DerivedStatus;
  /** Working directory the session was created in (best-effort, from upstream). */
  cwd: string | null;
  /** Optional human-readable session title (custom or auto-derived by upstream). */
  summary: string | null;
  /** Human-readable caveat about the heuristic. */
  note: string;
}

export interface InspectOptions {
  /**
   * Working directory the session was created in. Upstream uses this to locate
   * the transcript file. When omitted, upstream searches all project directories.
   */
  cwd?: string;
  /** Liveness heuristic threshold. Default 60_000 ms. */
  staleAfterMs?: number;
}

const NOTE =
  '`appearsActive` is a heuristic based on mtime + the absence of a result message. ' +
  'It does NOT guarantee no other process is writing — pair with your own job registry ' +
  'for authoritative liveness.';

/**
 * Snapshot the state of any session by id, from disk. Pure read-only:
 * never spawns the CLI, never modifies files. Safe to call thousands of
 * times per second from a dashboard / job runner.
 */
export async function inspect(
  sessionId: string,
  opts: InspectOptions = {},
): Promise<SessionSnapshot> {
  const staleAfterMs = opts.staleAfterMs ?? 60_000;
  const infoOpts: { dir?: string } = {};
  if (opts.cwd) infoOpts.dir = opts.cwd;
  const info = await getSessionInfo(sessionId, infoOpts);

  if (!info) {
    return {
      sessionId,
      exists: false,
      lastActivity: null,
      numTurns: 0,
      totalCostUsd: null,
      lastModel: null,
      inputTokens: 0,
      outputTokens: 0,
      appearsActive: false,
      derivedStatus: 'unknown',
      cwd: null,
      summary: null,
      note: NOTE,
    };
  }

  const messages = await getSessionMessages(sessionId, infoOpts);
  const stats = deriveStats(messages);
  const lastActivityMs = info.lastModified;
  const derived = deriveStatus(stats, lastActivityMs, staleAfterMs);
  const appearsActive = derived === 'active';

  return {
    sessionId,
    exists: true,
    lastActivity: new Date(lastActivityMs),
    numTurns: stats.numTurns,
    totalCostUsd: stats.totalCostUsd,
    lastModel: stats.lastModel,
    inputTokens: stats.inputTokens,
    outputTokens: stats.outputTokens,
    appearsActive,
    derivedStatus: derived,
    cwd: info.cwd ?? null,
    summary: info.summary ?? null,
    note: NOTE,
  };
}

/**
 * Snapshot every session in a given cwd (or across all projects when no cwd
 * is supplied). Returns one snapshot per session id, sorted by most recent
 * activity first.
 */
export async function list(opts: InspectOptions = {}): Promise<SessionSnapshot[]> {
  const staleAfterMs = opts.staleAfterMs ?? 60_000;
  const listOpts: { dir?: string } = {};
  if (opts.cwd) listOpts.dir = opts.cwd;
  const sessions = await listSessions(listOpts);

  const snapshots = await Promise.all(
    sessions.map(async (s) => inspect(s.sessionId, { ...opts, staleAfterMs })),
  );
  snapshots.sort((a, b) => (b.lastActivity?.getTime() ?? 0) - (a.lastActivity?.getTime() ?? 0));
  return snapshots;
}
