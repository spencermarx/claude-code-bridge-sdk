import { defineConfig } from 'tsdown';

// ESM-only by design. Upstream `@anthropic-ai/claude-agent-sdk` is ESM-only;
// shipping a CJS facade would only fail at first `require()` of upstream with
// `ERR_REQUIRE_ESM`. Be honest about it instead.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'node18.17',
  external: ['@anthropic-ai/claude-agent-sdk', 'zod'],
});
