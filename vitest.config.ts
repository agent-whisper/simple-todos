import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/api/**/*.test.ts'],
    environment: 'node',
    // Belt and braces on top of the migrated-template fix in
    // apps/api/test/helpers/tempDb.ts: even cheap per-test setup can be
    // pushed past the 10s default under heavy parallel worker contention.
    hookTimeout: 30000,
  },
});
