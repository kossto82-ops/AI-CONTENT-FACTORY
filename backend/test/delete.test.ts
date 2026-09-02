import { describe, expect, it } from 'vitest';
import {
  approvalRepo,
  artifactRepo,
  contentRepo,
  executionRepo,
  jobRepo,
  persistEvent,
} from '../src/db/repository.js';
import { deleteContentDeep } from '../src/server.js';
import { getDB } from '../src/db/database.js';
import { nowIso } from '../src/domain/types.js';

function makeContent(id: string): void {
  contentRepo.insert({
    id,
    title: 'T',
    target_age: null,
    format: null,
    hook: null,
    status: 'PRODUCING',
    current_version: 1,
    meta: '{}',
    channel_id: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
}

function makeJob(id: string, contentId: string): void {
  jobRepo.insert({
    id,
    content_id: contentId,
    pipeline_id: null,
    type: 'director',
    agent_id: 'director',
    status: 'COMPLETED',
    input: '{}',
    output: '{}',
    parent_job: null,
    dependency: null,
    created_at: nowIso(),
    started_at: nowIso(),
    completed_at: nowIso(),
    attempt: 1,
    max_retries: 3,
    error: null,
    model: null,
    provider: null,
    tokens_in: 0,
    tokens_out: 0,
    cost_eur: 0,
    trace: '[]',
  });
}

describe('deleteContentDeep (cascade delete)', () => {
  it('removes the content and everything referencing it, not other rows', () => {
    makeContent('content_kill');
    makeContent('content_keep');
    makeJob('job_kill', 'content_kill');
    makeJob('job_keep', 'content_keep');

    executionRepo.insert({
      id: 'exec_kill', job_id: 'job_kill', agent_id: 'director', model: null, provider: 'omniroute',
      tokens_in: 1, tokens_out: 1, cost_eur: 0, started_at: nowIso(), ended_at: nowIso(), error: null,
    });
    executionRepo.insert({
      id: 'exec_keep', job_id: 'job_keep', agent_id: 'director', model: null, provider: 'omniroute',
      tokens_in: 1, tokens_out: 1, cost_eur: 0, started_at: nowIso(), ended_at: nowIso(), error: null,
    });

    approvalRepo.insert({
      id: 'appr_kill', content_id: 'content_kill', job_id: 'job_kill', kind: 'plan', status: 'PENDING',
      request_reason: null, decision: null, decided_at: null, created_at: nowIso(),
    });
    approvalRepo.insert({
      id: 'appr_keep', content_id: 'content_keep', job_id: 'job_keep', kind: 'plan', status: 'PENDING',
      request_reason: null, decision: null, decided_at: null, created_at: nowIso(),
    });

    artifactRepo.insert({
      id: 'art_kill', content_id: 'content_kill', kind: 'production_plan', version: 1, payload: '{}', source_job_id: 'job_kill', created_at: nowIso(),
    });
    artifactRepo.insert({
      id: 'art_keep', content_id: 'content_keep', kind: 'production_plan', version: 1, payload: '{}', source_job_id: 'job_keep', created_at: nowIso(),
    });

    persistEvent({ type: 'job.completed', entity_type: 'job', entity_id: 'job_kill', payload: '{}', created_at: nowIso() });
    persistEvent({ type: 'content.created', entity_type: 'content', entity_id: 'content_kill', payload: '{}', created_at: nowIso() });
    persistEvent({ type: 'approval.requested', entity_type: 'approval', entity_id: 'appr_kill', payload: '{}', created_at: nowIso() });
    persistEvent({ type: 'content.created', entity_type: 'content', entity_id: 'content_keep', payload: '{}', created_at: nowIso() });

    deleteContentDeep('content_kill', getDB());

    expect(contentRepo.get('content_kill')).toBeUndefined();
    expect(jobRepo.get('job_kill')).toBeUndefined();
    expect(approvalRepo.get('appr_kill')).toBeUndefined();
    expect(artifactRepo.latest('content_kill', 'production_plan')).toBeUndefined();
    expect(getDB().prepare('SELECT COUNT(*) AS n FROM execution WHERE id=?').get('exec_kill')!.n).toBe(0);
    expect(getDB().prepare('SELECT COUNT(*) AS n FROM event WHERE entity_id=?').get('job_kill')!.n).toBe(0);
    expect(getDB().prepare('SELECT COUNT(*) AS n FROM event WHERE entity_id=?').get('content_kill')!.n).toBe(0);
    expect(getDB().prepare('SELECT COUNT(*) AS n FROM event WHERE entity_id=?').get('appr_kill')!.n).toBe(0);

    // Unrelated content survives untouched.
    expect(contentRepo.get('content_keep')).toBeDefined();
    expect(jobRepo.get('job_keep')).toBeDefined();
    expect(approvalRepo.get('appr_keep')).toBeDefined();
    expect(artifactRepo.latest('content_keep', 'production_plan')).toBeDefined();
    expect(getDB().prepare('SELECT COUNT(*) AS n FROM execution WHERE id=?').get('exec_keep')!.n).toBe(1);
    expect(getDB().prepare("SELECT COUNT(*) AS n FROM event WHERE entity_type='content' AND entity_id=?").get('content_keep')!.n).toBe(1);
  });
});