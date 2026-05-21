import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    globalSetup: ['./test/e2e/_setup.ts'],
    testTimeout: 90_000,
    hookTimeout: 30_000,
    environment: 'node',
    // E2E tests spawn real `claude` processes — keep them serial to avoid
    // overwhelming the API and to make logs readable.
    fileParallelism: false,
    pool: 'forks',
  },
});
