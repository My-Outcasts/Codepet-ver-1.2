import { defineConfig } from 'vitest/config';

// Runs ONLY the Firestore rules tests, against the emulator (see `npm run test:rules`,
// which wraps this in `firebase emulators:exec`). Separate from vitest.config.ts because
// these need a running emulator and a longer timeout than the pure-node unit tests.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['firestore.rules.test.ts'],
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
