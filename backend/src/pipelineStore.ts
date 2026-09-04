import { getDB } from './db/database.js';
import { nowIso } from './domain/types.js';
import { DEFAULT_PIPELINE, type PipelineDefinition, type PipelineStep } from './pipeline.js';
import type { AgentMode, ApprovalKind } from './domain/types.js';
import {
  buildPipelineManifest,
  validatePipelineDefinition,
  type OrchestrationMeta,
  type PipelineManifest,
} from './contracts/pipelineManifest.js';

/**
 * Persistent pipeline store (Decision D-10 "pipelines as data"). The active
 * pipeline definition lives in the `pipeline` table as JSON; operators can
 * tweak per-step mode (MANUAL / SEMI_AUTOMATIC / AUTOMATIC) and approval gates
 * from the Control Center. Falls back to DEFAULT_PIPELINE when nothing stored.
 *
 * Stored definitions are RECONCILED against the canonical DEFAULT_PIPELINE on
 * load: newly added code-backed steps (e.g. assembly in Phase 7) are injected
 * in canonical order while operator overrides on existing steps are preserved,
 * so dev DBs seeded before a step existed get the full pipeline without
 * clobbering human tweaks.
 */

interface PipelineConfig {
  steps: PipelineStep[];
}

const DEFINITION_KEY = 'steps';

// Fail fast if the canonical default pipeline drifts from the manifest schema.
// Any code change that introduces an invalid step/agent/mode is caught at load.
validatePipelineDefinition(DEFAULT_PIPELINE);

/**
 * Merge a stored definition into the canonical default: keep operator
 * overrides per agent, inject any missing code-backed steps, append custom
 * steps the operator added.
 */
function reconcile(stored: PipelineDefinition): PipelineDefinition {
  if (stored.id !== DEFAULT_PIPELINE.id) return stored;
  const storedSteps = new Map(stored.steps.map((s) => [s.agent, s]));
  const merged: PipelineStep[] = DEFAULT_PIPELINE.steps.map((cs) => {
    const ss = storedSteps.get(cs.agent);
    if (!ss) return { ...cs };
    const m: PipelineStep = { ...cs };
    if (ss.mode !== undefined) m.mode = ss.mode;
    if (ss.requiresApproval !== undefined) m.requiresApproval = ss.requiresApproval;
    if (ss.approvalKind !== undefined) m.approvalKind = ss.approvalKind;
    return m;
  });
  const known = new Set(merged.map((s) => s.agent));
  const extras = stored.steps
    .filter((s) => !known.has(s.agent))
    .sort((a, b) => a.order - b.order)
    .map((s, i) => ({ ...s, order: merged.length + i + 1 }));
  return { id: DEFAULT_PIPELINE.id, name: DEFAULT_PIPELINE.name, steps: [...merged, ...extras] };
}

function toPipeline(row: {
  id: string;
  name: string;
  definition: string;
}): PipelineDefinition {
  let parsed: PipelineStep[] | undefined;
  try {
    const cfg = JSON.parse(row.definition) as PipelineConfig;
    if (Array.isArray(cfg.steps)) parsed = cfg.steps;
  } catch {
    // fall through to default
  }
  if (!parsed) return { id: row.id, name: row.name, steps: DEFAULT_PIPELINE.steps };
  return reconcile({ id: row.id, name: row.name, steps: parsed });
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
  const result = toPipeline(row);
  // Persist the reconciled definition so it wins over the stale stored row.
  if (result.id === DEFAULT_PIPELINE.id) {
    const reconciled = JSON.stringify({ steps: result.steps });
    if (reconciled !== row.definition) {
      upsert(result.id, result.name, reconciled);
    }
  }
  return result;
}

/**
 * Load the active pipeline as a schema-validated manifest. Every stored
 * definition inflates to a valid manifest (defaults filled in), so Existing
 * pipelines remain valid. Validation catches drift in cases where a stored
 * definition violates the manifest schema (unknown agent, bad mode, ...).
 */
export function loadPipelineManifest(opts?: {
  id?: string;
  meta?: Partial<OrchestrationMeta>;
}): PipelineManifest {
  const definition = loadPipeline(opts?.id);
  validatePipelineDefinition(definition);
  return buildPipelineManifest(definition, opts?.meta);
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
