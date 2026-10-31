import { defineConfig } from 'vitest/config';

// Run only with a real local Firestore emulator (never production).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/firestore/**/*.test.ts', 'tests/emulator/**/*.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
