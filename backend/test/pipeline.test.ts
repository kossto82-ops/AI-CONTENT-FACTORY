import { describe, expect, it } from 'vitest';
import { loadPipeline, updateStepDefinition } from '../src/pipelineStore.js';
import { DEFAULT_PIPELINE } from '../src/pipeline.js';

describe('pipeline store', () => {
  it('seeds and reloads the default definition', () => {
    const p = loadPipeline(DEFAULT_PIPELINE.id);
    expect(p.id).toBe(DEFAULT_PIPELINE.id);
    expect(p.steps.map((s) => s.agent)).toEqual(['research', 'script', 'director', 'qa']);
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
    // research/qa default AUTOMATIC, creative steps inherit SEMI via pipeline.ts default
    expect(p.steps[0]!.agent).toBe('research');
    expect(p.steps[3]!.agent).toBe('qa');
  });
});
