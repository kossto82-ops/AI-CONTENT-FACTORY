import { ideaSchema, type Idea, type ProductionPlan } from './contracts.js';
import { computeAnalytics, type AnalyticsInput, type AnalyticsResult } from './analytics.js';

/**
 * Learning Agent (Phase 11). Deterministic, no gateway.
 *
 * There are no external engagement metrics in this project (publication is
 * logical, Decision D-17), so "learn from results" can only mean learning
 * from the INTERNAL operational record — exactly the signals Analytics
 * already aggregates (Decision D-18). This agent is therefore a pure function
 * over the analytics input: it derives
 *
 *   1. LESSONS   — structural patterns worth remembering (per-agent cost
 *                  concentration, pipeline throughput, QA issues that recur).
 *   2. IDEAS     — concrete content proposals. To stay grounded in evidence,
 *                  each idea is a VARIATION of a production plan that already
 *                  passed QA (or reached approval/publication) — the plan is
 *                  mutated deterministically (title/hook/format tweaks) so the
 *                  result is provable-by-diff, not invented from a blank page.
 *   3. RECOMMENDATIONS — actionable strategy items (tier bump for the costliest
 *                  agent, revisit a recurring QA issue category, scheduler
 *                  when a review gate is idle), each with priority + reason.
 *
 * Everything is pure and offline-testable (no DB, no gateway). The server
 * owns the SQL reads and persistence; like Analytics it is NOT a per-content
 * pipeline step (it aggregates across the whole content corpus).
 */

// ---------------- Input ----------------

/** A production plan with enough provenance to learn from it. */
export interface LearningPlanSource {
  contentId: string;
  plan: ProductionPlan;
  /** Best QA score observed for this content (for approved ideas). */
  qaScore: number;
  /** Thumbnail/format metadata of the originating content (for variations). */
  format: string | null;
  targetAge: string | null;
  /** Lower economic total for this content: cost of a producer-quality run. */
  totalCostEur: number;
}

export interface LearningInput extends AnalyticsInput {
  /** Production plans of eligible content (any content with a plan). */
  plans: LearningPlanSource[];
}

// ---------------- Output ----------------

export interface Lesson {
  id: string;
  kind: 'cost' | 'qa' | 'throughput' | 'publish' | 'pattern';
  severity: 'high' | 'medium' | 'low';
  title: string;
  body: string;
}

export interface LearnedIdea {
  id: string;
  sourceContentId: string;
  sourceTitle: string;
  sourceQaScore: number;
  variation: string;
  idea: Idea;
}

export interface Recommendation {
  id: string;
  action: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  target: string;
}

export interface LearningResult {
  generatedAt: string;
  lessons: Lesson[];
  ideas: LearnedIdea[];
  recommendations: Recommendation[];
}

// ---------------- Helpers ----------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function fmtEur(n: number): string {
  return `€${round2(n).toFixed(2)}`;
}

function fmtMinSec(sec: number): string {
  const m = Math.floor(sec / 60);
  return m > 0 ? `${m}m ${Math.round(sec % 60)}s` : `${Math.round(sec)}s`;
}

function topN<T>(items: T[], n: number): T[] {
  return items.slice(0, n);
}

// ---------------- Lessons ----------------

function buildLessons(a: AnalyticsResult, plans: LearningPlanSource[]): Lesson[] {
  const lessons: Lesson[] = [];
  const total = a.totals.costEur;
  const jobs = a.totals.jobs;

  if (total > 0 && jobs > 0) {
    // Costliest agent concentration.
    const [costliest] = [...a.perAgent].sort((x, y) => y.costEur - x.costEur);
    if (costliest && costliest.costEur > 0) {
      const share = (costliest.costEur / total) * 100;
      lessons.push({
        id: 'lesson-costliest-agent',
        kind: 'cost',
        severity: share >= 50 ? 'high' : 'medium',
        title: `Cost concentrated in ${costliest.name}`,
        body: `${costliest.name} is ${Math.round(share)}% of total cost (${fmtEur(costliest.costEur)} of ${fmtEur(total)}).`,
      });
    }
    // Average cost per content.
    if (plans.length > 0) {
      const avg = total / plans.length;
      lessons.push({
        id: 'lesson-avg-cost',
        kind: 'cost',
        severity: avg > 0.5 ? 'medium' : 'low',
        title: 'Average content cost',
        body: `Average ${fmtEur(avg)} per content across ${plans.length} plan(s) (${fmtEur(total)} total).`,
      });
    }
  }

  // QA signal.
  if (a.qa.total > 0) {
    lessons.push({
      id: 'lesson-qa-rate',
      kind: 'qa',
      severity: a.qa.approveRate < 60 ? 'high' : a.qa.approveRate < 80 ? 'medium' : 'low',
      title: `QA approval rate ${a.qa.approveRate}%`,
      body: `${a.qa.approved} of ${a.qa.total} QA runs passed; average score ${a.qa.avgScore.toFixed(2)}.`,
    });
    if (a.qa.topIssueCategories[0]) {
      const top = a.qa.topIssueCategories[0];
      lessons.push({
        id: 'lesson-top-qa-issue',
        kind: 'pattern',
        severity: top.count >= 3 ? 'high' : 'medium',
        title: `Recurring QA issue: ${top.category}`,
        body: `'${top.category}' appeared in ${top.count} verdict(s) — the most common failure pattern.`,
      });
    }
  }

  // Throughput.
  if (a.pipeline.avgPipelineDurationSec > 0) {
    lessons.push({
      id: 'lesson-throughput',
      kind: 'throughput',
      severity: a.pipeline.avgPipelineDurationSec > 600 ? 'medium' : 'low',
      title: 'End-to-end pipeline time',
      body: `Average ${fmtMinSec(a.pipeline.avgPipelineDurationSec)} from content creation to last completed job (${a.pipeline.totalContent} content).`,
    });
  }

  // Publish.
  if (a.publish.total > 0) {
    const pubShare = (a.publish.published / a.publish.total) * 100;
    lessons.push({
      id: 'lesson-publish-rate',
      kind: 'publish',
      severity: pubShare < 50 ? 'medium' : 'low',
      title: `Publication success ${Math.round(pubShare)}%`,
      body: `${a.publish.published} published and ${a.publish.scheduled} scheduled of ${a.publish.total} package(s).`,
    });
  }

  return lessons;
}

// ---------------- Ideas ----------------

/** Deterministic variation mixers over a source plan. */
function buildIdeas(plans: LearningPlanSource[], max = 4): LearnedIdea[] {
  // Order: plans that already passed QA (approved) first, then by best score.
  const eligible = plans
    .filter((p) => p.plan && p.plan.scenes.length > 0)
    .sort((x, y) => {
      const qx = x.qaScore >= 0.7 ? 1 : 0;
      const qy = y.qaScore >= 0.7 ? 1 : 0;
      if (qx !== qy) return qy - qx;
      return y.qaScore - x.qaScore;
    });

  const out: LearnedIdea[] = [];
  const used = new Set<string>();
  for (const src of topN(eligible, max)) {
    for (const [variation, mutate] of VARIATIONS) {
      if (out.length >= max) break;
      const key = `${src.contentId}:${variation}`;
      if (used.has(key)) continue;
      used.add(key);
      const idea = mutate(src);
      if (!idea) continue;
      out.push({
        id: `learned_${variation}_${src.contentId}`,
        sourceContentId: src.contentId,
        sourceTitle: src.plan.title,
        sourceQaScore: src.qaScore,
        variation,
        idea,
      });
    }
  }
  return out;
}

type VariationMutator = (src: LearningPlanSource) => Idea | null;

/**
 * Variation catalogs. Each mutator is deterministic and pure, producing an
 * `Idea` (same schema as the research agent, so it can be fed to the ideation
 * flow / a future "materialize idea" action). Sizes/messages are reused from
 * the source plan; nothing is invented.
 */
const VARIATIONS: [string, VariationMutator][] = [
  [
    'hook',
    (src) => {
      const first = src.plan.scenes[0];
      if (!first) return null;
      return ideaSchema.parse({
        title: src.plan.title.trim(),
        concept: src.plan.scenes.map((s) => s.action).join(' ').slice(0, 400),
        target_age: src.targetAge ?? src.plan.targetAge ?? '5-8',
        format: src.format ?? 'story',
        hook: first.action.slice(0, 200),
        reason: `Derived from plan '${src.plan.title}' (QA ${src.qaScore.toFixed(2)}): strongest opening hook.`,
        score: round2(clamp(src.qaScore > 0 ? src.qaScore : 0.5, 0, 1)),
      });
    },
  ],
  [
    'shorter',
    (src) => {
      // Focus on the first two scenes only => a punchier, shorter cut.
      const sc = src.plan.scenes.slice(0, 2);
      if (!sc.length) return null;
      const total = sc.reduce((s, x) => s + (x.durationSeconds ?? 0), 0);
      const first = sc[0];
      if (!first) return null;
      return ideaSchema.parse({
        title: src.plan.title.trim(),
        concept: `${sc.map((s) => s.action).join(' ')} (concise ${Math.round(total)}s cut)`,
        target_age: src.targetAge ?? src.plan.targetAge ?? '5-8',
        format: src.format ?? 'story',
        hook: first.action.slice(0, 200),
        reason: 'Derived from plan: shorter urgency-focused version of the approved cut.',
        score: round2(clamp(Math.max(0, src.qaScore - 0.05), 0, 1)),
      });
    },
  ],
  [
    'continuation',
    (src) => {
      const last = src.plan.scenes[src.plan.scenes.length - 1];
      if (!last) return null;
      return ideaSchema.parse({
        title: `${src.plan.title.trim()} — continued`,
        concept: `Follows the approved story from its final scene ('${last.action.slice(0, 160)}').`,
        target_age: src.targetAge ?? src.plan.targetAge ?? '5-8',
        format: src.format ?? 'story',
        hook: last.action.slice(0, 200),
        reason: 'Derived from plan: serial continuation after the closing scene.',
        score: round2(clamp(Math.max(0, src.qaScore - 0.03), 0, 1)),
      });
    },
  ],
  [
    'remix',
    (src) => {
      if (src.plan.scenes.length < 2) return null;
      const rev = [...src.plan.scenes].reverse();
      const first = rev[0];
      if (!first) return null;
      return ideaSchema.parse({
        title: `${src.plan.title.trim()} (remix: open on the end)`,
        concept: rev.map((s) => s.action).join(' ').slice(0, 400),
        target_age: src.targetAge ?? src.plan.targetAge ?? '5-8',
        format: src.format ?? 'story',
        hook: first.action.slice(0, 200),
        reason: 'Derived from plan: same scenes, reversed emotional curve for re-plays.',
        score: round2(clamp(Math.max(0, src.qaScore - 0.08), 0, 1)),
      });
    },
  ],
];

// ---------------- Recommendations ----------------

function buildRecommendations(a: AnalyticsResult): Recommendation[] {
  const recs: Recommendation[] = [];

  if (a.perAgent.length > 0 && a.totals.costEur > 0) {
    const [costliest] = [...a.perAgent].sort((x, y) => y.costEur - x.costEur);
    if (costliest && costliest.costEur / a.totals.costEur >= 0.4) {
      recs.push({
        id: 'rec-tier-rebalance',
        action: `Re-route the costliest agent ('${costliest.type}') onto a cheaper routing tier.`,
        reason: `It carries ${Math.round((costliest.costEur / a.totals.costEur) * 100)}% of total cost (${fmtEur(costliest.costEur)}).`,
        priority: 'high',
        target: 'model_registry',
      });
    }
  }

  if (a.qa.total > 0 && a.qa.topIssueCategories[0]) {
    const top = a.qa.topIssueCategories[0];
    recs.push({
      id: 'rec-fix-qa-issue',
      action: `Add an explicit review/handling step for '${top.category}' before the next QA run.`,
      reason: `Most common failure category (${top.count} occurrence(s)).`,
      priority: 'high',
      target: 'pipeline',
    });
  }

  if (a.pipeline.avgPipelineDurationSec > 1200) {
    recs.push({
      id: 'rec-pipeline-flow',
      action: 'Parallelise downstream steps (visual/voice) or raise retry budgets for slow agents.',
      reason: `Average pipeline time is ${fmtMinSec(a.pipeline.avgPipelineDurationSec)}.`,
      priority: 'medium',
      target: 'pipeline',
    });
  }

  if (a.publish.total === 0 && a.pipeline.totalContent > 0) {
    recs.push({
      id: 'rec-review-gates',
      action: 'Check whether approval gates are idling content; approve queued publication candidates.',
      reason: `${a.pipeline.totalContent} content exist but no publish package has been created.`,
      priority: 'medium',
      target: 'approval',
    });
  }

  return recs;
}

// ---------------- Entry point ----------------

/**
 * Compute the learning set (lessons + ideas + recommendations) from raw
 * aggregated rows. Purely derived; offline-testable; the server calls it and
 * persists the result.
 */
export function computeLearning(
  input: LearningInput,
  now: string = new Date().toISOString(),
): LearningResult {
  const a: AnalyticsResult = computeAnalytics(input);
  return {
    generatedAt: now,
    lessons: buildLessons(a, input.plans ?? []),
    ideas: buildIdeas(input.plans ?? []),
    recommendations: buildRecommendations(a),
  };
}