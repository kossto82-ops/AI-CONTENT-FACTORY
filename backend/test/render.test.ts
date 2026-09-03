import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildRenderArgs,
  renderAgent,
  RENDER_RESOLUTION_W,
  RENDER_RESOLUTION_H,
  RENDER_FPS,
  RENDER_MIME,
  type RenderInput,
  type SpawnResult,
} from '../src/agents/render.js';

const TINY_JPG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const TINY_WAV = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
]);

function makeInput(dir: string): RenderInput {
  return {
    contentId: 'content_render_test',
    plan: {
      title: 'The Brave Puppy',
      targetAge: '5',
      totalDurationSeconds: 9,
      visualStyle: 'pastel cartoon',
      scenes: [
        {
          id: 'S1',
          durationSeconds: 3,
          characters: ['Puppy'],
          location: 'park',
          action: 'puppy walks',
          camera: 'wide',
          emotion: 'hopeful',
          narration: 'Once upon a time.',
        },
        {
          id: 'S2',
          durationSeconds: 3,
          characters: ['Puppy'],
          location: 'park',
          action: 'puppy chases',
          camera: 'medium',
          emotion: 'joyful',
          narration: 'And then it ran!',
        },
        {
          id: 'S3',
          durationSeconds: 3,
          characters: ['Puppy'],
          location: 'park',
          action: 'puppy returns',
          camera: 'close',
          emotion: 'calm',
          narration: 'All safe.',
        },
      ],
    },
    scenes: [
      { sceneId: 'S1', visualFile: 'S1.jpg', voiceFile: 'S1.wav', startSec: 0, endSec: 3 },
      { sceneId: 'S2', visualFile: 'S2.jpg', voiceFile: 'S2.wav', startSec: 3, endSec: 6 },
      { sceneId: 'S3', visualFile: 'S3.jpg', voiceFile: 'S3.wav', startSec: 6, endSec: 9 },
    ],
    assetsDir: dir,
    renderDir: join(dir, 'assembly'),
  };
}

function scaffoldAssets(dir: string): void {
  // Real voice files live under `audio/` (matches Voice Agent behaviour).
  mkdirSync(join(dir, 'audio'), { recursive: true });
  for (const s of ['S1', 'S2', 'S3']) {
    writeFileSync(join(dir, `${s}.jpg`), TINY_JPG);
    writeFileSync(join(dir, 'audio', `${s}.wav`), TINY_WAV);
  }
}

const tmpRoots: string[] = [];

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'aicf-render-'));
  tmpRoots.push(d);
  return d;
}

afterAll(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true });
});

describe('buildRenderArgs', () => {
  it('builds a 9:16 MP4 pipeline: per-scene loop inputs, concat, amix, libx264', () => {
    const dir = tempDir();
    scaffoldAssets(dir);
    const input = makeInput(dir);
    const { args, output } = buildRenderArgs(input);

    expect(output).toBe(join(dir, 'assembly', 'final.mp4'));
    // 3 image inputs (loop) + 3 audio inputs
    expect(args.filter((a) => a === '-i').length).toBe(6);

    const fcIdx = args.indexOf('-filter_complex');
    const fc = args[fcIdx + 1]!;

    // Per-scene Ken Burns scale to 9:16 + yuv420p
    expect(fc).toContain(`${RENDER_RESOLUTION_W}x${RENDER_RESOLUTION_H}`);
    expect(fc).toContain('zoompan');
    expect(fc).toContain('format=yuv420p');
    // Concatenate 3 video segments
    expect(fc).toContain('concat=n=3:v=1:a=0[outv]');
    // Audio: each narration delayed via adelay to its start + amix
    expect(fc).toContain('amix=inputs=3:normalize=0');
    expect(fc).toContain('adelay=0|0');
    expect(fc).toContain('adelay=3000|3000');

    // Encoders/mux
    expect(args).toContain('libx264');
    expect(args).toContain('aac');
    expect(args[args.length - 1]).toBe(output);
  });

  it('affects the audio index correctly when some narration is missing', () => {
    const dir = tempDir();
    // Only S1 has an image + narration; S2/S3 images exist but no wav.
    scaffoldAssets(dir);
    rmSync(join(dir, 'audio', 'S2.wav'));
    rmSync(join(dir, 'audio', 'S3.wav'));
    const input = makeInput(dir);
    const { args } = buildRenderArgs(input);
    expect(args.filter((a) => a === '-i').length).toBe(4); // 3 imgs + 1 remaining wav (S1)
    const fcIdx = args.indexOf('-filter_complex');
    const fc = args[fcIdx + 1]!;
    expect(fc).toContain('amix=inputs=1:normalize=0');
  });

  it('produces a silent track when there is no narration at all', () => {
    const dir = tempDir();
    scaffoldAssets(dir);
    for (const s of ['S1', 'S2', 'S3']) rmSync(join(dir, 'audio', `${s}.wav`));
    const input = makeInput(dir);
    const { args } = buildRenderArgs(input);
    const fcIdx = args.indexOf('-filter_complex');
    const fc = args[fcIdx + 1]!;
    expect(fc).toContain('anullsrc');
    // anullsrc has no `duration` option (ffmpeg rejects it); the silent track
    // must be length-clamped with atrim=end=... instead.
    expect(fc).not.toContain('anullsrc=channel_layout=stereo:sample_rate=48000,duration=');
    expect(fc).toContain('anullsrc=channel_layout=stereo:sample_rate=48000[silent]');
    expect(fc).toContain('atrim=end=9.000[outa]');
  });

  it('uses a real IA video clip as the scene layer when one exists (no Ken Burns)', () => {
    const dir = tempDir();
    scaffoldAssets(dir);
    const input = makeInput(dir);
    // S2 has a real MP4 clip in assembly/; S1/S3 only stills.
    mkdirSync(join(dir, 'assembly'), { recursive: true });
    writeFileSync(join(dir, 'assembly', 'S2.mp4'), Buffer.from('FAKE MP4'));
    input.scenes = [
      { sceneId: 'S1', visualFile: 'S1.jpg', voiceFile: 'S1.wav', startSec: 0, endSec: 3 },
      {
        sceneId: 'S2',
        visualFile: 'S2.jpg',
        voiceFile: 'S2.wav',
        clipFile: 'S2.mp4',
        clipMime: 'video/mp4',
        startSec: 3,
        endSec: 6,
      },
      { sceneId: 'S3', visualFile: 'S3.jpg', voiceFile: 'S3.wav', startSec: 6, endSec: 9 },
    ];
    const { args } = buildRenderArgs(input);
    const fcIdx = args.indexOf('-filter_complex');
    const fc = args[fcIdx + 1]!;
    // S2's layer uses the clip (scale/crop/fps, NO zoompan); S1/S3 still have motion.
    expect(fc).toContain('concat=n=3:v=1:a=0[outv]');
    const s2segment = fc.split(';').find((c) => c.startsWith('[1:v]'))!;
    expect(s2segment).toContain('fps=');
    expect(s2segment).not.toContain('zoompan');
    // The clip input was added WITHOUT -loop (a still would use -loop 1).
    const iLoopCount = args.filter((a, i) => a === '-loop' && args[i + 1] === '1').length;
    expect(iLoopCount).toBe(2); // S1 + S3 stills only
    // 3 video inputs (2 stills + 1 clip) + 3 narration wavs = 6 `-i`.
    expect(args.filter((a) => a === '-i').length).toBe(6);
  });
});

describe('renderAgent', () => {
  it('writes final.mp4 via the ffmpeg runner and returns metadata', async () => {
    const dir = tempDir();
    scaffoldAssets(dir);
    const input = makeInput(dir);

    let renderedArgs: string[] | null = null;
    const fake: (args: string[]) => Promise<SpawnResult> = async (args) => {
      renderedArgs = args;
      // Simulate ffmpeg writing the output (renderDir/assembly/final.mp4).
      mkdirSync(join(dir, 'assembly'), { recursive: true });
      writeFileSync(join(dir, 'assembly', 'final.mp4'), Buffer.from('MP4'));
      return { code: 0, stdout: '', stderr: '' };
    };

    const result = await renderAgent(input, fake);

    expect(renderedArgs?.some((a) => a.endsWith('final.mp4'))).toBe(true);
    expect(result.file).toBe('final.mp4');
    expect(result.relativePath).toBe('assembly/final.mp4');
    expect(result.resolution).toBe(`${RENDER_RESOLUTION_W}x${RENDER_RESOLUTION_H}`);
    expect(result.fps).toBe(RENDER_FPS);
    expect(result.mime).toBe(RENDER_MIME);
    expect(result.model).toBe('ffmpeg');
    expect(result.durationSec).toBe(9);
    expect(result.scenes).toHaveLength(3);
    expect(existsSync(join(dir, 'assembly', 'final.mp4'))).toBe(true);
  });

  it('throws when ffmpeg fails', async () => {
    const dir = tempDir();
    scaffoldAssets(dir);
    const input = makeInput(dir);
    await expect(
      renderAgent(input, async () => ({ code: 1, stdout: '', stderr: 'cannot mux' })),
    ).rejects.toThrow(/ffmpeg render failed/);
  });

  it('prevents a render when a scene image is missing', async () => {
    const dir = tempDir();
    scaffoldAssets(dir);
    rmSync(join(dir, 'S2.jpg'));
    const input = makeInput(dir);
    await expect(renderAgent(input)).rejects.toThrow(/render input image missing/);
  });
});