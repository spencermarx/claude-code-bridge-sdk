import { spawnSync } from 'node:child_process';

/**
 * Vitest globalSetup. Verifies the local environment can run e2e tests:
 *   - `claude --version` resolves on PATH
 *   - either ANTHROPIC_API_KEY is set OR `claude auth status` reports logged-in
 *
 * If either prerequisite is missing, throws a single actionable error so the
 * suite aborts before producing N confusing per-test failures.
 */
export default async function setup(): Promise<void> {
  // 1) `claude --version`
  const ver = spawnSync('claude', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
  if (ver.error || ver.status !== 0) {
    throw new Error(
      'E2E preflight: `claude` CLI not found on PATH.\n' +
        '\n' +
        'Install Claude Code globally (e.g. `npm install -g @anthropic-ai/claude-code`)\n' +
        'and ensure `claude --version` resolves, then re-run `pnpm test:e2e`.',
    );
  }

  // 2) auth
  if (!process.env.ANTHROPIC_API_KEY) {
    const status = spawnSync('claude', ['auth', 'status'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (status.status !== 0) {
      throw new Error(
        'E2E preflight: no `ANTHROPIC_API_KEY` env var and `claude auth status` is not logged in.\n' +
          '\n' +
          'Export ANTHROPIC_API_KEY or run `claude auth login` before `pnpm test:e2e`.',
      );
    }
  }
}
