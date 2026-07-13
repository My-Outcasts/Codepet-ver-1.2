import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` is a Next.js build-time guard with no Node entry point, so importing a
      // server module under test blows up resolution. Stub it to a no-op for the test run — the
      // guard still protects the real bundle; it just doesn't need to run in vitest.
      'server-only': fileURLToPath(new URL('./test-stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    // The rules test needs the Firestore emulator — it runs via `npm run test:rules`
    // (vitest.rules.config.ts), not the default node suite.
    exclude: ['node_modules', '.next', '**/*.rules.test.ts'],
  },
});
