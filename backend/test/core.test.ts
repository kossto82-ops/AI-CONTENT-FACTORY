import { describe, expect, it } from 'vitest';
import { resolveModel, estimateCostEur } from '../src/gateway/router.js';
import {
  InvalidTransitionError,
  transitionJob,
} from '../src/orchestrator/state.js';
import type { JobRow } from '../src/db/repository.js';

function makeJob(status: JobRow['status']): JobRow {
  return {
    id: 'job_x',
    content_id: null,
    pipeline_id: null,
    type: 'research',
    agent_id: 'research',
    status,
    input: '{}',
    output: null,
    parent_job: null,
    dependency: null,
    created_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    attempt: 0,
    max_retries: 2,
    error: null,
    model: null,
    provider: null,
    tokens_in: 0,
    tokens_out: 0,
    cost_eur: 0,
    trace: '[]',
  };
}

describe('model router', () => {
  it('maps a task+tier to a combo', () => {
    expect(resolveModel('idea.generation', 'cheap')).toBe('auto/cheap');
    expect(resolveModel('script.writing', 'quality')).toBe('auto/best-coding');
  });

  it('falls back to cheap when tier is missing', () => {
    expect(resolveModel('quality.review')).toBe('auto/best-fast');
    expect(resolveModel('classification', 'standard')).toBe('auto/best-fast');
  });

  it('estimates cost proportional to tokens', () => {
    expect(estimateCostEur('auto/cheap', 1000, 0)).toBeCloseTo(0.0001, 6);
    expect(estimateCostEur('auto/free', 1_000_000, 0)).toBe(0);
  });
});

describe('job state machine', () => {
  it('allows valid transitions and persists', () => {
    const j = makeJob('READY');
    expect(transitionJob(j, 'RUNNING')).toBe(true);
    expect(transitionJob(j, 'COMPLETED')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    const j = makeJob('COMPLETED');
    expect(() => transitionJob(j, 'READY')).toThrow(InvalidTransitionError);
  });

  it('is idempotent for same-state', () => {
    const j = makeJob('RUNNING');
    expect(transitionJob(j, 'RUNNING')).toBe(true);
  });

  it('marks terminal timestamps', () => {
    const j = makeJob('RUNNING');
    transitionJob(j, 'COMPLETED');
    expect(j.completed_at).toBeTruthy();
  });
});
