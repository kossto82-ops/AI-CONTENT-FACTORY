import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // Env is injected BEFORE any module (incl. config.ts) evaluates, so the
    // test DB is really in-memory and NEVER the dev ./data/factory.db that
    // `dotenv/config` would otherwise load.
    env: {
      FACTORY_DB: ':memory:',
      OMNIROUTE_URL: 'http://127.0.0.1:20128',
    },
  },
});
