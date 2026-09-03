import { describe, expect, it } from 'vitest';
import { loadPipeline, updateStepDefinition } from '../src/pipelineStore.js';
import { DEFAULT_PIPELINE } from '../src/pipeline.js';
import { getDB } from '../src/db/database.js';
import { approvalRepo, artifactRepo, contentRepo, jobRepo } from '../src/db/repository.js';
import { Orchestrator } from '../src/orchestrator/orchestrator.js';
import { nowIso } from '../src/domain/types.js';

describe('pipeline store', () => {
  it('seeds and reloads the default definition', () => {
    const p = loadPipeline(DEFAULT_PIPELINE.id);
    expect(p.id).toBe(DEFAULT_PIPELINE.id);
    expect(p.steps.map((s) => s.agent)).toEqual([
      'research',
      'script',
      'director',
      'visual',
      'voice',
      'assembly',
      'render',
      'qa',
      'publisher',
    ]);
  });

  it('persists a per-step mode override across loads', () => {
    updateStepDefinition({ agent: 'script', mode: 'MANUAL' });
    const reloaded = loadPipeline(DEFAULT_PIPELINE.id);
    const script = reloaded.steps.find((s) => s.agent === 'script')!;
    expect(script.mode).toBe('MANUAL');
  });

  it('persists a gate toggle for a step', () => {
    updateStepDefinition({ agent: 'script', requiresApproval: false });
    updateStepDefinition({ agent: 'research', requiresApproval: true });
    const reloaded = loadPipeline(DEFAULT_PIPELINE.id);
    expect(reloaded.steps.find((s) => s.agent === 'script')!.requiresApproval).toBe(false);
    expect(reloaded.steps.find((s) => s.agent === 'research')!.requiresApproval).toBe(true);
  });

  it('throws when updating an unknown step', () => {
    expect(() => updateStepDefinition({ agent: 'nonexistent', mode: 'MANUAL' })).toThrow(
      /not found in pipeline/,
    );
  });

  it('resolves default modes per agent when no override', () => {
    const p = loadPipeline(DEFAULT_PIPELINE.id);
    expect(p.steps[0]!.agent).toBe('research');
    expect(p.steps[6]!.agent).toBe('render');
    expect(p.steps[7]!.agent).toBe('qa');
    expect(p.steps[8]!.agent).toBe('publisher');
  });

  it('reconciles a stale stored pipeline (missing injected steps) without clobbering overrides', () => {
    // Simulate a dev DB seeded in an early phase with only 4 steps AND an
    // operator override on script.
    const staleSteps = [
      { order: 1, agent: 'research', requiresApproval: true, approvalKind: 'idea' },
      { order: 2, agent: 'script', mode: 'MANUAL', requiresApproval: true, approvalKind: 'script' },
      { order: 3, agent: 'director', requiresApproval: true, approvalKind: 'plan' },
      { order: 4, agent: 'qa', requiresApproval: true, approvalKind: 'video' },
    ];
    getDB()
      .prepare('UPDATE pipeline SET definition=? WHERE id=?')
      .run(JSON.stringify({ steps: staleSteps }), DEFAULT_PIPELINE.id);

    const p = loadPipeline(DEFAULT_PIPELINE.id);
    expect(p.steps.map((s) => s.agent)).toEqual([
      'research',
      'script',
      'director',
      'visual',
      'voice',
      'assembly',
      'render',
      'qa',
      'publisher',
    ]);
    // Operator override on script survives reconciliation.
    expect(p.steps.find((s) => s.agent === 'script')!.mode).toBe('MANUAL');
    // Injected steps come from the code default.
    expect(p.steps.find((s) => s.agent === 'visual')).toBeDefined();
    expect(p.steps.find((s) => s.agent === 'assembly')).toBeDefined();
    expect(p.steps.find((s) => s.agent === 'render')).toBeDefined();
    expect(p.steps.find((s) => s.agent === 'publisher')).toBeDefined();
  });
});

describe('approve gate transitions the gated job to COMPLETED', () => {
  it('moving a WAITING_APPROVAL job to COMPLETED on approve (fixes stuck pending badge)', () => {
    const pipelines = loadPipeline(DEFAULT_PIPELINE.id);
    const contentId = 'content_approve_gate';
    contentRepo.insert({
      id: contentId, title: 'T', target_age: null, format: null, hook: null,
      status: 'DIRECTED', current_version: 1, meta: '{}', channel_id: null,
      created_at: nowIso(), updated_at: nowIso(),
    });
    jobRepo.insert({
      id: 'job_approve_gate', content_id: contentId, pipeline_id: null, type: 'director',
      agent_id: 'director', status: 'WAITING_APPROVAL', input: '{}', output: '{}',
      parent_job: null, dependency: null, created_at: nowIso(), started_at: nowIso(),
      completed_at: null, attempt: 1, max_retries: 3, error: null, model: null,
      provider: null, tokens_in: 0, tokens_out: 0, cost_eur: 0, trace: '[]',
    });
    approvalRepo.insert({
      id: 'appr_approve_gate', content_id: contentId, job_id: 'job_approve_gate', kind: 'plan',
      status: 'PENDING', request_reason: null, decision: null, decided_at: null, created_at: nowIso(),
    });
    // The gated director produced a plan, so the next step (visual) can be
    // materialized when the approval unblocks the pipeline.
    artifactRepo.insert({
      id: 'art_plan_gate', content_id: contentId, kind: 'production_plan', version: 1,
      payload: '{}', source_job_id: 'job_approve_gate', created_at: nowIso(),
    });

    new Orchestrator().decideApproval(
      { approvalId: 'appr_approve_gate', status: 'APPROVED', decision: 'ok' },
      pipelines,
    );

    // The gated job must leave WAITING_APPROVAL, or the Control Center keeps
    // showing the approval as pending forever even after the pipeline advances.
    expect(jobRepo.get('job_approve_gate')!.status).toBe('COMPLETED');
    expect(approvalRepo.get('appr_approve_gate')!.status).toBe('APPROVED');
    // Approve unblocks the pipeline: the next step (visual) is materialized.
    const visual = jobRepo.listByContent(contentId).find((j) => j.type === 'visual');
    expect(visual).toBeDefined();
  });
});
