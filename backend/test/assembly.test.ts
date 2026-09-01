import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  assemblyAgent,
  buildClipPrompt,
  buildSubtitles,
  formatVttTime,
  normalizedTimings,
  type FinalVideoManifest,
} from '../src/agents/assembly.js';
import { buildStubClip, callOmniRouteVideo, gifLzwEncode } from '../src/gateway/video.js';
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
      narration: 'Once upon a time, a brave puppy set out.',
    },
    {
      id: 'S2',
      durationSeconds: 30,
      characters: ['Puppy', 'Butterfly'],
      location: 'park',
      action: 'puppy chases a butterfly',
      camera: 'medium',
      emotion: 'joyful',
      narration: 'And then it was off!',
    },
  ],
};

const INPUT = {
  plan: PLAN,
  contentId: 'content_test1',
  sceneImages: [
    { sceneId: 'S1', file: 'S1.png', mime: 'image/png' },
    { sceneId: 'S2', file: 'S2.png', mime: 'image/png' },
  ],
  sceneVoice: [
    { sceneId: 'S1', file: 'audio/S1.wav', mime: 'audio/wav', durationSeconds: 3 },
    { sceneId: 'S2', file: 'audio/S2.wav', mime: 'audio/wav', durationSeconds: 2.5 },
  ],
};

const FAKE_GIF = buildStubClip(7); // real deterministic animated GIF

const tmpRoots: string[] = [];

function tempAssemblyDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'aicf-assembly-'));
  tmpRoots.push(d);
  return d;
}

afterAll(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true });
});

describe('buildClipPrompt', () => {
  it('includes scene action, location, characters, emotion, camera and style', () => {
    const p = buildClipPrompt(PLAN, PLAN.scenes[0]!, 0);
    expect(p).toContain('puppy walks through grass');
    expect(p).toContain('in park');
    expect(p).toContain('featuring Puppy');
    expect(p).toContain('emotion: hopeful');
    expect(p).toContain('camera: wide shot');
    expect(p).toContain('pastel cartoon');
    expect(p).toContain('vertical 9:16');
  });

  it('is deterministic for the same scene', () => {
    expect(buildClipPrompt(PLAN, PLAN.scenes[0]!, 0)).toBe(buildClipPrompt(PLAN, PLAN.scenes[0]!, 0));
  });
});

describe('timeline helpers', () => {
  it('normalizedTimings sums exactly to the plan total', () => {
    const t = normalizedTimings(PLAN.scenes, PLAN.totalDurationSeconds);
    expect(t).toHaveLength(2);
    expect(t[0]!.startSec).toBe(0);
    expect(t[0]!.endSec).toBeCloseTo(30, 6);
    expect(t[1]!.startSec).toBeCloseTo(30, 6);
    expect(t[1]!.endSec).toBeCloseTo(60, 6);
    const lastEnd = t[t.length - 1]!.endSec;
    expect(lastEnd).toBeCloseTo(PLAN.totalDurationSeconds, 6);
  });

  it('formatVttTime renders WebVTT-friendly timestamps', () => {
    expect(formatVttTime(0)).toBe('00:00:00.000');
    expect(formatVttTime(3.5)).toBe('00:00:03.500');
    expect(formatVttTime(61.25)).toBe('00:01:01.250');
  });
});

describe('buildSubtitles', () => {
  it('produces a WEBVTT block with one cue per scene', () => {
    const vtt = buildSubtitles([
      { sceneId: 'S1', startSec: 0, endSec: 30, narration: 'Once upon a time.', voiceDurationSeconds: 3 },
      { sceneId: 'S2', startSec: 30, endSec: 60, narration: 'And then.', voiceDurationSeconds: 2.5 },
    ]);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain('00:00:00.000 --> 00:00:03.000');
    expect(vtt).toContain('00:00:30.000 --> 00:00:32.500');
    expect(vtt).toContain('Once upon a time.');
  });

  it('clamps cue windows to the scene duration', () => {
    const vtt = buildSubtitles([
      { sceneId: 'S1', startSec: 0, endSec: 1, narration: 'Short.', voiceDurationSeconds: 9 },
    ]);
    expect(vtt).toContain('00:00:00.000 --> 00:00:01.000');
  });

  it('skips empty narrations', () => {
    const vtt = buildSubtitles([
      { sceneId: 'S1', startSec: 0, endSec: 30, narration: '   ', voiceDurationSeconds: 3 },
    ]);
    expect(vtt.split('\n').filter((l) => /-->/.test(l)).length).toBe(0);
    expect(vtt).not.toContain('--> -->');
  });
});

describe('assemblyAgent', () => {
  it('writes one animated clip per scene + subtitles and returns the manifest', async () => {
    const dir = tempAssemblyDir();
    let calls = 0;
    const out = await assemblyAgent(INPUT, {
      generateClip: async ({ prompt, size }) => {
        calls++;
        expect(prompt).toContain('pastel cartoon');
        expect(size).toBe('768x1344');
        return { mime: 'image/gif', bytes: FAKE_GIF, costEur: 0.01 };
      },
      assemblyDir: () => dir,
    });

    expect(calls).toBe(2);
    expect(out.count).toBe(2);

    const v = out.video as FinalVideoManifest;
    expect(v.videoId).toMatch(/^video_.+_2sc$/);
    expect(v.scenes).toHaveLength(2);
    expect(v.scenes[0]!.sceneId).toBe('S1');
    expect(v.scenes[0]!.clipFile).toBe('S1.gif');
    expect(v.scenes[0]!.clipMime).toBe('image/gif');
    expect(v.scenes[0]!.visualFile).toBe('S1.png');
    expect(v.scenes[0]!.voiceFile).toBe('audio/S1.wav');
    expect(v.scenes[0]!.startSec).toBe(0);
    expect(v.scenes[0]!.endSec).toBeCloseTo(30, 6);
    expect(v.scenes[1]!.endSec).toBeCloseTo(60, 6);
    expect(v.durationSec).toBe(60);
    expect(v.resolution).toBe('768x1344');
    expect(v.aspectRatio).toBe('9:16');
    expect(v.subtitleFile).toBe('subtitles.vtt');
    expect(v.poster).toBe('S1.png');
    expect(v.layers.clips).toEqual(['S1.gif', 'S2.gif']);

    // Files actually written + byte-identical.
    for (const s of v.scenes) {
      const abs = join(dir, s.clipFile);
      expect(existsSync(abs)).toBe(true);
      expect(readFileSync(abs).equals(FAKE_GIF)).toBe(true);
    }
    expect(existsSync(join(dir, 'subtitles.vtt'))).toBe(true);
    const vtt = readFileSync(join(dir, 'subtitles.vtt'), 'utf8');
    expect(vtt.startsWith('WEBVTT')).toBe(true);
  });

  it('is reproducible: identical inputs yield an identical manifest', async () => {
    const dirA = tempAssemblyDir();
    const dirB = tempAssemblyDir();
    const deps = {
      generateClip: async () => ({ mime: 'image/gif', bytes: FAKE_GIF, costEur: 0.01 }),
      assemblyDir: () => dirA,
    };
    const a = await assemblyAgent(INPUT, deps);
    const b = await assemblyAgent(INPUT, { ...deps, assemblyDir: () => dirB });

    expect(a.video).toEqual(b.video);
    expect(a.costEur).toBe(b.costEur);
  });
});

describe('animated-GIF stub (video channel)', () => {
  it('emits a valid GIF89a (header, palette, trailer) that is byte-deterministic', () => {
    const gif = buildStubClip(3);
    expect(gif.slice(0, 6).toString('ascii')).toBe('GIF89a');
    expect(gif[gif.length - 1]).toBe(0x3b); // trailer
    expect(gif.length).toBeGreaterThan(100);

    const again = buildStubClip(3);
    expect(again.equals(gif)).toBe(true);

    // Different seed => different bytes (scene-dependent motion/palette).
    const other = buildStubClip(4);
    expect(other.equals(gif)).toBe(false);
  });

  it('gifLzwEncode produces sub-block LZW data with an end-of-info code', () => {
    const data = gifLzwEncode(new Uint8Array([0, 1, 0, 2, 0, 1, 0]), 4);
    expect(data[0]).toBeGreaterThan(0); // first sub-block length
    expect(data[data.length - 1]).toBe(0); // zero-length block terminates
  });

  it('callOmniRouteVideo returns the deterministic stub when live is off (sanity)', async () => {
    // OMNIROUTE_VIDEO_STUB defaults to on; assert it does NOT hit the network.
    const r = await callOmniRouteVideo({ model: 'veo-free/veo', prompt: 'test', size: '768x1344' });
    expect(r.mime).toBe('image/gif');
    expect(r.provider).toBe('stub');
    expect(r.bytes.slice(0, 6).toString('ascii')).toBe('GIF89a');
  });
});