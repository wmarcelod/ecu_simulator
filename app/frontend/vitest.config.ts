/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import path from 'path';

// Vitest configuration for the ECU-HybridLab UDS / ISO-TP / bootloader
// test suite. Node environment is sufficient (no DOM access required for
// the transport / UDS / kill-chain unit tests).
//
// To run:
//   npm test               -- single run, all tests
//   npm run test:watch     -- watch mode
//   npm run test:coverage  -- with v8 coverage
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
    testTimeout: 30_000,
    reporters: ['default'],
  },
});
