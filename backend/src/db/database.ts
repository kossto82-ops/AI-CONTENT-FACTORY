import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveDbPath } from '../config.js';

export type DB = DatabaseSync;

let _db: DB | null = null;

/** Open (once) the SQLite database and apply migrations. */
export function getDB(): DB {
  if (_db) return _db;
  const path = resolveDbPath();
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  _db = db;
  return db;
}

export function closeDB(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * Simple versioned migrations. Store the applied version in schema_version and
 * apply any pending migrations in order on startup.
 */
const MIGRATIONS: { version: number; up: string }[] = [
  {
    version: 1,
    up: `
CREATE TABLE IF NOT EXISTS pipeline (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  definition    TEXT NOT NULL,   -- JSON: ordered steps + gates + mode overrides
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content (
  id            TEXT PRIMARY KEY,
  title         TEXT,
  target_age    TEXT,
  format        TEXT,
  hook          TEXT,
  status        TEXT NOT NULL,   -- content lifecycle state
  current_version INTEGER NOT NULL DEFAULT 0,
  meta          TEXT NOT NULL DEFAULT '{}',  -- JSON free-form
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  mode          TEXT NOT NULL,   -- MANUAL | SEMI_AUTOMATIC | AUTOMATIC
  status        TEXT NOT NULL,   -- IDLE | READY | RUNNING | WAITING_APPROVAL | ERROR | DISABLED
  enabled       INTEGER NOT NULL DEFAULT 1,
  tier          TEXT NOT NULL,   -- default routing tier
  config        TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job (
  id            TEXT PRIMARY KEY,
  content_id    TEXT,
  pipeline_id   TEXT,
  type          TEXT NOT NULL,      -- agent type (research|script|director|qa|...)
  agent_id      TEXT,
  status        TEXT NOT NULL,      -- PENDING|READY|RUNNING|WAITING_APPROVAL|COMPLETED|FAILED|CANCELLED
  input         TEXT NOT NULL,      -- JSON payload (structured input)
  output        TEXT,               -- JSON payload (structured output) + usage
  parent_job    TEXT,
  dependency    TEXT,               -- job id this job depends on
  created_at    TEXT NOT NULL,
  started_at    TEXT,
  completed_at  TEXT,
  attempt       INTEGER NOT NULL DEFAULT 0,
  max_retries   INTEGER NOT NULL DEFAULT 2,
  error         TEXT,
  model         TEXT,
  provider      TEXT,
  tokens_in     INTEGER NOT NULL DEFAULT 0,
  tokens_out    INTEGER NOT NULL DEFAULT 0,
  cost_eur      REAL NOT NULL DEFAULT 0.0,
  trace         TEXT NOT NULL DEFAULT '[]'   -- JSON: event log for this job
);

CREATE TABLE IF NOT EXISTS approval (
  id            TEXT PRIMARY KEY,
  content_id    TEXT,
  job_id        TEXT,
  kind          TEXT NOT NULL,   -- idea|script|plan|asset|video|publication
  status        TEXT NOT NULL,   -- PENDING|APPROVED|REJECTED
  request_reason TEXT,
  decision      TEXT,
  decided_at    TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact (
  id            TEXT PRIMARY KEY,
  content_id    TEXT NOT NULL,
  kind          TEXT NOT NULL,   -- idea|script|production_plan|qa
  version       INTEGER NOT NULL,
  payload       TEXT NOT NULL,   -- JSON structured artifact
  source_job_id TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE(content_id, kind, version)
);

CREATE TABLE IF NOT EXISTS execution (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL,
  agent_id      TEXT,
  model         TEXT,
  provider      TEXT,
  tokens_in     INTEGER NOT NULL DEFAULT 0,
  tokens_out    INTEGER NOT NULL DEFAULT 0,
  cost_eur      REAL NOT NULL DEFAULT 0.0,
  started_at    TEXT,
  ended_at      TEXT,
  error         TEXT
);

CREATE TABLE IF NOT EXISTS event (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     TEXT,
  payload       TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    up: `
CREATE TABLE IF NOT EXISTS model_registry (
  id            TEXT PRIMARY KEY,
  task          TEXT NOT NULL,   -- conceptual task key
  tier          TEXT NOT NULL,   -- cheap|standard|quality|vision
  model         TEXT NOT NULL,   -- OmniRoute combo, e.g. auto/cheap
  provider      TEXT NOT NULL,
  priority      INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1
);
`,
  },
];

export function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL
    );
  `);
  const row = db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get() as
    | { version: number }
    | undefined;
  const current = row?.version ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version > current) {
      db.exec('BEGIN');
      try {
        db.exec(m.up);
        db.prepare('INSERT INTO schema_version(version) VALUES (?)').run(m.version);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    }
  }
}
