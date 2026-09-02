import { describe, expect, it } from 'vitest';
import {
  buildAccessibilityLabel,
  buildHashtags,
  buildPublishDescription,
  buildPublishPackage,
  buildPublishTitle,
  publisherAgent,
  type PublishInput,
} from '../src/agents/publisher.js';
import type { ProductionPlan } from '../src/agents/contracts.js';

const PLAN: ProductionPlan = {
  title: 'The Brave Puppy',
  targetAge: '5',
  totalDurationSeconds: 60,
  visualStyle: 'pastel cartoon',
  scenes: [
    {
      id: 'S1',
      durationSeconds: 30,
      characters: ['Puppy'],
      location: 'park',
      action: 'puppy walks through grass',
      camera: 'wide shot',
      emotion: 'hopeful',
      narration: 'Once upon a time, a brave puppy set out.',
    },
    {
      id: 'S2',
      durationSeconds: 30,
      characters: ['Puppy', 'Butterfly'],
      location: 'park',
      action: 'puppy chases a butterfly',
      camera: 'medium',
      emotion: 'joyful',
      narration: 'And then it was off!',
    },
  ],
};

const INPUT: PublishInput = { plan: PLAN, contentId: 'content_pub1' };

describe('buildPublishTitle', () => {
  it('uses the plan title as-is when short enough', () => {
    expect(buildPublishTitle(PLAN)).toBe('The Brave Puppy');
  });

  it('falls back to the hook when the title is empty', () => {
    const noTitle: ProductionPlan = { ...PLAN, title: '   ' };
    const t = buildPublishTitle(noTitle);
    expect(t).toBeTruthy();
    expect(t.length).toBeLessThanOrEqual(100);
  });

  it('never exceeds the max length', () => {
    const long: ProductionPlan = { ...PLAN, title: 'A'.repeat(300) };
    expect(buildPublishTitle(long).length).toBeLessThanOrEqual(100);
  });
});

describe('buildPublishDescription', () => {
  it('mentions the hook, scene count and duration', () => {
    const d = buildPublishDescription(PLAN);
    expect(d).toContain('puppy walks through grass');
    expect(d).toContain('2 scene');
    expect(d).toContain('60s');
  });

  it('is bounded to 500 chars', () => {
    const d = buildPublishDescription({ ...PLAN, scenes: [PLAN.scenes[0]!, PLAN.scenes[0]!, PLAN.scenes[0]!, PLAN.scenes[0]!] });
    expect(d.length).toBeLessThanOrEqual(500);
  });

  it('never throws on a minimally-shaped plan', () => {
    const d = buildPublishDescription({ title: '', targetAge: '', totalDurationSeconds: 0, visualStyle: '', scenes: [] });
    expect(typeof d).toBe('string');
    expect(d.length).toBeGreaterThan(0);
  });
});

describe('buildHashtags', () => {
  it('derives compact, deduplicated tags from the plan', () => {
    const tags = buildHashtags(PLAN);
    expect(tags.length).toBeLessThanOrEqual(3);
    expect(new Set(tags).size).toBe(tags.length);
    expect(tags.every((t) => !/\s|[A-Z]/.test(t))).toBe(true);
  });

  it('caps at max tags', () => {
    const big: ProductionPlan = {
      ...PLAN,
      scenes: Array.from({ length: 10 }, (_, i) => ({ ...PLAN.scenes[0]!, id: `S${i}`, action: `action number ${i}` })),
    };
    expect(buildHashtags(big).length).toBeLessThanOrEqual(3);
  });

  it('returns a fallback for an empty plan (never empty list)', () => {
    const tags = buildHashtags({ title: 'x', targetAge: '5', totalDurationSeconds: 0, visualStyle: '', scenes: [] });
    expect(tags.length).toBeGreaterThan(0);
  });
});

describe('buildAccessibilityLabel', () => {
  it('reads like alt text for the final video', () => {
    const label = buildAccessibilityLabel(PLAN, 'The Brave Puppy');
    expect(label).toContain('The Brave Puppy');
    expect(label).toContain('2 scene');
    expect(label).toContain('ages 5');
  });
});

describe('buildPublishPackage', () => {
  it('publishes immediately (PUBLISHED) when no scheduledAt', () => {
    const pkg = buildPublishPackage(INPUT, '2026-09-02T10:00:00.000Z');
    expect(pkg.status).toBe('PUBLISHED');
    expect(pkg.publishedAt).toBe('2026-09-02T10:00:00.000Z');
    expect(pkg.scheduledAt).toBeNull();
    expect(pkg.target).toBe('LocalExport');
    expect(pkg.version).toBe(1);
    expect(pkg.thumbnailUri).toBe('/api/assets/content_pub1/poster.png');
    expect(pkg.title).toBe('The Brave Puppy');
    expect(pkg.hashtags.length).toBeGreaterThan(0);
  });

  it('schedules (SCHEDULED) when scheduledAt is provided', () => {
    const pkg = buildPublishPackage({ ...INPUT, scheduledAt: '2026-09-10T08:00:00.000Z' }, '2026-09-02T10:00:00.000Z');
    expect(pkg.status).toBe('SCHEDULED');
    expect(pkg.scheduledAt).toBe('2026-09-10T08:00:00.000Z');
    expect(pkg.publishedAt).toBeNull();
  });

  it('honors a custom target and thumbnail resolver', () => {
    const pkg = buildPublishPackage(
      { ...INPUT, target: 'YouTube' },
      '2026-09-02T10:00:00.000Z',
      () => '/custom/thumb.jpg',
    );
    expect(pkg.target).toBe('YouTube');
    expect(pkg.thumbnailUri).toBe('/custom/thumb.jpg');
  });
});

describe('publisherAgent (deterministic, no gateway)', () => {
  it('returns a valid package + zero cost with a local provider', () => {
    const out = publisherAgent(INPUT);
    expect(out.costEur).toBe(0);
    expect(out.model).toBe('deterministic');
    expect(out.provider).toBe('local');
    expect(out.status).toBe('PUBLISHED');
    expect(out.package.title).toBe('The Brave Puppy');
    expect(out.package.hashtags.length).toBeGreaterThan(0);
    expect(out.package.accessibilityLabel.length).toBeGreaterThan(0);
  });
});
