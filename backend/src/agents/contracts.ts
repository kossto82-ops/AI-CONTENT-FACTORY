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

/** Severity levels; `high` forces a rejection regardless of the average score. */
export const qaIssueSchema = z.object({
  severity: z.enum(['low', 'medium', 'high']),
  category: z.string(), // duration | resolution | format | audio | subtitles | visual | continuity | coherence | appropriateness | metadata | structure | other
  message: z.string(),
  /** Scene id / timestamp / section the issue refers to (optional). */
  location: z.string().optional(),
  /** What should change and which agent should do it (optional). */
  suggestedFix: z.string().optional(),
  /** Whether the orchestrator can fix it by re-running an agent (optional). */
  autoFixable: z.boolean().optional(),
});
export type QaIssue = z.infer<typeof qaIssueSchema>;

/**
 * Result checklist for the Phase 8 review matrix. `null` = the dimension was
 * NOT checked this run (e.g. vision-dependent checks when the model pass was
 * skipped); `true`/`false` = checked and passed/failed.
 */
export const qaChecklistSchema = z.object({
  duration_ok: z.boolean().nullable(),
  resolution_ok: z.boolean().nullable(),
  vertical_9_16: z.boolean().nullable(),
  audio_clean: z.boolean().nullable(),
  subtitles_present: z.boolean().nullable(),
  clips_ok: z.boolean().nullable(),
  visuals_clean: z.boolean().nullable(),
  continuity_ok: z.boolean().nullable(),
  coherence_ok: z.boolean().nullable(),
  appropriateness_ok: z.boolean().nullable(),
  metadata_complete: z.boolean().nullable(),
  beat_structure_ok: z.boolean().nullable(),
});
export type QaChecklist = z.infer<typeof qaChecklistSchema>;

/** Which review dimensions actually ran (transparency; stub runs skip model passes). */
export const qaReviewScopeSchema = z.object({
  technical: z.boolean(), // deterministic file/timeline/media checks
  planConsistency: z.boolean(), // plan-internal consistency (data only)
  plan: z.boolean(), // live LLM review of the plan/narration
  vision: z.boolean(), // live vision pass over the actual images
});
export type QaReviewScope = z.infer<typeof qaReviewScopeSchema>;

export const qaVerdictSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  score: z.number(),
  issues: z.array(qaIssueSchema),
  checklist: qaChecklistSchema.optional(),
  reviewScope: qaReviewScopeSchema.optional(),
  /** 2-4 sentence overall assessment for the operator. */
  summary: z.string().optional(),
});
export type QaVerdict = z.infer<typeof qaVerdictSchema>;

/**
 * Phase 9 Publisher — rich publish metadata + logical publication (Decision
 * D-17). Includes everything a platform publishes for a Short: title,
 * description, hashtags, web accessibility (aria) label, and the thumbnail URI
 * (the assembly poster, served via `GET /api/assets/{contentId}/{poster}`).
 */
export const publishPackageSchema = z.object({
  status: z.enum(['SCHEDULED', 'PUBLISHED']),
  title: z.string(),
  description: z.string(),
  hashtags: z.array(z.string()),
  accessibilityLabel: z.string(),
  thumbnailUri: z.string(),
  /** Platform/consumer the media was prepared for (not a real upload in MVP). */
  target: z.enum(['LocalExport', 'YouTube', 'Instagram']),
  /** ISO timestamp; when non-null the package is scheduled. No runner executes it. */
  scheduledAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  version: z.number(),
});
export type PublishPackage = z.infer<typeof publishPackageSchema>;

/** Resolves a content thumbnail URI for the publish package (served by the asset route). */
export type AssetUriResolver = (contentId: string) => string;

/**
 * Channel configuration (Decision: multi-channel). A channel is a first-class
 * entity (table `channel`) that parameters the creative agents. Content
 * references a channel by `channel_id`; a channel whose `config` is NULL or
 * absent falls back to `DEFAULT_CHANNEL_CONFIG`. Because every field is data,
 * duplicating a channel = copying its config JSON and changing name/character.
 */
export const channelBeatSchema = z.object({
  name: z.string(), // e.g. "Hook"
  start: z.number(), // seconds (inclusive)
  end: z.number(), // seconds (exclusive)
  description: z.string(), // what happens + hook/CTA guidance
});
export type ChannelBeat = z.infer<typeof channelBeatSchema>;

export const channelConfigSchema = z.object({
  audience: z
    .object({
      targetAge: z.string().default('4-7'), // e.g. "3-8"
      language: z.string().default('global'),
      languageIndependent: z.boolean().default(true), // retention via audio + visual, no language barrier
    })
    .default({ targetAge: '4-7', language: 'global', languageIndependent: true }),
  format: z
    .object({
      defaultDurationSec: z.number().default(15), // script duration; 30 optional per content
      structure: z.string().default('hook-caos-cta'),
      beats: z.array(channelBeatSchema).default([
        { name: 'Hook', start: 0, end: 3, description: 'character finds a mysterious object / bright box / makes an absurd mistake' },
        { name: 'Chaos', start: 3, end: 11, description: 'problem escalates with cartoon SFX (boing, pop, fast laughter)' },
        { name: 'CTA', start: 11, end: 15, description: 'exaggerated reaction + perfect loop inviting rewatch' },
      ]),
    })
    .default({
      defaultDurationSec: 15,
      structure: 'hook-caos-cta',
      beats: [
        { name: 'Hook', start: 0, end: 3, description: 'mystery object / bright box / absurd mistake' },
        { name: 'Chaos', start: 3, end: 11, description: 'escalation with cartoon SFX (boing, pop, laughter)' },
        { name: 'CTA', start: 11, end: 15, description: 'exaggerated reaction + perfect loop' },
      ],
    }),
  visualStyle: z
    .object({
      style: z.string().default("children's cartoon"),
      characterDescription: z.string().default(''),
    })
    .default({ style: "children's cartoon", characterDescription: '' }),
  rhythm: z
    .object({
      postsPerDay: z.string().default('2-3'),
      pacingWordsPerSec: z.number().default(2.8),
    })
    .default({ postsPerDay: '2-3', pacingWordsPerSec: 2.8 }),
  promptOverrides: z
    .object({
      research: z.string().default(''),
      script: z.string().default(''),
      director: z.string().default(''),
      visual: z.string().default(''),
    })
    .default({ research: '', script: '', director: '', visual: '' }),
});
export type ChannelConfig = z.infer<typeof channelConfigSchema>;

/** Fallback used when content has no channel or the channel has no config. */
export const DEFAULT_CHANNEL_CONFIG: ChannelConfig = channelConfigSchema.parse({});

/** Per-agent prompt hint derived from a channel config (null-safe). */
export function channelPromptOverride(cfg: ChannelConfig | undefined, agent: string): string {
  const o = cfg?.promptOverrides;
  if (!o) return '';
  return o[agent as keyof typeof o] ?? '';
}
