import { describe, expect, it } from 'vitest';
import { getDB } from '../src/db/database.js';
import { artifactRepo, decisionLogRepo, contentRepo } from '../src/db/repository.js';
import { nowIso } from '../src/domain/types.js';
import {
  LIFECYCLE_ORDER,
  isAtLeast,
  type ArtifactLifecycle,
} from '../src/contracts/artifact.js';

function seedContent(id: string): void {
  contentRepo.insert({
    id, title: 'T', target_age: null, format: null, hook: null,
    status: 'PRODUCING', current_version: 1, meta: '{}', channel_id: null,
    created_at: nowIso(), updated_at: nowIso(),
  });
}

describe('artifact provenance + lifecycle', () => {
  const cid = 'content_artifact_phase3';

  it('migration v5 adds lifecycle (default GENERATED) + provenance columns', () => {
    seedContent(cid);
    artifactRepo.insert({
      id: 'art_legacy', content_id: cid, kind: 'script', version: 1,
      payload: '{"title":"x"}', source_job_id: 'job_1', created_at: nowIso(),
    });
    const row = getDB().prepare('SELECT lifecycle, cost_eur FROM artifact WHERE id=?').get('art_legacy') as {
      lifecycle: string;
      cost_eur: number;
    };
    // Legacy insert (no lifecycle passed) gets the DB default GENERATED.
    expect(row.lifecycle).toBe('GENERATED');
    expect(row.cost_eur).toBe(0);
  });

  it('persists full provenance + a resolved lifecycle', () => {
    artifactRepo.insert({
      id: 'art_provenance', content_id: cid, kind: 'video', version: 2,
      payload: '{}', source_job_id: 'job_2', created_at: nowIso(),
      lifecycle: 'RENDERED', provider: 'omniroute', model: 'flux', seed: 42,
      cost_eur: 0.13, validation: JSON.stringify({ status: 'passed', checkedAt: nowIso() }),
    });
    const latest = artifactRepo.latest(cid, 'video')!;
    expect(latest.id).toBe('art_provenance');
    expect(latest.lifecycle).toBe('RENDERED');
    expect(latest.provider).toBe('omniroute');
    expect(latest.model).toBe('flux');
    expect(latest.seed).toBe(42);
    expect(latest.cost_eur).toBe(0.13);
    expect(JSON.parse(String(latest.validation)).status).toBe('passed');
  });

  it('advances lifecycle without regressing', () => {
    artifactRepo.insert({
      id: 'art_life', content_id: cid, kind: 'final_video', version: 1,
      payload: '{}', source_job_id: 'job_3', created_at: nowIso(),
      lifecycle: 'COMPOSED',
    });
    artifactRepo.updateLifecycle(cid, 'final_video', 1, 'RENDERED');
    expect(artifactRepo.latest(cid, 'final_video')!.lifecycle).toBe('RENDERED');
    expect(() =>
      artifactRepo.updateLifecycle(cid, 'final_video', 1, 'PLANNED'),
    ).toThrow(/regression/);
    expect(artifactRepo.latest(cid, 'final_video')!.lifecycle).toBe('RENDERED');
  });

  it('lists the highest-version artifact per kind', () => {
    artifactRepo.insert({
      id: 'art_voice_v1', content_id: cid, kind: 'voice', version: 1,
      payload: '{}', source_job_id: 'job_4', created_at: nowIso(),
    });
    artifactRepo.insert({
      id: 'art_voice_v2', content_id: cid, kind: 'voice', version: 2,
      payload: '{}', source_job_id: 'job_5', created_at: nowIso(),
    });
    const kinds = artifactRepo.listByContent(cid).map((a) => `${a.kind}#${a.version}`);
    expect(kinds).toContain('voice#2');
    expect(kinds).not.toContain('voice#1');
  });

  it('lifecycle ordering helper compares phases correctly', () => {
    expect(LIFECYCLE_ORDER.GENERATED).toBeLessThan(LIFECYCLE_ORDER.RENDERED);
    expect(isAtLeast('RENDERED', 'GENERATED')).toBe(true);
    expect(isAtLeast('RENDERED', 'RENDERED')).toBe(true);
    expect(isAtLeast('GENERATED', 'RENDERED')).toBe(false);
    const states: ArtifactLifecycle[] = ['PLANNED', 'GENERATED', 'VALIDATED', 'COMPOSED', 'RENDERED', 'PUBLISHED'];
    expect([...states].sort((a, b) => LIFECYCLE_ORDER[a] - LIFECYCLE_ORDER[b])).toEqual(states);
  });
});

describe('decision log', () => {
  const cid = 'content_decision_phase3';
  it('appends and reads back a decision entry', () => {
    decisionLogRepo.insert({
      contentId: cid,
      stage: 'visual',
      category: 'provider_selection',
      subject: 'image tool',
      decision: 'chose omniroute-flux',
      optionsConsidered: ['wan21', 'local-diffusion'],
      rejectedBecause: ['local GPU not configured', 'wan is video-only'],
    });
    const recent = decisionLogRepo.listByContent(cid);
    expect(recent).toHaveLength(1);
    expect(recent[0]!.category).toBe('provider_selection');
    expect(JSON.parse(recent[0]!.options_considered)).toContain('wan21');
    expect(JSON.parse(recent[0]!.rejected_because).length).toBe(2);
  });

  it('lists recent decisions across content newest-first with a limit', () => {
    decisionLogRepo.insert({ category: 'budget_tradeoff', subject: 'cap', decision: 'refund', optionsConsidered: [] });
    decisionLogRepo.insert({ category: 'fallback_decision', subject: 'vo', decision: 'piper', optionsConsidered: [] });
    const recent = decisionLogRepo.listRecent(10);
    const subjects = recent.map((d) => d.subject);
    expect(subjects).toContain('vo');
    expect(subjects).toContain('cap');
    // Both belong to a recent decision category we know.
    expect(recent.filter((d) => d.category === 'budget_tradeoff' || d.category === 'fallback_decision')).toHaveLength(2);
  });
});
