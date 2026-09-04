import { describe, expect, it } from 'vitest';
import { DEFAULT_PIPELINE } from '../src/pipeline.js';
import {
  buildPipelineManifest,
  manifestToDefinition,
  validatePipelineDefinition,
} from '../src/contracts/pipelineManifest.js';
import { loadPipelineManifest } from '../src/pipelineStore.js';
import type { AgentType } from '../src/agents/registry.js';
import type { PipelineDefinition } from '../src/pipeline.js';

describe('pipeline manifest', () => {
  it('inflates the default definition into a valid manifest with defaults', () => {
    const m = buildPipelineManifest(DEFAULT_PIPELINE);
    expect(m.id).toBe(DEFAULT_PIPELINE.id);
    expect(m.steps.map((s) => s.agent)).toEqual([
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
    // Sane governance defaults are filled in.
    expect(m.orchestration.category).toBe('short');
    expect(m.orchestration.stability).toBe('beta');
    expect(m.orchestration.maxRevisionsPerStage).toBeGreaterThan(0);
    expect(m.orchestration.maxSendBacks).toBeGreaterThan(0);
  });

  it('honours explicit orchestration metadata over defaults', () => {
    const m = buildPipelineManifest(DEFAULT_PIPELINE, {
      category: 'singalong',
      budgetDefaultEur: 0.5,
      maxRevisionsPerStage: 5,
    });
    expect(m.orchestration.category).toBe('singalong');
    expect(m.orchestration.budgetDefaultEur).toBe(0.5);
    expect(m.orchestration.maxRevisionsPerStage).toBe(5);
  });

  it('round-trips manifest -> definition -> manifest losslessly for steps', () => {
    const m = buildPipelineManifest(DEFAULT_PIPELINE);
    const def = manifestToDefinition(m);
    expect(def.id).toBe(m.id);
    expect(def.steps.map((s) => s.agent)).toEqual(m.steps.map((s) => s.agent));
    expect(def.steps.map((s) => s.order)).toEqual(m.steps.map((s) => s.order));
    // Step approval gates survive the round-trip.
    expect(def.steps.find((s) => s.agent === 'script')?.requiresApproval).toBe(true);
    expect(def.steps.find((s) => s.agent === 'script')?.approvalKind).toBe('script');
  });

  it('rejects a step with an unknown agent (schema drift)', () => {
    const bad = {
      id: DEFAULT_PIPELINE.id,
      name: 'bad',
      steps: [
        ...DEFAULT_PIPELINE.steps.map((s, i) => ({ ...s, order: i + 1, agent: s.agent })),
        { order: 99, agent: 'bogus_agent' as unknown as AgentType },
      ],
    } satisfies PipelineDefinition;
    expect(() => validatePipelineDefinition(bad)).toThrow();
  });

  it('rejects a non-positive step order', () => {
    const bad = {
      id: 'x',
      name: 'bad',
      steps: [{ order: 0, agent: 'research', requiresApproval: true, approvalKind: 'idea' }],
    } satisfies PipelineDefinition;
    expect(() => validatePipelineDefinition(bad)).toThrow();
  });

  it('loads the stored pipeline as a validated manifest', () => {
    const m = loadPipelineManifest();
    expect(validatePipelineDefinition.bind(null, {
      id: m.id,
      name: m.name,
      steps: m.steps.map((s) => ({
        order: s.order,
        agent: s.agent,
        mode: s.mode,
        requiresApproval: s.requiresApproval,
        approvalKind: s.approvalKind,
        dependsOn: s.dependsOn,
      })),
    })).not.toThrow();
    expect(m.id).toBe(DEFAULT_PIPELINE.id);
  });
});
