import { describe, expect, it } from 'vitest';
import type { ToolContract, ToolResult } from '../src/capabilities/contract.js';
import {
  PREFERRED_PROVIDER_GAP,
  pickTool,
  scoreTool,
} from '../src/capabilities/scoring.js';
import {
  allTools,
  capabilityCatalog,
  capabilityList,
  getByCapability,
  getTool,
  providerMenu,
  register,
  resolve,
  runCapability,
} from '../src/capabilities/registry.js';
import {
  YOUTUBE_SHORTS,
  getMediaProfile,
  findProfileForSize,
} from '../src/contracts/mediaProfiles.js';

function makeTool(partial: Partial<ToolContract> & { id: string; capability: ToolContract['capability'] }): ToolContract {
  return {
    name: partial.id,
    version: '1.0.0',
    provider: 'test',
    tier: 'generate',
    runtime: 'api',
    determinism: 'stochastic',
    availability: 'available',
    describe: () => partial.id,
    run: async () => ({ ok: true, capability: partial.capability, toolId: partial.id, usage: { requests: 1, costEur: 0 } } satisfies ToolResult),
    ...partial,
  };
}

describe('capability contract', () => {
  it('ToolContract describes capability + provider + runtime', () => {
    const t = makeTool({ id: 'wan21', capability: 'VIDEO_GENERATION', runtime: 'local_gpu' });
    expect(t.capability).toBe('VIDEO_GENERATION');
    expect(t.runtime).toBe('local_gpu');
    expect(t.availability).toBe('available');
    expect(t.describe()).toBe('wan21');
  });
});

describe('media profiles', () => {
  it('exposes the YouTube Shorts profile as the primary target', () => {
    expect(YOUTUBE_SHORTS.id).toBe('youtube-shorts');
    expect(YOUTUBE_SHORTS.width).toBe(1080);
    expect(YOUTUBE_SHORTS.height).toBe(1920);
    expect(YOUTUBE_SHORTS.fps).toBe(30);
    expect(YOUTUBE_SHORTS.maxDurationSec).toBe(60);
    expect(YOUTUBE_SHORTS.aspect).toBe('9:16');
  });

  it('looks up profiles by id and finds by size', () => {
    expect(getMediaProfile('youtube-shorts').id).toBe('youtube-shorts');
    expect(findProfileForSize(1080, 1920, 30)?.id).toBe('youtube-shorts');
    expect(findProfileForSize(9999, 1)).toBeUndefined();
  });

  it('throws for unknown profile ids', () => {
    expect(() => getMediaProfile('nope')).toThrow(/Unknown media profile/);
  });
});

describe('scoring', () => {
  it('ranks availability above everything — unavailable never wins', () => {
    const available = makeTool({ id: 'a', capability: 'IMAGE_GENERATION', availability: 'available' });
    const degraded = makeTool({ id: 'b', capability: 'IMAGE_GENERATION', availability: 'degraded' });
    const unavailable = makeTool({ id: 'c', capability: 'IMAGE_GENERATION', availability: 'unavailable' });
    const ranked = pickTool([available, degraded, unavailable], 'IMAGE_GENERATION');
    expect(ranked?.tool.id).toBe('a');
    expect(unavailable).not.toBe(ranked?.tool);
  });

  it('respects the preferred-provider gap to avoid flapping', () => {
    const t1 = makeTool({ id: 't1', capability: 'TTS', availability: 'available' });
    const t2 = makeTool({ id: 't2', capability: 'TTS', availability: 'available' });
    const s1 = scoreTool(t1, 'TTS');
    const s2 = scoreTool(t2, 'TTS');
    expect(Math.abs(s1.total - s2.total)).toBeLessThan(PREFERRED_PROVIDER_GAP);
    // pickTool with a prefs.runtime should bias local even when scores tie.
    const local = makeTool({ id: 'local', capability: 'TTS', runtime: 'local', availability: 'available' });
    const api = makeTool({ id: 'api', capability: 'TTS', runtime: 'api', availability: 'available' });
    const picked = pickTool([api, local], 'TTS', { runtime: 'local' });
    expect(picked?.tool.id).toBe('local');
  });

  it('scores only matching capabilities', () => {
    const t = makeTool({ id: 'img', capability: 'IMAGE_GENERATION' });
    expect(() => scoreTool(t, 'TTS')).toThrow(/does not satisfy capability/);
  });
});

describe('registry', () => {
  it('registers, retrieves, and lists tools/capabilities', () => {
    const t = makeTool({ id: 'regtest', capability: 'MUSIC_GENERATION' });
    register(t);
    expect(getTool('regtest')?.id).toBe('regtest');
    expect(allTools()).toContainEqual(t);
    expect(getByCapability('MUSIC_GENERATION').map((x) => x.id)).toContain('regtest');
    expect(capabilityList()).toContain('MUSIC_GENERATION');
  });

  it('builds a catalog + provider menu (self-describing install)', () => {
    const t = makeTool({
      id: 'catalogdemo',
      capability: 'SFX_GENERATION',
      availability: 'unavailable',
      dependencyKeys: ['binary:ffmpeg'],
    });
    register(t);
    const cat = capabilityCatalog();
    expect(cat['SFX_GENERATION']).toHaveLength(1);
    expect(cat['SFX_GENERATION']?.[0]?.needsSetup).toBe(true);
    const menu = providerMenu();
    expect(menu['SFX_GENERATION']?.[0]).toContain('catalogdemo');
  });

  it('resolves to a route with a chosen tool + rationale', () => {
    register(makeTool({ id: 'resimg', capability: 'IMAGE_GENERATION', availability: 'available' }));
    const route = resolve('IMAGE_GENERATION');
    expect(route?.chosen.id).toBe('resimg');
    expect(route?.rationale).toContain('capability=IMAGE_GENERATION');
  });

  it('returns null when no tool exists for a capability', async () => {
    expect(resolve('PUBLISH')).toBeNull();
    await expect(runCapability('PUBLISH', {})).resolves.toMatchObject({ ok: false });
  });

  it('runCapability runs the chosen tool for a resolvable capability', async () => {
    register(
      makeTool({
        id: 'runimg',
        capability: 'IMAGE_GENERATION',
        run: async () => ({ ok: true, capability: 'IMAGE_GENERATION', toolId: 'runimg', artifactKind: 'assets', usage: { requests: 1, costEur: 0 } }),
      }),
    );
    const res = await runCapability('IMAGE_GENERATION', { prompt: 'x' });
    expect(res.ok).toBe(true);
    expect(res.toolId).toBe('runimg');
    expect(res.capability).toBe('IMAGE_GENERATION');
  });

  it('runCapability surfaces a tool failure without throwing', async () => {
    register(
      makeTool({
        id: 'boommod',
        capability: 'MODERATION',
        run: async () => {
          throw new Error('boom');
        },
      }),
    );
    // Unique capability so the failing tool is the only candidate.
    const res = await runCapability('MODERATION', { probe: 'boom' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('boom');
  });
});
