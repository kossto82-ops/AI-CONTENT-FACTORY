import { getDB } from './db/database.js';
import { nowIso } from './domain/types.js';
import { DEFAULT_PIPELINE, type PipelineDefinition, type PipelineStep } from './pipeline.js';
import type { AgentMode, ApprovalKind } from './domain/types.js';

/**
 * Persistent pipeline store (Decision D-10 "pipelines as data"). The active
 * pipeline definition lives in the `pipeline` table as JSON; operators can
 * tweak per-step mode (MANUAL / SEMI_AUTOMATIC / AUTOMATIC) and approval gates
 * from the Control Center. Falls back to DEFAULT_PIPELINE when nothing stored.
 */

interface PipelineConfig {
  steps: PipelineStep[];
}

const DEFINITION_KEY = 'steps';

function toPipeline(row: {
  id: string;
  name: string;
  definition: string;
}): PipelineDefinition {
  try {
    const cfg = JSON.parse(row.definition) as PipelineConfig;
    if (Array.isArray(cfg.steps)) {
      return { id: row.id, name: row.name, steps: cfg.steps };
    }
  } catch {
    // fall through to default
  }
  return { id: row.id, name: row.name, steps: DEFAULT_PIPELINE.steps };
}

function upsert(id: string, name: string, definition: string): void {
  const existing = getDB()
    .prepare('SELECT id FROM pipeline WHERE id=?')
    .get(id) as { id: string } | undefined;
  if (existing) {
    getDB().prepare('UPDATE pipeline SET name=?, definition=? WHERE id=?').run(name, definition, id);
  } else {
    getDB()
      .prepare('INSERT INTO pipeline (id, name, definition, enabled, created_at) VALUES (?,?,?,1,?)')
      .run(id, name, definition, nowIso());
  }
}

/** Load the active pipeline definition, seeding from DEFAULT_PIPELINE if absent. */
export function loadPipeline(id: string = DEFAULT_PIPELINE.id): PipelineDefinition {
  const row = getDB().prepare('SELECT id, name, definition FROM pipeline WHERE id=?').get(id) as
    | { id: string; name: string; definition: string }
    | undefined;
  if (!row) {
    upsert(DEFAULT_PIPELINE.id, DEFAULT_PIPELINE.name, JSON.stringify({ steps: DEFAULT_PIPELINE.steps }));
    return { id: DEFAULT_PIPELINE.id, name: DEFAULT_PIPELINE.name, steps: DEFAULT_PIPELINE.steps };
  }
  return toPipeline(row);
}

/** List all stored pipeline headers (no full definitions). */
export function listPipelines(): { id: string; name: string }[] {
  return (getDB().prepare('SELECT id, name FROM pipeline ORDER BY created_at').all() as {
    id: string;
    name: string;
  }[]).map((r) => ({ id: r.id, name: r.name }));
}

export interface UpdateStepOptions {
  pipelineId?: string;
  agent: string;
  mode?: AgentMode;
  requiresApproval?: boolean;
  approvalKind?: ApprovalKind;
}

/**
 * Update a single step's mode / gate and persist. Returns the new definition.
 * Throws if the step doesn't exist in the current definition.
 */
export function updateStepDefinition(opts: UpdateStepOptions): PipelineDefinition {
  const pipeline = loadPipeline(opts.pipelineId);
  const idx = pipeline.steps.findIndex((s) => s.agent === opts.agent);
  if (idx < 0) throw new Error(`Step '${opts.agent}' not found in pipeline '${pipeline.id}'`);

  const next: PipelineDefinition = {
    id: pipeline.id,
    name: pipeline.name,
    steps: pipeline.steps.map((s, i) => {
      if (i !== idx) return s;
      const updated: PipelineStep = { ...s };
      if (opts.mode !== undefined) updated.mode = opts.mode;
      if (opts.requiresApproval !== undefined) updated.requiresApproval = opts.requiresApproval;
      if (opts.approvalKind !== undefined) updated.approvalKind = opts.approvalKind;
      return updated;
    }),
  };

  upsert(next.id, next.name, JSON.stringify({ [DEFINITION_KEY]: next.steps }));
  return next;
}

/** Serialise a definition for API responses. */
export function pipelineToApi(p: PipelineDefinition): {
  id: string;
  name: string;
  steps: PipelineStep[];
} {
  return { id: p.id, name: p.name, steps: p.steps };
}
