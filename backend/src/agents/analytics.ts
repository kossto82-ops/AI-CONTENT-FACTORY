/**
 * Analytics Agent (Phase 10, Decision D-18).
 *
 * Aggregates INTERNAL signals from the running system. There are no external
 * engagement metrics (views/CTR) because publishing is logical/reflected, not a
 * real upload (Decision D-17) — so "performance" here means operational
 * performance: cost, tokens, QA pass/reject, pipeline throughput, content and
 * publication status.
 *
 * The agent is deterministic and PURE: it accepts already-aggregated raw rows
 * (the shape produced by the server's SQL reads) and returns structured KPIs.
 * It never touches the DB or the gateway, so it is fully unit-testable offline.
 * It feeds the Learning Agent in Phase 11.
 */

export interface AnalyticsAgentRow {
  content_id: string | null;
  type: string;
  status: string;
  cost_eur: number;
  tokens_in: number;
  tokens_out: number;
  created_at: string;
  completed_at: string | null;
}

export interface AnalyticsQaVerdict {
  status: 'approved' | 'rejected';
  score: number;
  issues: { severity: 'low' | 'medium' | 'high' | string; category: string }[];
}

export interface AnalyticsPublishPackage {
  status: 'SCHEDULED' | 'PUBLISHED';
  target: string;
}

export interface AnalyticsContent {
  id: string;
  status: string;
  created_at: string;
}

/** Raw, pre-aggregated input for the analytics agent (built by the server). */
export interface AnalyticsInput {
  jobs: AnalyticsAgentRow[];
  qaVerdicts: AnalyticsQaVerdict[];
  publishPackages: AnalyticsPublishPackage[];
  contents: AnalyticsContent[];
}

export interface AgentKpi {
  type: string;
  name: string;
  runs: number;
  completed: number;
  failed: number;
  costEur: number;
  tokensIn: number;
  tokensOut: number;
}

export interface QaKpi {
  total: number;
  approved: number;
  rejected: number;
  approveRate: number;
  avgScore: number;
  /** Issue categories ranked by frequency (most common first). */
  topIssueCategories: { category: string; count: number }[];
}

export interface PublishKpi {
  total: number;
  published: number;
  scheduled: number;
  byTarget: Record<string, number>;
}

export interface PipelineKpi {
  totalContent: number;
  avgPipelineDurationSec: number; // mean of (publish/completed - content.created_at), 0 if none
  byStatus: Record<string, number>;
}

export interface AnalyticsResult {
  generatedAt: string;
  totals: { costEur: number; tokensIn: number; tokensOut: number; jobs: number };
  perAgent: AgentKpi[];
  qa: QaKpi;
  publish: PublishKpi;
  pipeline: PipelineKpi;
}

const AGENT_NAMES: Record<string, string> = {
  research: 'Research / Trend Agent',
  script: 'Story / Script Agent',
  director: 'Director Agent',
  visual: 'Visual / Image Agent',
  voice: 'Voice / Narration Agent',
  assembly: 'Video Assembly Agent',
  qa: 'QA Agent',
  publisher: 'Publisher Agent',
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return round2((part / total) * 100);
}

function countBy<K extends string>(items: K[]): Record<K, number> {
  const acc = {} as Record<K, number>;
  for (const it of items) acc[it] = (acc[it] ?? 0) + 1;
  return acc;
}

/** Aggregate per-agent cost/token/runs KPIs, preserving pipeline order. */
function perAgent(jobs: AnalyticsAgentRow[]): AgentKpi[] {
  const order = ['research', 'script', 'director', 'visual', 'voice', 'assembly', 'qa', 'publisher', 'analytics'];
  const map = new Map<string, AgentKpi>();
  for (const j of jobs) {
    if (!map.has(j.type)) {
      map.set(j.type, {
        type: j.type,
        name: AGENT_NAMES[j.type] ?? j.type,
        runs: 0,
        completed: 0,
        failed: 0,
        costEur: 0,
        tokensIn: 0,
        tokensOut: 0,
      });
    }
    const k = map.get(j.type)!;
    k.runs += 1;
    if (j.status === 'COMPLETED') k.completed += 1;
    if (j.status === 'FAILED') k.failed += 1;
    k.costEur += j.cost_eur ?? 0;
    k.tokensIn += j.tokens_in ?? 0;
    k.tokensOut += j.tokens_out ?? 0;
  }
  return order.filter((t) => map.has(t)).map((t) => map.get(t)!);
}

/** QA pass rate, average score and most frequent issue categories. */
function qaKpi(verdicts: AnalyticsQaVerdict[]): QaKpi {
  const approved = verdicts.filter((v) => v.status === 'approved').length;
  const rejected = verdicts.filter((v) => v.status === 'rejected').length;
  const avgScore = verdicts.length
    ? round2(verdicts.reduce((s, v) => s + (v.score ?? 0), 0) / verdicts.length)
    : 0;
  const catCount: Record<string, number> = {};
  for (const v of verdicts) {
    for (const issue of v.issues) {
      const c = issue.category || 'other';
      catCount[c] = (catCount[c] ?? 0) + 1;
    }
  }
  const topIssueCategories = Object.entries(catCount)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const total = verdicts.length;
  return {
    total,
    approved,
    rejected,
    approveRate: pct(approved, total),
    avgScore,
    topIssueCategories,
  };
}

function publishKpi(packages: AnalyticsPublishPackage[]): PublishKpi {
  const published = packages.filter((p) => p.status === 'PUBLISHED').length;
  const scheduled = packages.filter((p) => p.status === 'SCHEDULED').length;
  const targets = packages.map((p) => p.target || 'LocalExport');
  return {
    total: packages.length,
    published,
    scheduled,
    byTarget: countBy(targets),
  };
}

function pipelineKpi(contents: AnalyticsContent[], jobs: AnalyticsAgentRow[]): PipelineKpi {
  const byStatus = countBy(contents.map((c) => c.status));

  // Mean end-to-end pipeline time per content: from content creation to the
  // latest COMPLETED job timestamp for that same content. Contents with no
  // completed jobs are excluded from the average.
  const durations: number[] = [];
  const completedById = new Map<string, number>();
  for (const j of jobs) {
    if (!j.content_id || j.status !== 'COMPLETED' || !j.completed_at) continue;
    const t = Date.parse(j.completed_at);
    if (Number.isNaN(t)) continue;
    completedById.set(j.content_id, Math.max(completedById.get(j.content_id) ?? 0, t));
  }
  for (const c of contents) {
    const end = completedById.get(c.id);
    if (end === undefined) continue;
    const start = Date.parse(c.created_at);
    if (Number.isNaN(start)) continue;
    durations.push(end - start);
  }

  const avgPipelineDurationSec =
    durations.length ? round2(durations.reduce((s, d) => s + d, 0) / durations.length / 1000) : 0;
  return { totalContent: contents.length, avgPipelineDurationSec, byStatus };
}

/**
 * Compute the analytics KPI set from raw aggregated rows. Purely derived —
 * the caller (server) is responsible for the SQL reads.
 */
export function computeAnalytics(input: AnalyticsInput, now: string = new Date().toISOString()): AnalyticsResult {
  const jobs = input.jobs ?? [];
  const totals = {
    costEur: round2(jobs.reduce((s, j) => s + (j.cost_eur ?? 0), 0)),
    tokensIn: jobs.reduce((s, j) => s + (j.tokens_in ?? 0), 0),
    tokensOut: jobs.reduce((s, j) => s + (j.tokens_out ?? 0), 0),
    jobs: jobs.length,
  };
  return {
    generatedAt: now,
    totals,
    perAgent: perAgent(jobs),
    qa: qaKpi(input.qaVerdicts ?? []),
    publish: publishKpi(input.publishPackages ?? []),
    pipeline: pipelineKpi(input.contents ?? [], jobs),
  };
}
