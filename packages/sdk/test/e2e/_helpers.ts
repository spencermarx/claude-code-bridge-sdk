import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll } from 'vitest';

/**
 * Per-suite fresh `cwd` directory. Vitest's beforeAll/afterAll handle the
 * lifecycle; tests just call `getCwd()` to read the path.
 */
export function useTempCwd(): () => string {
  let dir: string | undefined;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'aclarify-e2e-'));
  });
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });
  return () => {
    if (!dir) throw new Error('temp cwd not initialized');
    return dir;
  };
}

/** Conservative defaults so e2e tests stay cheap + fast. */
export const e2eBaseOpts = {
  model: 'claude-haiku-4-5',
  maxTurns: 3,
  permissionMode: 'plan' as const,
};

export function withTimeout(ms: number): AbortController {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error(`e2e timeout after ${ms}ms`)), ms);
  ac.signal.addEventListener('abort', () => clearTimeout(t), { once: true });
  return ac;
}
