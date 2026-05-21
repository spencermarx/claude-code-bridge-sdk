import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit + type tests by default. E2E tests are opt-in via `pnpm test:e2e`
    // (a separate config) and are excluded from the default run.
    include: ['test/unit/**/*.test.ts', 'test/types/**/*.test-d.ts'],
    exclude: ['test/e2e/**', 'node_modules/**', 'dist/**'],
    typecheck: {
      enabled: true,
      include: ['test/types/**/*.test-d.ts'],
      tsconfig: './tsconfig.json',
    },
    environment: 'node',
  },
});
