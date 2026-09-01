import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildScenePrompt, visualAgent, type AssetsManifest } from '../src/agents/visual.js';
import type { ProductionPlan } from '../src/agents/contracts.js';

const PLAN: ProductionPlan = {
  title: 'The Brave Puppy',
  targetAge: '5',
  totalDurationSeconds: 60,
  visualStyle: 'pastel cartoon',
  scenes: [
    {
      id: 'S1',
      durationSeconds: 30,
      characters: ['Puppy'],
      location: 'park',
      action: 'puppy walks through grass',
      camera: 'wide shot',
      emotion: 'hopeful',
      narration: 'Here we go.',
    },
    {
      id: 'S2',
      durationSeconds: 30,
      characters: ['Puppy', 'Butterfly'],
      location: 'park',
      action: 'puppy chases a butterfly',
      camera: 'medium',
      emotion: 'joyful',
      narration: 'Look at that!',
    },
  ],
};

const FAKE_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

const tmpRoots: string[] = [];

function tempAssetDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'aicf-visual-'));
  tmpRoots.push(d);
  return d;
}

afterAll(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true });
});

describe('buildScenePrompt', () => {
  it('includes scene action, location, characters, emotion, camera and style', () => {
    const p = buildScenePrompt(PLAN, PLAN.scenes[0]!, 0);
    expect(p).toContain('puppy walks through grass');
    expect(p).toContain('in park');
    expect(p).toContain('featuring Puppy');
    expect(p).toContain('emotion: hopeful');
    expect(p).toContain('camera: wide shot');
    expect(p).toContain('pastel cartoon');
    expect(p).toContain('vertical 9:16 still, storyboard frame 1');
  });

  it('is deterministic for the same scene', () => {
    expect(buildScenePrompt(PLAN, PLAN.scenes[0]!, 0)).toBe(buildScenePrompt(PLAN, PLAN.scenes[0]!, 0));
  });
});

describe('visualAgent', () => {
  it('writes one image file per scene and returns the manifest', async () => {
    const dir = tempAssetDir();
    let calls = 0;
    const out = await visualAgent(
      { plan: PLAN, contentId: 'content_test1' },
      {
        generateImage: async ({ prompt }) => {
          calls++;
          expect(prompt).toContain('pastel cartoon');
          return { mime: 'image/png', bytes: FAKE_PNG, costEur: 0.002 };
        },
        assetDir: () => dir,
      },
    );

    expect(calls).toBe(2);
    expect(out.count).toBe(2);
    expect(out.assets.contentId).toBe('content_test1');
    expect(out.assets.visualStyle).toBe('pastel cartoon');

    const manifest = out.assets as AssetsManifest;
    expect(manifest.scenes).toHaveLength(2);
    expect(manifest.scenes[0]!.sceneId).toBe('S1');
    expect(manifest.scenes[0]!.file).toBe('S1.png');
    expect(manifest.scenes[0]!.mime).toBe('image/png');
    expect(manifest.scenes[1]!.file).toBe('S2.png');

    // Files actually written + byte-identical.
    for (const s of manifest.scenes) {
      const abs = join(dir, s.file);
      expect(existsSync(abs)).toBe(true);
      expect(readFileSync(abs).equals(FAKE_PNG)).toBe(true);
    }
  });

  it('uses jpg extension for non-png mimes', async () => {
    const dir = tempAssetDir();
    const out = await visualAgent(
      { plan: PLAN, contentId: 'content_test2' },
      {
        generateImage: async () => ({ mime: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff]), costEur: 0.001 }),
        assetDir: () => dir,
      },
    );
    expect(out.assets.scenes[0]!.file).toBe('S1.jpg');
    expect(existsSync(join(dir, 'S1.jpg'))).toBe(true);
  });
});