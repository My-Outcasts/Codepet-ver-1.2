import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    // The rules test needs the Firestore emulator — it runs via `npm run test:rules`
    // (vitest.rules.config.ts), not the default node suite.
    exclude: ['node_modules', '.next', '**/*.rules.test.ts'],
  },
});
