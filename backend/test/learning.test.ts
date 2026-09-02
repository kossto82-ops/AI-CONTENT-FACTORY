import { describe, expect, it } from 'vitest';
import { computeLearning, type LearningInput, type LearningPlanSource } from '../src/agents/learning.js';

function plan(title: string, scenes: { action: string; durationSeconds: number }[]): LearningPlanSource {
  return {
    contentId: `c-${title}`,
    plan: {
      title,
      targetAge: '5',
      totalDurationSeconds: 60,
      visualStyle: 'flat cartoon',
      scenes: scenes.map((s, i) => ({
        id: `s${i + 1}`,
        durationSeconds: s.durationSeconds,
        characters: ['Rex'],
        location: 'forest',
        action: s.action,
        camera: 'wide',
        emotion: 'happy',
        narration: s.action,
      })),
    },
    qaScore: 0.9,
    format: 'story',
    targetAge: '5',
    totalCostEur: 0.03,
  };
}

const BASE: LearningInput = {
  // Reuse the analytics fixture data so computeLearning derives the same KPIs.
  jobs: [
    { content_id: 'c1', type: 'research', status: 'COMPLETED', cost_eur: 0.001, tokens_in: 100, tokens_out: 200, created_at: '2026-09-01T10:00:00.000Z', completed_at: '2026-09-01T10:01:00.000Z' },
    { content_id: 'c1', type: 'script', status: 'COMPLETED', cost_eur: 0.002, tokens_in: 50, tokens_out: 90, created_at: '2026-09-01T10:01:00.000Z', completed_at: '2026-09-01T10:02:00.000Z' },
    { content_id: 'c1', type: 'director', status: 'COMPLETED', cost_eur: 0.004, tokens_in: 80, tokens_out: 400, created_at: '2026-09-01T10:02:00.000Z', completed_at: '2026-09-01T10:03:00.000Z' },
    { content_id: 'c1', type: 'visual', status: 'COMPLETED', cost_eur: 0.01, tokens_in: 0, tokens_out: 0, created_at: '2026-09-01T10:03:00.000Z', completed_at: '2026-09-01T10:04:00.000Z' },
    { content_id: 'c1', type: 'voice', status: 'COMPLETED', cost_eur: 0.005, tokens_in: 0, tokens_out: 0, created_at: '2026-09-01T10:04:00.000Z', completed_at: '2026-09-01T10:05:00.000Z' },
    { content_id: 'c1', type: 'assembly', status: 'COMPLETED', cost_eur: 0.005, tokens_in: 0, tokens_out: 0, created_at: '2026-09-01T10:05:00.000Z', completed_at: '2026-09-01T10:06:00.000Z' },
    { content_id: 'c1', type: 'qa', status: 'COMPLETED', cost_eur: 0.003, tokens_in: 100, tokens_out: 120, created_at: '2026-09-01T10:06:00.000Z', completed_at: '2026-09-01T10:07:00.000Z' },
    { content_id: 'c1', type: 'publisher', status: 'COMPLETED', cost_eur: 0, tokens_in: 0, tokens_out: 0, created_at: '2026-09-01T10:07:00.000Z', completed_at: '2026-09-01T10:07:30.000Z' },
    { content_id: 'c2', type: 'research', status: 'COMPLETED', cost_eur: 0.001, tokens_in: 90, tokens_out: 80, created_at: '2026-09-01T11:00:00.000Z', completed_at: '2026-09-01T11:01:00.000Z' },
    { content_id: 'c2', type: 'qa', status: 'FAILED', cost_eur: 0.001, tokens_in: 5, tokens_out: 6, created_at: '2026-09-01T11:01:00.000Z', completed_at: '2026-09-01T11:01:10.000Z' },
  ],
  qaVerdicts: [
    { content_id: 'c1', status: 'approved', score: 1, issues: [] },
    { content_id: 'c2', status: 'rejected', score: 0.88, issues: [
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
  plans: [
    plan('The Brave Puppy', [
      { action: 'Rex finds a lost acorn in the forest.', durationSeconds: 4 },
      { action: 'Rex meets a squirrel and they share it.', durationSeconds: 5 },
    ]),
    plan('The Curious Kitten', [
      { action: 'Milo crawls into a cardboard box.', durationSeconds: 4 },
      { action: 'The box floats on a puddle of milk.', durationSeconds: 6 },
    ]),
  ],
};

describe('computeLearning (deterministic, no gateway)', () => {
  it('derives lessons from the analytics signal', () => {
    const out = computeLearning(BASE, '2026-09-02T00:00:00.000Z');
    expect(out.generatedAt).toBe('2026-09-02T00:00:00.000Z');
    expect(out.lessons.length).toBeGreaterThan(0);

    const rate = out.lessons.find((l) => l.id === 'lesson-qa-rate')!;
    expect(rate).toBeDefined();
    expect(rate.body).toContain('1 of 2');
    expect(rate.severity).toBe('high'); // approveRate < 60

    const costliest = out.lessons.find((l) => l.id === 'lesson-costliest-agent')!;
    expect(costliest).toBeDefined();
    // visual cost 0.01 of ~0.032 total = ~31% -> medium
    expect(costliest.severity).toBe('medium');
    expect(costliest.body).toMatch(/visual/i);
  });

  it('derives deterministic ideas from approved plans', () => {
    const out = computeLearning(BASE);
    expect(out.ideas.length).toBeGreaterThan(0);
    expect(out.ideas.length).toBeLessThanOrEqual(4);
    for (const id of out.ideas) {
      // Validate the idea schema (same as research output) + provenance.
      expect(id.idea.title).toBeTruthy();
      expect(id.idea.target_age).toBe('5');
      expect(id.idea.format).toBe('story');
      expect(id.idea.reason).toMatch(/Derived from plan/);
      expect(id.sourceContentId).toBeTruthy();
      expect(id.sourceQaScore).toBe(0.9);
      expect(id.idea.score).toBeGreaterThan(0);
      expect(id.idea.score).toBeLessThanOrEqual(1);
    }
    const hook = out.ideas.find((i) => i.variation === 'hook');
    expect(hook).toBeDefined();
    expect(hook!.idea.hook).toBe('Rex finds a lost acorn in the forest.');
  });

  it('orders ideas by QA eligibility first (score >= 0.7)', () => {
    const input: LearningInput = {
      ...BASE,
      plans: [
        { ...plan('Low Score', [{ action: 'A quiet moment.', durationSeconds: 3 }]), qaScore: 0.2 },
        { ...plan('Approved', [{ action: 'A big splash.', durationSeconds: 3 }]), qaScore: 0.95 },
      ],
    };
    const out = computeLearning(input);
    // Higher QA plan first regardless of insertion order.
    expect(out.ideas[0].sourceTitle).toContain('Approved');
  });

  it('produces recommendations for costly/turbulent signals', () => {
    const out = computeLearning(BASE);
    const recIds = out.recommendations.map((r) => r.id);
    // visual = ~31% (not >=40%); QA issue continuity appears 2x -> rec-fix-qa-issue
    expect(recIds).toContain('rec-fix-qa-issue');
    expect(recIds.length).toBeGreaterThan(0);
    for (const r of out.recommendations) {
      expect(r.action).toBeTruthy();
      expect(r.reason).toBeTruthy();
      expect(['high', 'medium', 'low']).toContain(r.priority);
      expect(r.target).toBeTruthy();
    }
  });

  it('recommends a tier rebalance when one agent concentrates cost', () => {
    const input: LearningInput = {
      ...BASE,
      jobs: [...BASE.jobs, { content_id: 'c9', type: 'visual', status: 'COMPLETED', cost_eur: 10, tokens_in: 0, tokens_out: 0, created_at: '2026-09-01T12:00:00.000Z', completed_at: '2026-09-01T12:01:00.000Z' }],
    };
    const out = computeLearning(input);
    const tier = out.recommendations.find((r) => r.id === 'rec-tier-rebalance');
    expect(tier).toBeDefined();
    expect(tier!.action).toContain('visual');
    expect(tier!.priority).toBe('high');
  });

  it('handles empty input without crashing', () => {
    const out = computeLearning({ jobs: [], qaVerdicts: [], publishPackages: [], contents: [], plans: [] });
    expect(out.lessons).toEqual([]);
    expect(out.ideas).toEqual([]);
    expect(out.recommendations).toEqual([]);
    expect(out.generatedAt).toBeTruthy();
  });

  it('is deterministic', () => {
    const a = computeLearning(BASE, '2026-09-02T00:00:00.000Z');
    const b = computeLearning(BASE, '2026-09-02T00:00:00.000Z');
    expect(a).toEqual(b);
  });
});