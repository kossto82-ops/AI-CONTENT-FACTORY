import { describe, expect, it } from 'vitest';
import { loadPipeline, updateStepDefinition } from '../src/pipelineStore.js';
import { DEFAULT_PIPELINE } from '../src/pipeline.js';
import { getDB } from '../src/db/database.js';

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
    expect(p.steps[6]!.agent).toBe('qa');
    expect(p.steps[7]!.agent).toBe('publisher');
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
      'qa',
      'publisher',
    ]);
    // Operator override on script survives reconciliation.
    expect(p.steps.find((s) => s.agent === 'script')!.mode).toBe('MANUAL');
    // Injected steps come from the code default.
    expect(p.steps.find((s) => s.agent === 'visual')).toBeDefined();
    expect(p.steps.find((s) => s.agent === 'assembly')).toBeDefined();
    expect(p.steps.find((s) => s.agent === 'publisher')).toBeDefined();
  });
});
