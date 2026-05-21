import { inspect, list } from './inspect';
import { pool } from './pool';
import { run } from './run';
import { session } from './session';

/**
 * Convenience namespace bundling the SDK's top-level entrypoints. Tree-shaking
 * users can prefer named imports (`import { run } from 'claude-code-bridge-sdk'`);
 * everyone else benefits from the discoverable, dotted form.
 */
export const claude = {
  run,
  session,
  pool,
  inspect,
  list,
} as const;
