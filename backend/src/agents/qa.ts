import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gatewayExecute } from '../gateway/gateway.js';
import { callOmniRouteVision, qaStubEnabled, VISION_MODEL } from '../gateway/vision.js';
import type { GatewayUsage } from '../gateway/types.js';
import {
  qaIssueSchema,
  qaVerdictSchema,
  type QaChecklist,
  type QaIssue,
  type QaReviewScope,
  type QaVerdict,
  type ProductionPlan,
} from './contracts.js';
import type { AssetsManifest } from './visual.js';
import type { VoiceManifest } from './voice.js';
import type { FinalVideoManifest } from './assembly.js';

/**
 * QA Agent (Phase 8) — the final quality gate. Reviews the ACTUAL assembled
 * video (FinalVideoManifest composition data) plus its media files, not just
 * the text plan:
 *
 *   1. Determining technical QA (pure, offline): duration vs plan, resolution,
 *      vertical 9:16, per-scene audio, subtitles, clip/poster files, timeline
 *      continuity, metadata completeness.
 *   2. Plan-consistency QA (pure): scene duration sum vs total, unique ids,
 *      narration present.
 *   3. Live model passes (gated by OMNIROUTE_QA_STUB=0):
 *        - plan review (quality.review, text) -> coherence/continuity/
 *          appropriateness/metadata findings
 *        - vision review (auto/vision via gateway/vision.ts) over the actual
 *          scene stills -> visual errors / character consistency
 *
 * Honest stub (D-15 pattern): by default (stub on) the verdict is
 * deterministic and technical-only; `reviewScope` + `summary` make transparent
 * what was actually checked. Live vision stays UNPROVEN until a real
 * round-trip succeeds against a running gateway.
 */

export interface QaInput {
  plan: ProductionPlan;
  scriptTitle?: string;
  contentId?: string;
  /** Latest `video` artifact (FinalVideoManifest), if assembly ran. */
  video?: FinalVideoManifest | null;
  /** Latest `assets` manifest (per-scene stills), if visual ran. */
  assets?: AssetsManifest | null;
  /** Latest `voice` manifest (per-scene audio), if voice ran. */
  voice?: VoiceManifest | null;
}

export interface QaOutput {
  verdict: QaVerdict;
  usage: GatewayUsage;
  model: string;
  provider: string;
}

/** Media access seam — injected in tests for hermetic file checks. */
export interface QaFileSystem {
  contentDir(contentId: string): string;
  exists(abs: string): boolean;
  readBytes(abs: string): Buffer | null;
}

const ASSETS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');

export const defaultQaFileSystem: QaFileSystem = {
  contentDir: (contentId) => join(ASSETS_ROOT, contentId),
  exists: (abs) => existsSync(abs),
  readBytes: (abs) => {
    try {
      return readFileSync(abs);
    } catch {
      return null;
    }
  },
};

const KNOWN_CLIP_MIME = new Set(['image/gif', 'video/mp4', 'video/webm', 'video/quicktime']);
const KNOWN_CATEGORIES = new Set([
  'duration',
  'resolution',
  'format',
  'audio',
  'subtitles',
  'visual',
  'continuity',
  'coherence',
  'appropriateness',
  'metadata',
  'structure',
  'pacing',
  'hook',
  'other',
]);
/** Allowed relative path segments inside a content asset dir. */
const PATH_RE = /^[\w.\- ]+(\/[\w.\- ]+)?$/;
const EPS = 0.05;

function emptyChecklist(): QaChecklist {
  return {
    duration_ok: null,
    resolution_ok: null,
    vertical_9_16: null,
    audio_clean: null,
    subtitles_present: null,
    clips_ok: null,
    visuals_clean: null,
    continuity_ok: null,
    coherence_ok: null,
    appropriateness_ok: null,
    metadata_complete: null,
  };
}

function issue(
  severity: QaIssue['severity'],
  category: string,
  message: string,
  extra: Partial<QaIssue> = {},
): QaIssue {
  return qaIssueSchema.parse({
    severity,
    category: KNOWN_CATEGORIES.has(category) ? category : 'other',
    message,
    ...extra,
  });
}

function resolve(rel: string, ok: boolean): string | null {
  return ok && PATH_RE.test(rel) ? rel.trim() : null;
}

interface TechnicalQa {
  issues: QaIssue[];
  checklist: QaChecklist;
}

/** Checks that can be run even with no video artifact (plan-only review). */
export function runPlanQa(plan: ProductionPlan): { issues: QaIssue[]; checklist: QaChecklist } {
  const issues: QaIssue[] = [];
  const checklist = emptyChecklist();

  const scenes = plan.scenes ?? [];
  const metaComplete = Boolean(plan.title?.trim()) && Boolean(plan.targetAge?.trim()) && scenes.length > 0;
  checklist.metadata_complete = metaComplete;
  if (!metaComplete) {
    issues.push(
      issue('medium', 'metadata', 'Production plan is missing title, target age, or scenes.', {
        suggestedFix: 'Revise the plan via the Director (director step).',
        autoFixable: true,
      }),
    );
  }

  const ids = new Set<string>();
  for (const s of scenes) {
    if (!s.id) {
      issues.push(issue('high', 'structure', 'A scene has no id.', { location: s.id, autoFixable: true }));
    } else if (ids.has(s.id)) {
      issues.push(
        issue('high', 'structure', `Duplicate scene id "${s.id}".`, {
          location: s.id,
          suggestedFix: 'Revise the plan via the Director (director step).',
          autoFixable: true,
        }),
      );
    }
    ids.add(s.id);
  }

  const sum = scenes.reduce((a, s) => a + (Number(s.durationSeconds) || 0), 0);
  const total = Number(plan.totalDurationSeconds) || 0;
  if (total > 0 && Math.abs(sum - total) / total > 0.1) {
    issues.push(
      issue('medium', 'duration', `Scene durations sum (${sum}s) does not match plan total (${total}s).`, {
        location: 'plan',
        suggestedFix: 'Revise the plan via the Director (director step).',
        autoFixable: true,
      }),
    );
    checklist.duration_ok = false;
  } else if (total > 0) {
    checklist.duration_ok = true;
  }

  const missingNarration = scenes.filter((s) => !(s.narration ?? '').trim());
  if (missingNarration.length > 0) {
    issues.push(
      issue('medium', 'subtitles', `${missingNarration.length} scene(s) have no narration (no subtitle cue possible).`, {
        location: missingNarration.map((s) => s.id).join(','),
        suggestedFix: 'Revise the plan via the Director (director step).',
        autoFixable: true,
      }),
    );
    checklist.subtitles_present = false;
  } else if (scenes.length > 0) {
    checklist.subtitles_present = true;
  }

  return { issues, checklist };
}

/** Media-level checks against the assembled video + manifests (offline, deterministic). */
export function runMediaQa(input: QaInput, fs: QaFileSystem = defaultQaFileSystem): TechnicalQa {
  const issues: QaIssue[] = [];
  const checklist = emptyChecklist();

  const { plan, video, assets, voice, contentId } = input;
  const dir = contentId ? fs.contentDir(contentId) : null;

  if (!video || !Array.isArray(video.scenes) || video.scenes.length === 0) {
    issues.push(
      issue('high', 'visual', 'No assembled video to review — assembly must run before QA.', {
        location: 'video',
        suggestedFix: 'Re-run the Assembly step (assembly step).',
        autoFixable: true,
      }),
    );
    checklist.clips_ok = false;
    checklist.visuals_clean = false;
    checklist.duration_ok = false;
    checklist.resolution_ok = false;
    checklist.vertical_9_16 = false;
    checklist.audio_clean = false;
    checklist.subtitles_present = false;
    checklist.continuity_ok = false;
    return { issues, checklist };
  }

  // Duration: video vs plan total (±10%).
  const planTotal = Number(plan.totalDurationSeconds) || 0;
  const drift = planTotal > 0 ? Math.abs((video.durationSec ?? 0) - planTotal) / planTotal : 1;
  const durationOk = planTotal > 0 && drift <= 0.1;
  checklist.duration_ok = durationOk;
  if (!durationOk) {
    issues.push(
      issue('medium', 'duration', `Assembled duration (${video.durationSec ?? 0}s) differs from plan total (${planTotal}s) by >10%.`, {
        location: 'timeline',
        suggestedFix: 'Re-run Assembly or revise the plan via the Director (assembly step).',
        autoFixable: true,
      }),
    );
  }

  // Resolution + vertical 9:16.
  const m = /^(\d+)x(\d+)$/.exec(video.resolution ?? '');
  const w = m ? Number(m[1]) : 0;
  const h = m ? Number(m[2]) : 0;
  const resolutionOk = m !== null && w >= 360 && h >= 480;
  checklist.resolution_ok = resolutionOk;
  if (!resolutionOk) {
    issues.push(
      issue('medium', 'resolution', `Resolution "${video.resolution}" is below the minimum viable (≥360x480).`, {
        location: 'video',
        suggestedFix: 'Fix the video size config and re-run Assembly (assembly step).',
        autoFixable: false,
      }),
    );
  }
  const ratio = w > 0 && h > 0 ? w / h : 0;
  const verticalOk = ratio > 0 && Math.abs(ratio - 9 / 16) < 0.05 && video.aspectRatio === '9:16';
  checklist.vertical_9_16 = verticalOk;
  if (!verticalOk) {
    issues.push(
      issue('medium', 'format', `Not vertical 9:16 (aspect ${video.aspectRatio ?? 'n/a'}, ${video.resolution ?? 'n/a'}).`, {
        location: 'video',
        autoFixable: false,
      }),
    );
  }

  // Audio: every plan scene has a voice clip with a positive duration, file present.
  const voiceByScene = new Map((voice?.scenes ?? []).map((s) => [s.sceneId, s]));
  let audioOk = true;
  for (const sc of plan.scenes ?? []) {
    const v = voiceByScene.get(sc.id);
    if (!v) {
      audioOk = false;
      issues.push(
        issue('medium', 'audio', `No narration audio for scene "${sc.id}".`, {
          location: sc.id,
          suggestedFix: 'Re-run the Voice step (voice step).',
          autoFixable: true,
        }),
      );
      continue;
    }
    if (!(Number(v.durationSeconds) > 0)) {
      audioOk = false;
      issues.push(issue('medium', 'audio', `Voice clip for "${sc.id}" has no duration.`, { location: sc.id, autoFixable: true }));
    }
    const rel = resolve(v.file, true);
    if (dir && rel && !fs.exists(join(dir, 'audio', rel))) {
      audioOk = false;
      issues.push(
        issue('medium', 'audio', `Voice file missing on disk: audio/${rel}`, {
          location: sc.id,
          suggestedFix: 'Re-run the Voice step (voice step).',
          autoFixable: true,
        }),
      );
    }
  }
  checklist.audio_clean = audioOk;

  // Subtitles: subtitleFile present + every scene has non-empty narration.
  let subsOk = Boolean(video.subtitleFile?.trim());
  const subRel = resolve(video.subtitleFile ?? '', subsOk);
  if (subsOk && dir && subRel && !fs.exists(join(dir, 'assembly', subRel))) {
    subsOk = false;
    issues.push(
      issue('medium', 'subtitles', `Subtitle file missing on disk: assembly/${subRel}`, {
        location: 'subtitles',
        suggestedFix: 'Re-run the Assembly step (assembly step).',
        autoFixable: true,
      }),
    );
  }
  const noNarration = (plan.scenes ?? []).filter((s) => !(s.narration ?? '').trim());
  if (noNarration.length > 0) {
    subsOk = false;
    issues.push(
      issue('medium', 'subtitles', `${noNarration.length} scene(s) lack narration (no cue).`, {
        location: noNarration.map((s) => s.id).join(','),
        autoFixable: true,
      }),
    );
  }
  checklist.subtitles_present = subsOk;

  // Clips + poster: files exist, known MIME, non-empty.
  let clipsOk = true;
  for (const s of video.scenes) {
    const hasMeta = Boolean(s.clipFile) && KNOWN_CLIP_MIME.has(s.clipMime ?? '') && Number(s.clipBytes) > 0;
    if (!hasMeta) {
      clipsOk = false;
      issues.push(
        issue('medium', 'visual', `Scene "${s.sceneId}" clip is missing/invalid (mime ${s.clipMime ?? 'n/a'}, ${s.clipBytes ?? 0}B).`, {
          location: s.sceneId,
          suggestedFix: 'Re-run the Assembly step (assembly step).',
          autoFixable: true,
        }),
      );
      continue;
    }
    const rel = resolve(s.clipFile, true);
    if (dir && rel && !fs.exists(join(dir, 'assembly', rel))) {
      clipsOk = false;
      issues.push(
        issue('medium', 'visual', `Clip file missing on disk: assembly/${rel}`, {
          location: s.sceneId,
          suggestedFix: 'Re-run the Assembly step (assembly step).',
          autoFixable: true,
        }),
      );
    }
  }
  if (video.poster) {
    const rel = resolve(video.poster, true);
    if (dir && rel && !fs.exists(join(dir, rel))) {
      clipsOk = false;
      issues.push(
        issue('low', 'visual', `Poster missing on disk: ${rel}`, {
          suggestedFix: 'Re-run the Assembly step (assembly step).',
          autoFixable: true,
        }),
      );
    }
  }
  checklist.clips_ok = clipsOk;

  // Continuity: monotonic scene windows covering [0, duration] with no gaps.
  const sorted = [...video.scenes].sort((a, b) => a.startSec - b.startSec);
  let contOk = sorted.length > 0;
  if (sorted[0] && sorted[0].startSec > EPS) {
    contOk = false;
    issues.push(issue('medium', 'continuity', `Timeline starts at ${sorted[0].startSec}s instead of 0.`, { location: 'timeline' }));
  }
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const nxt = sorted[i + 1];
    if (cur.endSec <= cur.startSec) {
      contOk = false;
      issues.push(issue('medium', 'continuity', `Scene "${cur.sceneId}" window is empty (${cur.startSec}s–${cur.endSec}s).`, { location: cur.sceneId }));
    }
    if (nxt && Math.abs(nxt.startSec - cur.endSec) > EPS) {
      contOk = false;
      issues.push(
        issue('medium', 'continuity', `Timeline not contiguous at scene "${cur.sceneId}" (ends ${cur.endSec}s, next starts ${nxt.startSec}s).`, {
          location: cur.sceneId,
        }),
      );
    }
  }
  const lastEnd = sorted[sorted.length - 1]?.endSec ?? 0;
  if (Math.abs(lastEnd - (video.durationSec ?? 0)) > EPS) {
    contOk = false;
    issues.push(
      issue('medium', 'continuity', `Timeline ends at ${lastEnd}s but video duration is ${video.durationSec ?? 0}s.`, {
        location: 'timeline',
      }),
    );
  }
  checklist.continuity_ok = contOk;

  return { issues, checklist };
}

/** Destructive merge — keep non-null resolved values, add failed flags. */
function mergeChecklist(target: QaChecklist, src: Partial<QaChecklist>): void {
  for (const k of Object.keys(src) as (keyof QaChecklist)[]) {
    const v = src[k];
    if (v === true) target[k] = target[k] === false ? false : true;
    else if (v === false) target[k] = false;
    // null leaves existing value untouched (dimension not checked this pass)
  }
}

function scoreFromIssues(issues: QaIssue[]): number {
  let s = 1;
  for (const i of issues) {
    const hit = i.severity === 'high' ? 0.3 : i.severity === 'medium' ? 0.12 : 0.04;
    s -= hit;
  }
  return Math.round(Math.max(0, Math.min(1, s)) * 100) / 100;
}

const PLAN_REVIEW_SCHEMA_HINT =
  '{"status":"approved|rejected","score":0.0,"issues":[{"severity":"low|medium|high","category":"string","message":"string","location":"string"}]}';

interface PlanReviewResult {
  issues: QaIssue[];
  usage: GatewayUsage;
  model: string;
  provider: string;
}

/** Live LLM plan review (coherence/continuity/appropriateness/metadata). */
async function livePlanReview(plan: ProductionPlan, scriptTitle?: string): Promise<PlanReviewResult> {
  const r = await gatewayExecute<{ status?: string; issues?: QaIssue[] }>({
    task: 'quality.review',
    tier: 'cheap',
    system:
      "You are a QA reviewer for children's vertical short videos (YouTube Shorts/Reels). Review the production plan and narration for: scene-to-scene continuity, story coherence, age-appropriateness and brand safety for young children, and metadata completeness. Return issues only for real problems; do not nitpick intentional stylistic choices. High-severity issues are blocking.",
    messages: [
      {
        role: 'user',
        content: `Title: ${scriptTitle ?? plan.title ?? ''}\nReview this ProductionPlan (keep scenes' narration in mind) and return a verdict:\n${JSON.stringify(plan, null, 2)}`,
      },
    ],
    json: true,
    schemaHint: PLAN_REVIEW_SCHEMA_HINT,
    temperature: 0.2,
  });

  const issues: QaIssue[] = [];
  for (const raw of (r.data?.issues ?? []).slice(0, 12)) {
    try {
      issues.push(
        qaIssueSchema.parse({
          severity: raw.severity,
          category: raw.category ?? 'other',
          message: raw.message,
          location: raw.location,
        }),
      );
    } catch {
      /* drop malformed model rows */
    }
  }
  return { issues, usage: r.usage, model: r.model, provider: r.provider };
}

interface VisionReview {
  issues: QaIssue[];
  visualsClean: boolean;
  /** Whether the model actually inspected images (false when no stills existed). */
  ran: boolean;
  usage: GatewayUsage;
  model: string;
  provider: string;
}

/** Live vision pass over the actual scene stills (auto/vision). */
async function liveVisionReview(input: QaInput, fs: QaFileSystem): Promise<VisionReview> {
  const { video, assets, contentId } = input;
  const dir = contentId ? fs.contentDir(contentId) : null;
  const images: { bytes: Buffer; mime: string }[] = [];

  if (dir) {
    const seen = new Set<string>();
    for (const s of assets?.scenes ?? []) {
      const rel = resolve(s.file, true);
      if (!rel || seen.has(rel)) continue;
      seen.add(rel);
      const bytes = fs.readBytes(join(dir, rel));
      if (bytes && bytes.length > 0) images.push({ bytes, mime: s.mime ?? 'image/png' });
    }
    if (video?.poster) {
      const rel = resolve(video.poster, true);
      if (rel && !seen.has(rel)) {
        const bytes = fs.readBytes(join(dir, rel));
        if (bytes && bytes.length > 0) images.push({ bytes, mime: 'image/png' });
      }
    }
  }

  if (images.length === 0) {
    return {
      issues: [issue('low', 'visual', 'No scene stills were available for visual QA.', { autoFixable: true })],
      visualsClean: false,
      ran: false,
      usage: { tokensIn: 0, tokensOut: 0, requests: 0, costEur: 0 },
      model: 'n/a',
      provider: 'omniroute',
    };
  }

  const system =
    'You are a visual QA reviewer for children\'s vertical 9:16 short videos. ' +
    'Each image is one scene still. Check for: visual errors/glitches, character appearance consistency across scenes, inappropriate or unsafe content for young children, and stills that contradict the narration intent. ' +
    'Respond with ONLY a JSON object: {"issues":[{"severity":"low|medium|high","category":"visual|continuity|appropriateness","message":"...","location":"scene id or poster"}]}. If clean, return {"issues":[]}.';
  const prompt = `Scene stills of the video "${input.plan.title}". Return the JSON verdict above.`;

  const r = await callOmniRouteVision({
    model: VISION_MODEL,
    system,
    prompt,
    images,
    temperature: 0.2,
  });

  const issues: QaIssue[] = [];
  let parsed: { issues?: unknown[] } = {};
  try {
    const start = r.text.indexOf('{');
    if (start !== -1) {
      let depth = 0;
      for (let i = start; i < r.text.length; i++) {
        if (r.text[i] === '{') depth++;
        else if (r.text[i] === '}') {
          depth--;
          if (depth === 0) {
            parsed = JSON.parse(r.text.slice(start, i + 1));
            break;
          }
        }
      }
    }
  } catch {
    parsed = {};
  }
  for (const raw of (parsed.issues ?? []).slice(0, 12) as Record<string, unknown>[]) {
    try {
      issues.push(
        qaIssueSchema.parse({
          severity: raw.severity,
          category: raw.category ?? 'visual',
          message: raw.message,
          location: raw.location,
        }),
      );
    } catch {
      /* drop malformed rows */
    }
  }

  return {
    issues,
    visualsClean: issues.length === 0,
    ran: true,
    usage: r.usage,
    model: r.model,
    provider: r.provider,
  };
}

function buildSummary(scope: QaReviewScope, issues: QaIssue[]): string {
  const parts = ['Deterministic technical checks run.'];
  if (scope.planConsistency) parts.push('Plan consistency checked.');
  if (scope.plan) parts.push('LLM plan review (coherence/continuity/appropriateness) run.');
  if (scope.vision) parts.push('Vision review run over the scene stills.');
  else if (!qaStubEnabled()) parts.push('Vision review skipped (no stills available).');
  if (!scope.plan && !scope.vision) {
    parts.push('Model review disabled (OMNIROUTE_QA_STUB=1) — verdict is technical-only.');
  }
  const n = issues.length;
  const high = issues.filter((i) => i.severity === 'high').length;
  parts.push(
    n === 0
      ? 'No issues found.'
      : `${n} issue(s) found (${high} blocking).`,
  );
  return parts.join(' ');
}

async function liveModelPasses(
  input: QaInput,
  fs: QaFileSystem,
): Promise<{
  issues: QaIssue[];
  checklist: QaChecklist;
  scope: QaReviewScope;
  usage: GatewayUsage;
  model: string;
  provider: string;
}> {
  const scope: QaReviewScope = { technical: true, planConsistency: true, plan: true, vision: false };
  const checklist = emptyChecklist();
  const issues: QaIssue[] = [];

  const planReview = await livePlanReview(input.plan, input.scriptTitle);
  issues.push(...planReview.issues);
  const hasCoherence = planReview.issues.some((i) => i.category === 'coherence' && i.severity !== 'low');
  const hasAppropriateness = planReview.issues.some((i) => i.category === 'appropriateness' && i.severity !== 'low');
  checklist.coherence_ok = !hasCoherence;
  checklist.appropriateness_ok = !hasAppropriateness;

  const vision = await liveVisionReview(input, fs);
  scope.vision = vision.ran;
  issues.push(...vision.issues);
  checklist.visuals_clean = vision.ran ? vision.visualsClean : null;

  return {
    issues,
    checklist,
    scope,
    usage: {
      tokensIn: planReview.usage.tokensIn + vision.usage.tokensIn,
      tokensOut: planReview.usage.tokensOut + vision.usage.tokensOut,
      requests: planReview.usage.requests + vision.usage.requests,
      costEur: planReview.usage.costEur + vision.usage.costEur,
    },
    model: vision.model !== 'n/a' ? vision.model : planReview.model,
    provider: vision.provider !== 'n/a' ? vision.provider : planReview.provider,
  };
}

export async function qaAgent(input: QaInput, fs: QaFileSystem = defaultQaFileSystem): Promise<QaOutput> {
  const plan = input.plan;

  const planQa = runPlanQa(plan);
  const mediaQa = runMediaQa(input, fs);
  const issues = [...planQa.issues, ...mediaQa.issues];
  const checklist: QaChecklist = { ...mediaQa.checklist };
  mergeChecklist(checklist, planQa.checklist);

  let usage: GatewayUsage = { tokensIn: 0, tokensOut: 0, requests: 0, costEur: 0 };
  let model = 'stub';
  let provider = 'stub';

  if (!qaStubEnabled()) {
    const live = await liveModelPasses(input, fs);
    issues.push(...live.issues);
    mergeChecklist(checklist, live.checklist);
    usage = live.usage;
    model = live.model;
    provider = live.provider;
  }

  const scope: QaReviewScope = {
    technical: true,
    planConsistency: true,
    plan: !qaStubEnabled(),
    vision: !qaStubEnabled(),
  };

  const score = scoreFromIssues(issues);
  const status = issues.some((i) => i.severity === 'high') ? 'rejected' : score >= 0.7 ? 'approved' : 'rejected';

  const verdict = qaVerdictSchema.parse({
    status,
    score,
    issues,
    checklist,
    reviewScope: scope,
    summary: buildSummary(scope, issues),
  });

  return { verdict, usage, model, provider };
}