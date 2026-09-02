import type { ProductionPlan, PublishPackage, AssetUriResolver } from './contracts.js';
import { publishPackageSchema } from './contracts.js';

/**
 * Publisher Agent — rich publish metadata + logical publication (Phase 9).
 *
 * There is no hosting/upload stack in this project (Phase 0 audit: no ffmpeg,
 * the "final video" is composition DATA, Decision D-14) and no platform API is
 * configured, so publishing is REFLECTED, not a real upload (Decision D-17):
 * the agent derives title / description / hashtags / accessibility label /
 * thumbnail URI from the ProductionPlan, and the orchestrator flips the content
 * to PUBLISHED (or SCHEDULED when a scheduledAt is supplied). `target` is a
 * logical consumer for traceability (defaults to LocalExport).
 *
 * Like other agents it is deterministic and pure (no gateway call, no binary
 * I/O) so it is fully unit-testable and E2E-provable offline.
 */

/** Titles are 4-7 years old; Shorts titles ≤ 100 chars, hashtags ≤ 3. */
const MAX_TITLE = 100;
const MAX_DESC = 500;
const MAX_TAGS = 3;

function trimCaps(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Build a short-form title from the plan title + the first scene hook. */
export function buildPublishTitle(plan: ProductionPlan, max = MAX_TITLE): string {
  const base = (plan.title || '').trim();
  const hook = trimCaps(plan.scenes[0]?.action ?? '').slice(0, 40);
  const candidates = [base, base ? `${base} | ${hook}` : hook, base && base.length <= max ? base : 'New story short'].filter(
    (t) => t.length > 0 && t.length <= max,
  );
  return (candidates[0] ?? 'New story short').slice(0, max);
}

/** Description: hook sentence + scene count + duration. */
export function buildPublishDescription(plan: ProductionPlan, max = MAX_DESC): string {
  const hook = trimCaps(plan.scenes[0]?.action ?? '');
  const scenes = plan.scenes.length;
  const dur = Math.round(plan.totalDurationSeconds ?? 0);
  const base = `${hook || 'A short story'}. ${scenes} scene(s), about ${dur}s. Built with AI Content Factory.`;
  return trimCaps(base).slice(0, max);
}

/**
 * Hashtags derived from the title + target age + first scene keywords.
 * Compact, uppercase-free, deduplicated, crashes-resistant (never fails).
 */
export function buildHashtags(plan: ProductionPlan, max = MAX_TAGS): string[] {
  const input = [
    plan.title,
    plan.scenes[0]?.action,
    plan.scenes[0]?.location,
    plan.scenes[0]?.characters?.[0],
    `age${plan.targetAge}`,
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((s) => s.length >= 3);

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const word of input) {
    if (seen.has(word)) continue;
    seen.add(word);
    tags.push(word.slice(0, 24));
    if (tags.length >= max) break;
  }
  return tags.length ? tags : ['story'];
}

/** Accessibility label: a spoken alt-text of the final video for screen readers. */
export function buildAccessibilityLabel(plan: ProductionPlan, title: string): string {
  const first = trimCaps(plan.scenes[0]?.action ?? '');
  const scenes = plan.scenes.length;
  return `${title}. An AI-crafted ${scenes} scene short for ages ${plan.targetAge || 'young children'}.${first ? ` Opens with: ${first}.` : ''}`;
}

export interface PublishInput {
  plan: ProductionPlan;
  contentId: string;
  /** ISO timestamp for scheduling. When null, the video publishes immediately. */
  scheduledAt?: string | null;
  /** Logical consumer the media is prepared for (defaults to LocalExport). */
  target?: PublishPackage['target'];
}

export interface PublishOutput {
  package: PublishPackage;
  status: 'SCHEDULED' | 'PUBLISHED';
  costEur: number;
  model: string;
  provider: string;
}

/**
 * Build a publish package deterministically from the plan. The thumbnail is
 * referenced (not uploaded): the assembly poster, served by the asset route.
 */
export function buildPublishPackage(
  input: PublishInput,
  now: string = new Date().toISOString(),
  resolveThumbnailUri: AssetUriResolver = defaultThumbnailUri,
): PublishPackage {
  const plan = input.plan;
  const title = buildPublishTitle(plan);
  const contentId = input.contentId;
  const scheduledAt = input.scheduledAt ?? null;
  const status = scheduledAt ? 'SCHEDULED' : 'PUBLISHED';

  const pkg = publishPackageSchema.parse({
    status,
    title,
    description: buildPublishDescription(plan),
    hashtags: buildHashtags(plan),
    accessibilityLabel: buildAccessibilityLabel(plan, title),
    thumbnailUri: resolveThumbnailUri(contentId),
    target: input.target ?? 'LocalExport',
    scheduledAt,
    publishedAt: scheduledAt ? null : now,
    version: 1,
  });
  return pkg;
}

/** Default thumbnail resolver — the assembly poster served by the asset API. */
export function defaultThumbnailUri(contentId: string): string {
  return `/api/assets/${contentId}/poster.png`;
}

/**
 * Publisher agent entry point (matches other agent signatures: `plan`,
 * `contentId`). Purely derives metadata; content state is flipped by the
 * orchestrator (`advanceContent` to PUBLISHED/SCHEDULED).
 */
export function publisherAgent(input: PublishInput): PublishOutput {
  const pkg = buildPublishPackage(input);
  return {
    package: pkg,
    status: pkg.status,
    costEur: 0,
    model: 'deterministic',
    provider: 'local',
  };
}