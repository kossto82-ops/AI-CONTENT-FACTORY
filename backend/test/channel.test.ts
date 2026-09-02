import { describe, expect, it } from 'vitest';
import { channelRepo, contentRepo } from '../src/db/repository.js';
import { nowIso } from '../src/domain/types.js';
import { Orchestrator, channelConfigFor } from '../src/orchestrator/orchestrator.js';
import {
  DEFAULT_CHANNEL_CONFIG,
  channelConfigSchema,
  type ChannelConfig,
} from '../src/agents/contracts.js';
import { buildScenePrompt } from '../src/agents/visual.js';
import { runPlanQa } from '../src/agents/qa.js';
import type { ProductionPlan } from '../src/agents/contracts.js';

const TOYMONSTER = 'channel_toymonster';

function seedChannel(id: string, name: string, config: ChannelConfig | null): void {
  const now = nowIso();
  channelRepo.insert({ id, name, config: config ? JSON.stringify(config) : null, created_at: now, updated_at: now });
}

describe('ChannelConfig schema + default', () => {
  it('parses an empty object into the fully-defaulted fallback', () => {
    const cfg = channelConfigSchema.parse({});
    expect(cfg.audience.targetAge).toBe('4-7');
    expect(cfg.format.defaultDurationSec).toBe(15);
    expect(cfg.format.beats).toHaveLength(3);
    expect(cfg.format.beats[0]!.name).toBe('Hook');
    expect(cfg.format.beats[0]!.end).toBe(3);
    expect(cfg.format.beats[2]!.name).toBe('CTA');
    expect(cfg.visualStyle.style).toBe("children's cartoon");
    expect(DEFAULT_CHANNEL_CONFIG.audience.targetAge).toBe('4-7');
  });

  it('merges a partial config over the defaults (ToyMonster override)', () => {
    const cfg = channelConfigSchema.parse({
      audience: { targetAge: '3-8' },
      visualStyle: { style: '3D toy monster cartoon' },
    });
    expect(cfg.audience.targetAge).toBe('3-8');
    expect(cfg.visualStyle.style).toBe('3D toy monster cartoon');
    // untouched nested defaults persist
    expect(cfg.format.defaultDurationSec).toBe(15);
    expect(cfg.rhythm.postsPerDay).toBe('2-3');
  });
});

describe('channelConfigFor', () => {
  it('returns defaults when content has no channel_id', () => {
    const cfg = channelConfigFor({
      id: 'c', title: null, target_age: null, format: null, hook: null,
      status: 'IDEA', current_version: 0, meta: '{}', channel_id: null,
      created_at: nowIso(), updated_at: nowIso(),
    });
    expect(cfg.audience.targetAge).toBe('4-7');
    expect(cfg.format.defaultDurationSec).toBe(15);
  });

  it('loads the channel config when content references a channel', () => {
    seedChannel('channel_test1', 'Test Channel', channelConfigSchema.parse({ audience: { targetAge: '3-8' } }));
    const cfg = channelConfigFor({
      id: 'c', title: null, target_age: null, format: null, hook: null,
      status: 'IDEA', current_version: 0, meta: '{}', channel_id: 'channel_test1',
      created_at: nowIso(), updated_at: nowIso(),
    });
    expect(cfg.audience.targetAge).toBe('3-8');
    expect(cfg.format.defaultDurationSec).toBe(15); // merged default
  });

  it('defaults the target channel (ToyMonster) to 3-8 / 15s / 3 beats', () => {
    const row = channelRepo.get(TOYMONSTER)!;
    const cfg = channelConfigSchema.parse(JSON.parse(row.config!));
    expect(row.name).toBe('ToyMonster Club');
    expect(cfg.audience.targetAge).toBe('3-8');
    expect(cfg.format.defaultDurationSec).toBe(15);
    expect(cfg.visualStyle.characterDescription).toContain('Labubu');
    expect(cfg.visualStyle.characterDescription).toContain('9:16');
  });
});

describe('Visual agent channel integration', () => {
  it('injects the channel character description into scene prompts', () => {
    const plan: ProductionPlan = {
      title: 't', targetAge: '3-8', totalDurationSeconds: 15, visualStyle: '3D toy monster cartoon',
      scenes: [{
        id: 'S1', durationSeconds: 5, characters: ['Monster'], location: 'room',
        action: 'opens a shiny box', camera: 'close-up', emotion: 'curious', narration: 'Ooh!',
      }],
    };
    const cfg = channelConfigSchema.parse({ audience: { targetAge: '3-8' } });
    const p = buildScenePrompt(plan, plan.scenes[0]!, 0, cfg);
    expect(p).toContain('3D toy monster cartoon');
    expect(p).toContain('featuring Monster');
  });

  it('does not require channel config (backward compatible)', () => {
    const plan: ProductionPlan = {
      title: 't', targetAge: '5', totalDurationSeconds: 60, visualStyle: 'pastel',
      scenes: [{
        id: 'S1', durationSeconds: 30, characters: ['Puppy'], location: 'park',
        action: 'walks', camera: 'wide', emotion: 'happy', narration: 'hi',
      }],
    };
    const p = buildScenePrompt(plan, plan.scenes[0]!, 0);
    expect(p).toContain('pastel');
    expect(p).not.toContain('character:');
  });
});

describe('QA agent channel checks', () => {
  const beats = DEFAULT_CHANNEL_CONFIG.format.beats;

  it('flags a plan whose duration drifts from the channel default (15s)', () => {
    const cfg = channelConfigSchema.parse({ audience: { targetAge: '3-8' } });
    const plan: ProductionPlan = {
      title: 't', targetAge: '3-8', totalDurationSeconds: 30, visualStyle: 'x',
      scenes: [{ id: 'S1', durationSeconds: 30, characters: [], location: '', action: '', camera: '', emotion: '', narration: 'n' }],
    };
    const { issues, checklist } = runPlanQa(plan, cfg);
    expect(checklist.duration_ok).toBe(false);
    expect(issues.some((i) => i.category === 'duration' && i.message.includes("15s"))).toBe(true);
    void beats;
  });

  it('accepts a plan close to the channel default and matching beat count', () => {
    const cfg = channelConfigSchema.parse({ audience: { targetAge: '3-8' } });
    const plan: ProductionPlan = {
      title: 't', targetAge: '3-8', totalDurationSeconds: 15, visualStyle: 'x',
      scenes: [
        { id: 'S1', durationSeconds: 3, characters: [], location: '', action: '', camera: '', emotion: '', narration: 'a' },
        { id: 'S2', durationSeconds: 8, characters: [], location: '', action: '', camera: '', emotion: '', narration: 'b' },
        { id: 'S3', durationSeconds: 4, characters: [], location: '', action: '', camera: '', emotion: '', narration: 'c' },
      ],
    };
    const { checklist } = runPlanQa(plan, cfg);
    expect(checklist.duration_ok).toBe(true);
    expect(checklist.beat_structure_ok).toBe(true);
  });

  it('flags a plan whose scene count does not match the channel beat count', () => {
    const cfg = channelConfigSchema.parse({ audience: { targetAge: '3-8' } });
    const plan: ProductionPlan = {
      title: 't', targetAge: '3-8', totalDurationSeconds: 15, visualStyle: 'x',
      scenes: [
        { id: 'S1', durationSeconds: 15, characters: [], location: '', action: '', camera: '', emotion: '', narration: 'a' },
      ],
    };
    const { issues, checklist } = runPlanQa(plan, cfg);
    expect(checklist.beat_structure_ok).toBe(false);
    expect(issues.some((i) => i.category === 'structure' && i.message.includes('Hook/Chaos/CTA'))).toBe(true);
  });

  it('skips channel checks when no channel config is supplied', () => {
    const plan: ProductionPlan = {
      title: 't', targetAge: '5', totalDurationSeconds: 60, visualStyle: 'x',
      scenes: [{ id: 'S1', durationSeconds: 60, characters: [], location: '', action: '', camera: '', emotion: '', narration: 'n' }],
    };
    const { checklist } = runPlanQa(plan);
    expect(checklist.beat_structure_ok).toBeNull();
  });
});

describe('Orchestrator createContent + channel', () => {
  it('creates content bound to a channel with the channel target age', () => {
    const orch = new Orchestrator();
    const id = orch.createContent({ topic: 'toys' }, TOYMONSTER);
    const c = contentRepo.get(id)!;
    expect(c.channel_id).toBe(TOYMONSTER);
    expect(c.target_age).toBe('3-8');
  });

  it('creates content without a channel (channel_id null)', () => {
    const orch = new Orchestrator();
    const id = orch.createContent({});
    const c = contentRepo.get(id)!;
    expect(c.channel_id).toBeNull();
    expect(c.target_age).toBeNull();
  });

  it('honors an explicit meta.targetAge even when a channel is set', () => {
    const orch = new Orchestrator();
    const id = orch.createContent({ targetAge: '6-8' }, TOYMONSTER);
    const c = contentRepo.get(id)!;
    expect(c.channel_id).toBe(TOYMONSTER);
    expect(c.target_age).toBe('6-8');
  });
});
