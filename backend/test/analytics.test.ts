import { describe, expect, it } from 'vitest';
import { computeAnalytics, type AnalyticsInput } from '../src/agents/analytics.js';

const BASE: AnalyticsInput = {
  jobs: [
    { content_id: 'c1', type: 'research', status: 'COMPLETED', cost_eur: 0.001, tokens_in: 100, tokens_out: 200, created_at: '2026-09-01T10:00:00.000Z', completed_at: '2026-09-01T10:01:00.000Z' },
    { content_id: 'c1', type: 'script', status: 'COMPLETED', cost_eur: 0.002, tokens_in: 50, tokens_out: 90, created_at: '2026-09-01T10:01:00.000Z', completed_at: '2026-09-01T10:02:00.000Z' },
    { content_id: 'c1', type: 'director', status: 'COMPLETED', cost_eur: 0.004, tokens_in: 80, tokens_out: 400, created_at: '2026-09-01T10:02:00.000Z', completed_at: '2026-09-01T10:03:00.000Z' },
    { content_id: 'c1', type: 'visual', status: 'COMPLETED', cost_eur: 0.01, tokens_in: 0, tokens_out: 0, created_at: '2026-09-01T10:03:00.000Z', completed_at: '2026-09-01T10:04:00.000Z' },
    { content_id: 'c1', type: 'voice', status: 'COMPLETED', cost_eur: 0.005, tokens_in: 0, tokens_out: 0, created_at: '2026-09-01T10:04:00.000Z', completed_at: '2026-09-01T10:05:00.000Z' },
    { content_id: 'c1', type: 'assembly', status: 'COMPLETED', cost_eur: 0.005, tokens_in: 0, tokens_out: 0, created_at: '2026-09-01T10:05:00.000Z', completed_at: '2026-09-01T10:06:00.000Z' },
    { content_id: 'c1', type: 'qa', status: 'COMPLETED', cost_eur: 0.003, tokens_in: 100, tokens_out: 120, created_at: '2026-09-01T10:06:00.000Z', completed_at: '2026-09-01T10:07:00.000Z' },
    { content_id: 'c1', type: 'publisher', status: 'COMPLETED', cost_eur: 0, tokens_in: 0, tokens_out: 0, created_at: '2026-09-01T10:07:00.000Z', completed_at: '2026-09-01T10:07:30.000Z' },
    // A second content with a rejected QA to exercise rejection tracking.
    { content_id: 'c2', type: 'research', status: 'COMPLETED', cost_eur: 0.001, tokens_in: 90, tokens_out: 80, created_at: '2026-09-01T11:00:00.000Z', completed_at: '2026-09-01T11:01:00.000Z' },
    { content_id: 'c2', type: 'qa', status: 'FAILED', cost_eur: 0.001, tokens_in: 5, tokens_out: 6, created_at: '2026-09-01T11:01:00.000Z', completed_at: '2026-09-01T11:01:10.000Z' },
  ],
  qaVerdicts: [
    { status: 'approved', score: 1, issues: [] },
    { status: 'rejected', score: 0.88, issues: [
      { severity: 'medium', category: 'continuity' },
      { severity: 'medium', category: 'continuity' },
      { severity: 'low', category: 'metadata' },
    ] },
  ],
  publishPackages: [
    { status: 'PUBLISHED', target: 'LocalExport' },
    { status: 'SCHEDULED', target: 'YouTube' },
  ],
  contents: [
    { id: 'c1', status: 'PUBLISHED', created_at: '2026-09-01T10:00:00.000Z' },
    { id: 'c2', status: 'QA', created_at: '2026-09-01T11:00:00.000Z' },
  ],
};

describe('computeAnalytics (deterministic, no gateway)', () => {
  it('computes global cost/token totals', () => {
    const out = computeAnalytics(BASE, '2026-09-02T00:00:00.000Z');
    expect(out.generatedAt).toBe('2026-09-02T00:00:00.000Z');
    expect(out.totals.jobs).toBe(BASE.jobs.length);
    // 0.001+0.002+0.004+0.01+0.005+0.005+0.003+0+0.001+0.001 = 0.032
    expect(out.totals.costEur).toBe(0.03); // 0.032 rounded 2dp
    expect(out.totals.tokensIn).toBe(100 + 50 + 80 + 100 + 90 + 5); // c1 research+script+director+qa, c2 research+qa
    expect(out.totals.tokensOut).toBe(200 + 90 + 400 + 120 + 80 + 6); // c1 research+script+director+qa, c2 research+qa
  });

  it('aggregates per-agent KPIs preserving pipeline order', () => {
    const out = computeAnalytics(BASE).perAgent;
    expect(out.map((a) => a.type)).toEqual(['research', 'script', 'director', 'visual', 'voice', 'assembly', 'qa', 'publisher']);
    const research = out.find((a) => a.type === 'research')!;
    expect(research.runs).toBe(2);
    expect(research.completed).toBe(2);
    expect(research.costEur).toBe(0.002);
    const qa = out.find((a) => a.type === 'qa')!;
    expect(qa.runs).toBe(2);
    expect(qa.completed).toBe(1);
    expect(qa.failed).toBe(1);
  });

  it('computes QA pass rate, avg score and top issue categories', () => {
    const qa = computeAnalytics(BASE).qa;
    expect(qa.total).toBe(2);
    expect(qa.approved).toBe(1);
    expect(qa.rejected).toBe(1);
    expect(qa.approveRate).toBe(50);
    expect(qa.avgScore).toBe(0.94); // (1 + 0.88)/2
    expect(qa.topIssueCategories[0]).toEqual({ category: 'continuity', count: 2 });
    expect(qa.topIssueCategories[1]).toEqual({ category: 'metadata', count: 1 });
  });

  it('computes publish KPIs', () => {
    const publish = computeAnalytics(BASE).publish;
    expect(publish.total).toBe(2);
    expect(publish.published).toBe(1);
    expect(publish.scheduled).toBe(1);
    expect(publish.byTarget).toEqual({ LocalExport: 1, YouTube: 1 });
  });

  it('computes content status distribution and mean pipeline duration', () => {
    const pipeline = computeAnalytics(BASE).pipeline;
    expect(pipeline.totalContent).toBe(2);
    expect(pipeline.byStatus).toEqual({ PUBLISHED: 1, QA: 1 });
    // c1 created 10:00:00, latest completed 10:07:30 → 450s.
    // c2 created 11:00:00, latest completed 11:01:00 → 60s. Mean = 255s.
    expect(pipeline.avgPipelineDurationSec).toBe(255);
  });

  it('is deterministic and free', () => {
    const out = computeAnalytics(BASE);
    // (Deterministic path: no model/provider cost.)
    const a = computeAnalytics(BASE, '2026-09-02T00:00:00.000Z');
    const b = computeAnalytics(BASE, '2026-09-02T00:00:00.000Z');
    expect(a).toEqual(b);
    expect(out.generatedAt).toBeTruthy();
  });

  it('handles empty input without crashing', () => {
    const out = computeAnalytics({ jobs: [], qaVerdicts: [], publishPackages: [], contents: [] });
    expect(out.totals.jobs).toBe(0);
    expect(out.totals.costEur).toBe(0);
    expect(out.perAgent).toEqual([]);
    expect(out.qa.total).toBe(0);
    expect(out.qa.approveRate).toBe(0);
    expect(out.qa.avgScore).toBe(0);
    expect(out.publish.total).toBe(0);
    expect(out.pipeline.avgPipelineDurationSec).toBe(0);
    expect(out.pipeline.byStatus).toEqual({});
  });

  it('handles contents with no completed jobs (durations excluded)', () => {
    const input: AnalyticsInput = {
      jobs: [{ content_id: 'c1', type: 'research', status: 'FAILED', cost_eur: 0.01, tokens_in: 1, tokens_out: 1, created_at: '2026-09-01T10:00:00.000Z', completed_at: null }],
      qaVerdicts: [],
      publishPackages: [],
      contents: [{ id: 'c1', status: 'FAILED', created_at: '2026-09-01T10:00:00.000Z' }],
    };
    const out = computeAnalytics(input);
    expect(out.pipeline.avgPipelineDurationSec).toBe(0);
    expect(out.perAgent.find((a) => a.type === 'research')!.failed).toBe(1);
  });
});