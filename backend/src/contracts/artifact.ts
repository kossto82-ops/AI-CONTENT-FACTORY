/**
 * Artifacts with provenance + lifecycle status (Phase 3).
 *
 * Enriches every artifact with an honest lifecycle (PLANNED -> GENERATED ->
 * VALIDATED -> COMPOSED -> RENDERED -> PUBLISHED) and full provenance (provider,
 * model, prompt, seed, cost, dimensions, format). This makes fake vs real
 * output distinguishable: a FinalVideoManifest is COMPOSED, the muxed final.mp4
 * is RENDERED, and only a RENDERED + VALIDATED artifact may be called a final
 * video / published.
 */
import { z } from 'zod';

export const LIFECYCLE_STATES = [
  'PLANNED',
  'GENERATED',
  'VALIDATED',
  'COMPOSED',
  'RENDERED',
  'PUBLISHED',
] as const;
export type ArtifactLifecycle = (typeof LIFECYCLE_STATES)[number];

/** Ordered index for phase comparison. */
export const LIFECYCLE_ORDER: Record<ArtifactLifecycle, number> = {
  PLANNED: 0,
  GENERATED: 1,
  VALIDATED: 2,
  COMPOSED: 3,
  RENDERED: 4,
  PUBLISHED: 5,
};

/** True when `actual` is at (or past) the `target` lifecycle phase. */
export function isAtLeast(actual: ArtifactLifecycle, target: ArtifactLifecycle): boolean {
  return LIFECYCLE_ORDER[actual] >= LIFECYCLE_ORDER[target];
}

export const artifactValidationSchema = z.object({
  status: z.enum(['passed', 'failed', 'unchecked']),
  checkedAt: z.string().optional(),
  detail: z.string().optional(),
});
export type ArtifactValidation = z.infer<typeof artifactValidationSchema>;

/**
 * The enriched artifact shape. This is the persisted + surfaced form. The
 * Database row (ArtifactRow) carries the same fields; this schema is the
 * canonical typed/DTO representation.
 */
export const mediaArtifactSchema = z.object({
  id: z.string(),
  contentId: z.string(),
  kind: z.string(),
  version: z.number().int().positive(),
  sourceJobId: z.string().nullish(),
  lifecycle: z.enum(LIFECYCLE_STATES).default('GENERATED'),
  // provenance
  provider: z.string().nullish(),
  model: z.string().nullish(),
  prompt: z.string().nullish(),
  seed: z.number().int().nullish(),
  costEur: z.number().nonnegative().default(0),
  dimensions: z.string().nullish(),
  format: z.string().nullish(),
  // validation result (probe-based, not metadata)
  validation: artifactValidationSchema.nullish(),
});
export type MediaArtifact = z.infer<typeof mediaArtifactSchema>;
