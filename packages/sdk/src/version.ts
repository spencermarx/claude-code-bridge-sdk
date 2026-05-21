import { createRequire } from 'node:module';

/** Compatible major-version range for `@anthropic-ai/claude-agent-sdk`. */
export const UPSTREAM_COMPAT = '^0.3.0';

let warned = false;

/**
 * Cheap compatibility check. Reads the installed upstream SDK's version and
 * logs a one-time `console.warn` if it sits outside our tested range. Never
 * throws — drift is a warning, not a failure.
 */
export function checkUpstreamCompat(): void {
  if (warned) return;
  try {
    const requireFn = createRequire(import.meta.url);
    const pkg = requireFn('@anthropic-ai/claude-agent-sdk/package.json') as { version?: string };
    const installed = pkg.version ?? 'unknown';
    if (!isInCompatRange(installed)) {
      // biome-ignore lint/suspicious/noConsole: intentional one-time drift notice
      console.warn(
        `[claude-code-bridge-sdk] installed @anthropic-ai/claude-agent-sdk@${installed} is outside the tested range ${UPSTREAM_COMPAT}. The bridge may still work, but file an issue if you hit surprises.`,
      );
    }
    warned = true;
  } catch {
    // Can't read package.json (bundler stripped it, esm interop, etc.) — skip silently.
    // Do NOT set `warned` so a future call can retry if conditions change.
  }
}

function isInCompatRange(version: string): boolean {
  // Trivial semver check matching ^0.3.x. Handles "0.3.146" and "0.3.0-beta".
  const m = /^(\d+)\.(\d+)\./.exec(version);
  if (!m) return true; // unknown shape, don't warn
  const major = Number.parseInt(m[1] ?? '0', 10);
  const minor = Number.parseInt(m[2] ?? '0', 10);
  // ^0.3.x — match major === 0 && minor === 3
  return major === 0 && minor === 3;
}
