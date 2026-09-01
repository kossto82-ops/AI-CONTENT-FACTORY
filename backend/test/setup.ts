import { beforeAll, afterAll } from 'vitest';
import { mkdirSync } from 'node:fs';

// The test DB is pinned to ':memory:' and the OmniRoute URL is pinned here via
// vitest.config `test.env` (set BEFORE any module evaluates, unlike a statement
// in this file, whose imports are hoisted and would evaluate config.ts first).

import { getDB, closeDB } from '../src/db/database.js';

beforeAll(() => {
  mkdirSync(process.cwd() + '/data', { recursive: true });
  getDB();
});

afterAll(() => {
  closeDB();
});
