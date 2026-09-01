import { z } from 'zod';

/**
 * Structured contracts (Section 4). Every agent produces/consumes these exact
 * shapes. Versioning is handled at the artifact layer, not here.
 */

export const ideaSchema = z.object({
  title: z.string(),
  concept: z.string(),
  target_age: z.string(),
  format: z.string(),
  hook: z.string(),
  reason: z.string(),
  score: z.number(),
});
export type Idea = z.infer<typeof ideaSchema>;

export const ideaListSchema = z.object({
  ideas: z.array(ideaSchema),
});
export type IdeaList = z.infer<typeof ideaListSchema>;

export const sceneSchema = z.object({
  id: z.string(),
  durationSeconds: z.number(),
  characters: z.array(z.string()),
  location: z.string(),
  action: z.string(),
  camera: z.string(),
  emotion: z.string(),
  narration: z.string(),
});
export type Scene = z.infer<typeof sceneSchema>;

export const scriptSchema = z.object({
  title: z.string(),
  concept: z.string(),
  hook: z.string(),
  targetAge: z.string(),
  structure: z.string(),
  narration: z.string(),
  dialogues: z.array(z.string()),
  ending: z.string(),
  cta: z.string().optional(),
  scenes: z.array(sceneSchema),
});
export type Script = z.infer<typeof scriptSchema>;

export const productionPlanSchema = z.object({
  title: z.string(),
  targetAge: z.string(),
  totalDurationSeconds: z.number(),
  scenes: z.array(sceneSchema),
  visualStyle: z.string(),
});
export type ProductionPlan = z.infer<typeof productionPlanSchema>;

export const qaVerdictSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  score: z.number(),
  issues: z.array(
    z.object({
      severity: z.enum(['low', 'medium', 'high']),
      category: z.string(),
      message: z.string(),
    }),
  ),
});
export type QaVerdict = z.infer<typeof qaVerdictSchema>;
