import { getDB } from './database.js';
import type {
  AgentMode,
  AgentStatus,
  ApprovalKind,
  ApprovalStatus,
  ContentStatus,
  JobStatus,
} from '../domain/types.js';
import { nowIso, newId } from '../domain/types.js';
import type { ArtifactLifecycle } from '../contracts/artifact.js';
import { isAtLeast } from '../contracts/artifact.js';
import type { DecisionLogInput } from '../contracts/decisionLog.js';

// ---------------- Schema-shaped row types ----------------

export interface JobRow {
  id: string;
  content_id: string | null;
  pipeline_id: string | null;
  type: string;
  agent_id: string | null;
  status: JobStatus;
  input: string;
  output: string | null;
  parent_job: string | null;
  dependency: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  attempt: number;
  max_retries: number;
  error: string | null;
  model: string | null;
  provider: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_eur: number;
  trace: string;
}

export interface ContentRow {
  id: string;
  title: string | null;
  target_age: string | null;
  format: string | null;
  hook: string | null;
  status: ContentStatus;
  current_version: number;
  meta: string;
  channel_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChannelRow {
  id: string;
  name: string;
  config: string | null; // JSON ChannelConfig (NULL = default)
  created_at: string;
  updated_at: string;
}

export interface ApprovalRow {
  id: string;
  content_id: string | null;
  job_id: string | null;
  kind: ApprovalKind;
  status: ApprovalStatus;
  request_reason: string | null;
  decision: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface ArtifactRow {
  id: string;
  content_id: string;
  kind: string;
  version: number;
  payload: string;
  source_job_id: string | null;
  created_at: string;
  // Phase 3: provenance + lifecycle (present after migration v5; best-effort
  // on pre-migration rows so legacy inserts/reads keep working).
  lifecycle?: ArtifactLifecycle;
  provider?: string | null;
  model?: string | null;
  seed?: number | null;
  cost_eur?: number;
  validation?: string | null; // JSON ArtifactValidation (serialized)
}

export interface DecisionLogRow {
  id: string;
  content_id: string | null;
  stage: string | null;
  category: string;
  subject: string;
  decision: string;
  options_considered: string; // JSON string[]
  rejected_because: string; // JSON string[]
  created_at: string;
}

export interface AgentRow {
  id: string;
  name: string;
  mode: AgentMode;
  status: AgentStatus;
  enabled: number;
  tier: string;
  config: string;
  created_at: string;
}

export interface ExecutionRow {
  id: string;
  job_id: string;
  agent_id: string | null;
  model: string | null;
  provider: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_eur: number;
  started_at: string | null;
  ended_at: string | null;
  error: string | null;
}

export interface EventRow {
  type: string;
  entity_type: string | null;
  entity_id: string | null;
  payload: string;
  created_at: string;
}

// ---------------- Row mappers ----------------
// node:sqlite returns rows as Record<string, SQLOutputValue>; map them to the
// typed row shapes (enforcing enum status fields) instead of unsafe casts.

type SqlRow = Record<string, unknown>;

export function mapJob(r: SqlRow): JobRow {
  return {
    id: String(r.id),
    content_id: r.content_id == null ? null : String(r.content_id),
    pipeline_id: r.pipeline_id == null ? null : String(r.pipeline_id),
    type: String(r.type),
    agent_id: r.agent_id == null ? null : String(r.agent_id),
    status: r.status as JobStatus,
    input: String(r.input),
    output: r.output == null ? null : String(r.output),
    parent_job: r.parent_job == null ? null : String(r.parent_job),
    dependency: r.dependency == null ? null : String(r.dependency),
    created_at: String(r.created_at),
    started_at: r.started_at == null ? null : String(r.started_at),
    completed_at: r.completed_at == null ? null : String(r.completed_at),
    attempt: Number(r.attempt),
    max_retries: Number(r.max_retries),
    error: r.error == null ? null : String(r.error),
    model: r.model == null ? null : String(r.model),
    provider: r.provider == null ? null : String(r.provider),
    tokens_in: Number(r.tokens_in),
    tokens_out: Number(r.tokens_out),
    cost_eur: Number(r.cost_eur),
    trace: String(r.trace),
  };
}

export function mapContent(r: SqlRow): ContentRow {
  return {
    id: String(r.id),
    title: r.title == null ? null : String(r.title),
    target_age: r.target_age == null ? null : String(r.target_age),
    format: r.format == null ? null : String(r.format),
    hook: r.hook == null ? null : String(r.hook),
    status: r.status as ContentStatus,
    current_version: Number(r.current_version),
    meta: String(r.meta),
    channel_id: r.channel_id == null ? null : String(r.channel_id),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export function mapChannel(r: SqlRow): ChannelRow {
  return {
    id: String(r.id),
    name: String(r.name),
    config: r.config == null ? null : String(r.config),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export function mapApproval(r: SqlRow): ApprovalRow {
  return {
    id: String(r.id),
    content_id: r.content_id == null ? null : String(r.content_id),
    job_id: r.job_id == null ? null : String(r.job_id),
    kind: r.kind as ApprovalKind,
    status: r.status as ApprovalStatus,
    request_reason: r.request_reason == null ? null : String(r.request_reason),
    decision: r.decision == null ? null : String(r.decision),
    decided_at: r.decided_at == null ? null : String(r.decided_at),
    created_at: String(r.created_at),
  };
}

export function mapArtifact(r: SqlRow): ArtifactRow {
  return {
    id: String(r.id),
    content_id: String(r.content_id),
    kind: String(r.kind),
    version: Number(r.version),
    payload: String(r.payload),
    source_job_id: r.source_job_id == null ? null : String(r.source_job_id),
    created_at: String(r.created_at),
    lifecycle: (r.lifecycle as ArtifactLifecycle | undefined) ?? 'GENERATED',
    provider: r.provider == null ? null : String(r.provider),
    model: r.model == null ? null : String(r.model),
    seed: r.seed == null ? null : Number(r.seed),
    cost_eur: r.cost_eur == null ? 0 : Number(r.cost_eur),
    validation: r.validation == null ? null : String(r.validation),
  };
}

export function mapDecisionLog(r: SqlRow): DecisionLogRow {
  return {
    id: String(r.id),
    content_id: r.content_id == null ? null : String(r.content_id),
    stage: r.stage == null ? null : String(r.stage),
    category: String(r.category),
    subject: String(r.subject),
    decision: String(r.decision),
    options_considered: String(r.options_considered),
    rejected_because: String(r.rejected_because),
    created_at: String(r.created_at),
  };
}

export function mapAgent(r: SqlRow): AgentRow {
  return {
    id: String(r.id),
    name: String(r.name),
    mode: r.mode as AgentMode,
    status: r.status as AgentStatus,
    enabled: Number(r.enabled),
    tier: String(r.tier),
    config: String(r.config),
    created_at: String(r.created_at),
  };
}

export function mapExecution(r: SqlRow): ExecutionRow {
  return {
    id: String(r.id),
    job_id: String(r.job_id),
    agent_id: r.agent_id == null ? null : String(r.agent_id),
    model: r.model == null ? null : String(r.model),
    provider: r.provider == null ? null : String(r.provider),
    tokens_in: Number(r.tokens_in),
    tokens_out: Number(r.tokens_out),
    cost_eur: Number(r.cost_eur),
    started_at: r.started_at == null ? null : String(r.started_at),
    ended_at: r.ended_at == null ? null : String(r.ended_at),
    error: r.error == null ? null : String(r.error),
  };
}

// ---------------- JobRepository ----------------

export const jobRepo = {
  insert(j: JobRow): void {
    getDB()
      .prepare(
        `INSERT INTO job
         (id, content_id, pipeline_id, type, agent_id, status, input, output, parent_job,
          dependency, created_at, started_at, completed_at, attempt, max_retries, error,
          model, provider, tokens_in, tokens_out, cost_eur, trace)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        j.id, j.content_id, j.pipeline_id, j.type, j.agent_id, j.status, j.input, j.output,
        j.parent_job, j.dependency, j.created_at, j.started_at, j.completed_at, j.attempt,
        j.max_retries, j.error, j.model, j.provider, j.tokens_in, j.tokens_out, j.cost_eur, j.trace,
      );
  },

  get(id: string): JobRow | undefined {
    const r = getDB().prepare('SELECT * FROM job WHERE id = ?').get(id) as SqlRow | undefined;
    return r ? mapJob(r) : undefined;
  },

  listByContent(contentId: string): JobRow[] {
    return (getDB()
      .prepare('SELECT * FROM job WHERE content_id = ? ORDER BY created_at')
      .all(contentId) as SqlRow[]).map(mapJob);
  },

  listByStatus(status: JobStatus): JobRow[] {
    return (getDB().prepare('SELECT * FROM job WHERE status = ?').all(status) as SqlRow[]).map(mapJob);
  },

  updateStatus(job: JobRow): void {
    getDB()
      .prepare(
        `UPDATE job SET status=?, started_at=?, completed_at=?, attempt=?, error=?,
         model=?, provider=?, tokens_in=?, tokens_out=?, cost_eur=?, output=?, trace=?
         WHERE id=?`,
      )
      .run(
        job.status, job.started_at, job.completed_at, job.attempt, job.error,
        job.model, job.provider, job.tokens_in, job.tokens_out, job.cost_eur, job.output,
        job.trace, job.id,
      );
  },

  updateAttempt(id: string, attempt: number): void {
    getDB().prepare('UPDATE job SET attempt=? WHERE id=?').run(attempt, id);
  },

  /** Jobs that are READY/PENDING and waiting to run, whose dependency is satisfied. */
  runnable(): JobRow[] {
    return (getDB()
      .prepare(
        `SELECT * FROM job
         WHERE status IN ('READY','PENDING')
           AND (dependency IS NULL OR dependency = '' OR
                dependency IN (SELECT j2.id FROM job j2 WHERE j2.id = job.dependency AND j2.status='COMPLETED'))`,
      )
      .all() as SqlRow[]).map(mapJob);
  },

  /**
   * Crash recovery: jobs stuck in RUNNING were mid-flight in a previous
   * process that died (e.g. a dev-server restart or a hung gateway call).
   * Reset them to READY so the next drain re-runs them instead of leaving
   * them permanently stuck. Returns the number of jobs recovered.
   */
  recoverInterrupted(): number {
    const stuck = getDB().prepare("SELECT id FROM job WHERE status='RUNNING'").all() as { id: string }[];
    for (const s of stuck) {
      getDB()
        .prepare("UPDATE job SET status='READY', started_at=NULL, error=? WHERE id=?")
        .run(
          'recovered on restart: previous process interrupted while running',
          s.id,
        );
    }
    return stuck.length;
  },
};

// ---------------- ContentRepository ----------------

export const contentRepo = {
  insert(c: ContentRow): void {
    getDB()
      .prepare(
        `INSERT INTO content
         (id, title, target_age, format, hook, status, current_version, meta, channel_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        c.id, c.title, c.target_age, c.format, c.hook, c.status, c.current_version,
        c.meta, c.channel_id, c.created_at, c.updated_at,
      );
  },

  get(id: string): ContentRow | undefined {
    const r = getDB().prepare('SELECT * FROM content WHERE id = ?').get(id) as SqlRow | undefined;
    return r ? mapContent(r) : undefined;
  },

  list(): ContentRow[] {
    return (getDB().prepare('SELECT * FROM content ORDER BY created_at').all() as SqlRow[]).map(mapContent);
  },

  setStatus(id: string, status: ContentStatus): void {
    getDB()
      .prepare('UPDATE content SET status=?, updated_at=? WHERE id=?')
      .run(status, nowIso(), id);
  },

  updateMeta(id: string, meta: string): void {
    getDB().prepare('UPDATE content SET meta=?, updated_at=? WHERE id=?').run(meta, nowIso(), id);
  },

  patch(c: ContentRow): void {
    getDB()
      .prepare(
        `UPDATE content SET title=?, target_age=?, format=?, hook=?, status=?,
         current_version=?, meta=?, channel_id=?, updated_at=? WHERE id=?`,
      )
      .run(
        c.title, c.target_age, c.format, c.hook, c.status, c.current_version, c.meta,
        c.channel_id, nowIso(), c.id,
      );
  },
};

// ---------------- ChannelRepository ----------------

export const channelRepo = {
  insert(ch: ChannelRow): void {
    getDB()
      .prepare(
        `INSERT INTO channel (id, name, config, created_at, updated_at) VALUES (?,?,?,?,?)`,
      )
      .run(ch.id, ch.name, ch.config, ch.created_at, ch.updated_at);
  },

  get(id: string): ChannelRow | undefined {
    const r = getDB().prepare('SELECT * FROM channel WHERE id = ?').get(id) as SqlRow | undefined;
    return r ? mapChannel(r) : undefined;
  },

  list(): ChannelRow[] {
    return (getDB().prepare('SELECT * FROM channel ORDER BY created_at').all() as SqlRow[]).map(mapChannel);
  },

  updateConfig(id: string, name: string, config: string | null): void {
    getDB()
      .prepare('UPDATE channel SET name=?, config=?, updated_at=? WHERE id=?')
      .run(name, config, nowIso(), id);
  },
};

// ---------------- ApprovalRepository ----------------

export const approvalRepo = {
  insert(a: ApprovalRow): void {
    getDB()
      .prepare(
        `INSERT INTO approval (id, content_id, job_id, kind, status, request_reason, decision, decided_at, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        a.id, a.content_id, a.job_id, a.kind, a.status, a.request_reason, a.decision,
        a.decided_at, a.created_at,
      );
  },

  pending(kind: ApprovalKind): ApprovalRow[] {
    return (getDB()
      .prepare("SELECT * FROM approval WHERE status='PENDING' AND kind=?")
      .all(kind) as SqlRow[]).map(mapApproval);
  },

  get(id: string): ApprovalRow | undefined {
    const r = getDB().prepare('SELECT * FROM approval WHERE id = ?').get(id) as SqlRow | undefined;
    return r ? mapApproval(r) : undefined;
  },

  listPending(): ApprovalRow[] {
    return (getDB().prepare("SELECT * FROM approval WHERE status='PENDING'").all() as SqlRow[]).map(
      mapApproval,
    );
  },

  setDecision(id: string, status: ApprovalStatus, decision: string): void {
    getDB()
      .prepare('UPDATE approval SET status=?, decision=?, decided_at=? WHERE id=?')
      .run(status, decision, nowIso(), id);
  },
};

// ---------------- ArtifactRepository ----------------

export const artifactRepo = {
  nextVersion(contentId: string, kind: string): number {
    const r = getDB()
      .prepare('SELECT COALESCE(MAX(version),0)+1 AS v FROM artifact WHERE content_id=? AND kind=?')
      .get(contentId, kind) as { v: number };
    return r.v;
  },

  insert(a: ArtifactRow): void {
    getDB()
      .prepare(
        `INSERT INTO artifact
         (id, content_id, kind, version, payload, source_job_id, created_at,
          lifecycle, provider, model, seed, cost_eur, validation)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        a.id, a.content_id, a.kind, a.version, a.payload, a.source_job_id, a.created_at,
        a.lifecycle ?? 'GENERATED', a.provider ?? null, a.model ?? null, a.seed ?? null,
        a.cost_eur ?? 0, a.validation ?? null,
      );
  },

  latest(contentId: string, kind: string): ArtifactRow | undefined {
    const r = getDB()
      .prepare(
        'SELECT * FROM artifact WHERE content_id=? AND kind=? ORDER BY version DESC LIMIT 1',
      )
      .get(contentId, kind) as SqlRow | undefined;
    return r ? mapArtifact(r) : undefined;
  },

  /** All artifacts (highest version each) for a content id, newest first. */
  listByContent(contentId: string): ArtifactRow[] {
    return (getDB()
      .prepare(
        `SELECT a.* FROM artifact a
         WHERE a.content_id=? AND a.version = (
           SELECT MAX(a2.version) FROM artifact a2 WHERE a2.content_id=? AND a2.kind=a.kind
         ) ORDER BY a.created_at`,
      )
      .all(contentId, contentId) as SqlRow[]).map(mapArtifact);
  },

  /**
   * Advance an artifact's lifecycle phase (never regress). Returns the row.
   * Throws if the artifact does not exist or the target is earlier than the
   * current phase.
   */
  updateLifecycle(
    contentId: string,
    kind: string,
    version: number,
    lifecycle: ArtifactLifecycle,
  ): ArtifactRow {
    const [row] = this.listByContent(contentId).filter(
      (a) => a.kind === kind && a.version === version,
    );
    if (!row) {
      throw new Error(`Artifact not found: ${contentId}/${kind}#${version}`);
    }
    const current = row.lifecycle ?? 'GENERATED';
    if (!isAtLeast(lifecycle, current)) {
      throw new Error(
        `Lifecycle regression rejected: ${current} -> ${lifecycle} for ${contentId}/${kind}#${version}`,
      );
    }
    getDB()
      .prepare('UPDATE artifact SET lifecycle=? WHERE content_id=? AND kind=? AND version=?')
      .run(lifecycle, contentId, kind, version);
    return mapArtifact(
      getDB()
        .prepare('SELECT * FROM artifact WHERE content_id=? AND kind=? AND version=?')
        .get(contentId, kind, version) as SqlRow,
    );
  },
};

// ---------------- Decision Log Repository ----------------

export const decisionLogRepo = {
  insert(input: DecisionLogInput): void {
    const id = input.id ?? newId('decision');
    const createdAt = input.createdAt ?? nowIso();
    getDB()
      .prepare(
        `INSERT INTO decision_log
         (id, content_id, stage, category, subject, decision, options_considered,
          rejected_because, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id, input.contentId ?? null, input.stage ?? null, input.category, input.subject,
        input.decision, JSON.stringify(input.optionsConsidered ?? []),
        JSON.stringify(input.rejectedBecause ?? []), createdAt,
      );
  },

  get(id: string): DecisionLogRow | undefined {
    const r = getDB().prepare('SELECT * FROM decision_log WHERE id=?').get(id) as SqlRow | undefined;
    return r ? mapDecisionLog(r) : undefined;
  },

  listByContent(contentId: string): DecisionLogRow[] {
    return (getDB()
      .prepare('SELECT * FROM decision_log WHERE content_id=? ORDER BY created_at')
      .all(contentId) as SqlRow[]).map(mapDecisionLog);
  },

  listRecent(limit = 50): DecisionLogRow[] {
    return (getDB()
      .prepare('SELECT * FROM decision_log ORDER BY created_at DESC LIMIT ?')
      .all(limit) as SqlRow[]).map(mapDecisionLog);
  },
};

// ---------------- Execution Repository ----------------

export const executionRepo = {
  insert(e: ExecutionRow): void {
    getDB()
      .prepare(
        `INSERT INTO execution (id, job_id, agent_id, model, provider, tokens_in, tokens_out,
          cost_eur, started_at, ended_at, error)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        e.id, e.job_id, e.agent_id, e.model, e.provider, e.tokens_in, e.tokens_out,
        e.cost_eur, e.started_at, e.ended_at, e.error,
      );
  },
};

// ---------------- Event persistence ----------------

export function persistEvent(evt: EventRow): void {
  getDB()
    .prepare('INSERT INTO event (type, entity_type, entity_id, payload, created_at) VALUES (?,?,?,?,?)')
    .run(evt.type, evt.entity_type, evt.entity_id, evt.payload, evt.created_at);
}
