import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

import { audioDefines } from './scripts/audioAssets';
import { buildDefines } from './scripts/buildDefines';

export default defineConfig({
  // Same source as the bundle: a test that guards build identity — or which
  // audio files exist — must see what the bundle would get, not a separately
  // computed answer.
  define: { ...buildDefines(), ...audioDefines() },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'tests/unit/**/*.test.{ts,tsx}',
      // The backend suite runs here too, so `vitest run` is still the one
      // command that says whether the repository is healthy. `test:backend`
      // and `test:integration` are filtered views of the same config.
      'tests/backend/**/*.test.ts',
    ],
    // The load suite drives a real listening server; the default 5 s per test
    // is too tight for a 50-command batch measured over many iterations.
    testTimeout: 30_000,
  },
});
