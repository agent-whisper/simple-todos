import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['packages/**/*.test.ts', 'apps/api/**/*.test.ts'],
          environment: 'node',
          // Temp-DB setup does real disk I/O in every beforeEach; under parallel
          // workers an unlucky file can otherwise exceed the 10s default.
          hookTimeout: 30000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web',
          include: ['apps/web/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['apps/web/test/setup.ts'],
        },
      },
    ],
  },
});
