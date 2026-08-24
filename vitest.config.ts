import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // Integration tests share one Postgres schema, so they must not interleave.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/setup/global-setup.ts'],
    reporters: ['default'],
  },
  resolve: {
    alias: {
      '@govflow/contracts': path.resolve(__dirname, 'packages/contracts/src/index.ts'),
      '@govflow/connector-sdk': path.resolve(__dirname, 'packages/connector-sdk/src/index.ts'),
      '@govflow/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
    },
  },
});
