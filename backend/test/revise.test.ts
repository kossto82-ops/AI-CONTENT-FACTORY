import { describe, expect, it } from 'vitest';
import { Orchestrator } from '../src/orchestrator/orchestrator.js';
import { artifactRepo, contentRepo, jobRepo } from '../src/db/repository.js';
import { loadPipeline } from '../src/pipelineStore.js';
import { newId, nowIso } from '../src/domain/types.js';

const orch = new Orchestrator();

const SCRIPT = {
  title: 'The Brave Puppy',
  concept: 'A puppy learns to be brave',
  hook: 'Will the puppy find its courage?',
  targetAge: '4-6',
  structure: 'story',
  narration: 'Once upon a time...',
  dialogues: ['Puppy: Hi!'],
  ending: 'The end.',
  cta: 'Subscribe!',
  scenes: [
    {
      id: 'SCENE 01',
      durationSeconds: 30,
      characters: ['Puppy'],
      location: 'park',
      action: 'puppy walks',
      camera: 'wide',
      emotion: 'hopeful',
      narration: 'Here we go.',
    },
  ],
};

const REJECTED_VERDICT = {
  status: 'rejected',
  score: 0.5,
  issues: [
    { severity: 'high', category: 'duration', message: 'Total duration does not match scene sum' },
  ],
};

const APPROVED_VERDICT = { status: 'approved', score: 0.9, issues: [] };

const PLAN = {
  title: 'The Brave Puppy',
  targetAge: '4-6',
  totalDurationSeconds: 30,
  scenes: SCRIPT.scenes,
  visualStyle: 'pastel',
};

function seedContent(withApprovedQa = false): string {
  const id = newId('content');
  contentRepo.insert({
    id,
    title: null,
    target_age: null,
    format: null,
    hook: null,
    status: 'QA',
    current_version: 0,
    meta: '{}',
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  artifactRepo.insert({
    id: newId('artifact'),
    content_id: id,
    kind: 'script',
    version: 1,
    payload: JSON.stringify(SCRIPT),
    source_job_id: null,
    created_at: nowIso(),
  });
  artifactRepo.insert({
    id: newId('artifact'),
    content_id: id,
    kind: 'production_plan',
    version: 1,
    payload: JSON.stringify(PLAN),
    source_job_id: null,
    created_at: nowIso(),
  });
  artifactRepo.insert({
    id: newId('artifact'),
    content_id: id,
    kind: 'qa',
    version: 1,
    payload: JSON.stringify(withApprovedQa ? APPROVED_VERDICT : REJECTED_VERDICT),
    source_job_id: null,
    created_at: nowIso(),
  });
  return id;
}

describe('plan revision loop (rollback path on QA rejection)', () => {
  it('throws for unknown content', () => {
    expect(() => orch.revisePlan('content_nope', loadPipeline())).toThrow('Content not found');
  });

  it('throws when the latest QA verdict is approved', () => {
    const id = seedContent(true);
    expect(() => orch.revisePlan(id, loadPipeline())).toThrow('not rejected');
  });

  it('creates a director revision job with QA feedback when rejected', () => {
    const id = seedContent(false);
    const jobId = orch.revisePlan(id, loadPipeline());
    const job = jobRepo.get(jobId)!;
    expect(job.type).toBe('director');
    expect(job.status).toBe('READY');
    const input = JSON.parse(job.input) as {
      script: unknown;
      revision: { issues: { category: string }[]; previousPlan: { title: string } };
    };
    expect(input.script).toBeTruthy();
    expect(input.revision.issues[0]!.category).toBe('duration');
    expect(input.revision.previousPlan.title).toBe('The Brave Puppy');
    expect(job.trace).toContain('Revision requested');
  });

  it('the revision job is runnable (dependency satisfied)', () => {
    const id = seedContent(false);
    const jobId = orch.revisePlan(id, loadPipeline());
    expect(jobRepo.runnable().some((j) => j.id === jobId)).toBe(true);
  });
});