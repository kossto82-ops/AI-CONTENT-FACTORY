/**
 * Pipeline manifest — the declarative, schema-validated form of a pipeline.
 *
 * Phase 2 (Migration Plan): keep the existing `PipelineDefinition` interface
 * (orchestrator/store/server all consume it) and introduce a schema-validated
 * manifest ON TOP of it. A manifest is a `PipelineDefinition` plus richer,
 * optional declarative orchestration metadata (category, stability, budget
 * caps, anti-loop limits — the governance adopted from OpenMontage).
 *
 * `buildPipelineManifest()` turns any `PipelineDefinition` into a valid
 * manifest by filling in sane defaults, so NOTHING that already works changes.
 * `validatePipelineDefinition()` catches schema drift at load/startup.
 */
import { z } from 'zod';
import type {
  AgentMode,
  ApprovalKind,
} from '../domain/types.js';
import type { PipelineDefinition, PipelineStep } from '../pipeline.js';

/** Pipeline category (children's short-form formats). */
export type PipelineCategory =
  | 'educational'
  | 'storybook'
  | 'singalong'
  | 'quiz'
  | 'short';

/** Stability gating for a manifest. */
export type PipelineStability = 'production' | 'beta' | 'test';

/**
 * Agents that are legally valid pipeline steps. Mirrors the AgentType union
 * from the registry but kept as a strict literal list for schema validation.
 */
const agentLiterals = [
  'research',
  'script',
  'director',
  'visual',
  'voice',
  'assembly',
  'render',
  'qa',
  'publisher',
] as const;

/** The declarative orchestration/governance metadata carried by a manifest. */
export const orchestrationMetaSchema = z.object({
  category: z.enum(['educational', 'storybook', 'singalong', 'quiz', 'short']),
  stability: z.enum(['production', 'beta', 'test']),
  budgetDefaultEur: z.number().nonnegative(),
  maxRevisionsPerStage: z.number().int().positive(),
  maxSendBacks: z.number().int().positive(),
  maxWallTimeMinutes: z.number().int().positive(),
  referenceChannels: z.array(z.string()).optional(),
});

export const pipelineManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  steps: z.array(
    z.object({
      order: z.number().int().positive(),
      agent: z.enum(agentLiterals),
      mode: z.enum(['MANUAL', 'SEMI_AUTOMATIC', 'AUTOMATIC']).optional(),
      requiresApproval: z.boolean().optional(),
      approvalKind: z
        .enum(['idea', 'script', 'plan', 'asset', 'video', 'publication'])
        .optional(),
      dependsOn: z.string().optional(),
    }),
  ),
  orchestration: orchestrationMetaSchema,
});

export type OrchestrationMeta = z.infer<typeof orchestrationMetaSchema>;
export type PipelineManifest = z.infer<typeof pipelineManifestSchema>;

/** Sensible defaults for manifest metadata when inflating a plain definition. */
const DEFAULT_ORCHESTRATION: OrchestrationMeta = {
  category: 'short',
  stability: 'beta',
  budgetDefaultEur: 1.0,
  maxRevisionsPerStage: 3,
  maxSendBacks: 3,
  maxWallTimeMinutes: 60,
};

/** Inflate a `PipelineDefinition` into a full, schema-valid `PipelineManifest`. */
export function buildPipelineManifest(
  definition: PipelineDefinition,
  meta: Partial<OrchestrationMeta> = {},
): PipelineManifest {
  return pipelineManifestSchema.parse({
    id: definition.id,
    name: definition.name,
    steps: definition.steps.map((s) => ({
      order: s.order,
      agent: s.agent,
      mode: s.mode,
      requiresApproval: s.requiresApproval,
      approvalKind: s.approvalKind,
      dependsOn: s.dependsOn,
    })),
    orchestration: {
      ...DEFAULT_ORCHESTRATION,
      ...meta,
    },
  });
}

/** Drop manifest-only fields back to a plain `PipelineDefinition`. */
export function manifestToDefinition(manifest: PipelineManifest): PipelineDefinition {
  return {
    id: manifest.id,
    name: manifest.name,
    steps: manifest.steps.map<PipelineStep>((s) => ({
      order: s.order,
      agent: s.agent,
      ...(s.mode !== undefined ? { mode: s.mode } : {}),
      ...(s.requiresApproval !== undefined ? { requiresApproval: s.requiresApproval } : {}),
      ...(s.approvalKind !== undefined ? { approvalKind: s.approvalKind } : {}),
      ...(s.dependsOn !== undefined ? { dependsOn: s.dependsOn } : {}),
    })),
  };
}

/**
 * Validate a `PipelineDefinition` against the manifest schema. Throws a
 * descriptive zod error on drift (unknown agent, bad mode, non-positive
 * order, ...). The untyped `mode`/`approvalKind`/`agent` fields are spread
 * through a permissive coercion first so only real violations fail.
 */
export function validatePipelineDefinition(definition: PipelineDefinition): void {
  pipelineManifestSchema.parse(buildPipelineManifest(definition));
}

// Re-export for consumers that want a single import surface.
export type { AgentMode, ApprovalKind };
