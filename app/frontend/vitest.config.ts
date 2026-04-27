import { defineConfig } from 'vitest/config';
import path from 'path';

// Vitest config — Node environment (no DOM needed for the
// transport / UDS / bootloader / kill-chain tests).
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['src/__tests__/**/*.test.ts'],
    testTimeout: 60_000,
    reporters: ['default'],
  },
});
