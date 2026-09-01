import { beforeAll, afterEach, afterAll } from 'vitest';
import { mkdirSync } from 'node:fs';

// Point the DB at a throwaway in-memory location for unit tests. Must be set
// before any module importing ./config.js is loaded; vitest loads setup files
// before test files.
process.env.FACTORY_DB = ':memory:';
process.env.OMNIROUTE_URL = 'http://127.0.0.1:20128';

import { getDB, closeDB } from '../src/db/database.js';

beforeAll(() => {
  mkdirSync(process.cwd() + '/data', { recursive: true });
  getDB();
});

afterEach(() => {
  // no-op per-test; keep the in-memory DB for the suite duration
});

afterAll(() => {
  closeDB();
});
