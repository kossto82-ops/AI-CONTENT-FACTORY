import { mkdirSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import type { ProductionPlan } from './contracts.js';
import type { FinalVideoManifest } from './assembly.js';

/**
 * Video Render Agent — produces a real, muxed MP4 from the assembly composition
 * (Phase 13 / render pipeline step). This closes the gap Decision D-14 left
 * open: rather than shipping "composition DATA", we call ffmpeg to produce a
 * single 9:16 MP4 (H.264 + AAC) that can actually be downloaded, served and
 * (later) uploaded to YouTube/Reels.
 *
 * Inputs are already on disk from the upstream agents:
 *   - per-scene still image   assets/{contentId}/{visualFile}      (Visual Agent)
 *   - per-scene narration     assets/{contentId}/{voiceFile}       (Voice Agent)
 *   - assembly manifest        (timings: start/end per scene, subtitle file)
 *
 * The render is deterministic given those inputs: for each scene we build a
 * clipped video segment from the still image (Ken Burns drift) muxed with the
 * narration clip, concat the segments, then concat/mix the audio track,
 * writing final.mp4. Subtitles are NOT burned in (ffmpeg's subtitles filter is
 * fragile with the Windows VTT path escaping); the .vtt stays a separate
 * asset that a platform upload can attach as captions.
 *
 * Like Visual/Voice/Assembly the agent owns binary I/O and is fully
 * E2E-testable offline; ffmpeg is spawned via an injectable `runFfmpeg` dep for
 * unit tests (no binary required in CI).
 */

const ASSETS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');

export const RENDER_MIME = 'video/mp4';
export const RENDER_RESOLUTION_W = 1080;
export const RENDER_RESOLUTION_H = 1920;
export const RENDER_FPS = 25;

export interface RenderSceneInput {
  sceneId: string;
  /** Image file from the latest `assets` manifest (relative, servable). */
  visualFile: string;
  /** Audio file from the latest `voice` manifest (relative, servable). */
  voiceFile: string;
  startSec: number;
  endSec: number;
}

export interface RenderInput {
  plan: ProductionPlan;
  contentId: string;
  scenes: RenderSceneInput[];
  /** Assembly manifest for the timings/subtitle metadata (optional fallback). */
  assemblyManifest?: FinalVideoManifest | null;
  /** Absolute directory to write final.mp4 into (default: assembly dir). */
  renderDir?: string;
  /** Absolute directory holding the input assets (images/audio). Defaults to
   *  the content's `assets/{contentId}` in production; injectable for tests. */
  assetsDir?: string;
}

export interface RenderResult {
  contentId: string;
  file: string;
  relativePath: string;
  resolution: string;
  fps: number;
  durationSec: number;
  mime: string;
  model: string;
  provider: string;
  scenes: { sceneId: string; startSec: number; endSec: number; durationSec: number }[];
}

export interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * injectable ffmpeg runner. Defaults to spawning `config.ffmpeg.path` with the
 * given args. Tests replace this with a recorder/stub to avoid needing a real
 * binary.
 */
export type FfmpegRunner = (args: string[]) => Promise<SpawnResult>;

export function defaultFfmpegRunner(args: string[]): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.ffmpeg.path, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('error', (err) => reject(err));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

export function defaultRenderDir(contentId: string): string {
  return join(ASSETS_ROOT, contentId, 'assembly');
}

/** Duration of a scene, clamped to a positive value. */
function sceneDurationSec(s: RenderSceneInput): number {
  return Math.max(0.4, (s.endSec ?? 0) - (s.startSec ?? 0));
}

/**
 * Resolve the on-disk path of an asset that may live in a known subdirectory
 * (the manifest stores bare `file` names, but voice WAVs are written under
 * `audio/`). Returns the first candidate that exists, else null.
 */
function resolveAssetPath(contentDir: string, file: string, subdirs: string[]): string | null {
  const candidates = [join(contentDir, file), ...subdirs.map((d) => join(contentDir, d, file))];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * Build the ffmpeg argument list that produces `final.mp4` for the given
 * scenes. Pure (no I/O) so it is directly unit-testable.
 */
export function buildRenderArgs(input: RenderInput): { args: string[]; inputs: string[]; output: string } {
  const contentDir = input.assetsDir ?? join(ASSETS_ROOT, input.contentId);
  const outputDir = input.renderDir ?? defaultRenderDir(input.contentId);
  const scenes = input.scenes;
  const n = scenes.length;

  mkdirSync(outputDir, { recursive: true });

  const args = ['-y'];
  const inputs: string[] = [];

  // Video inputs: one looping still per scene, clipped to its duration.
  for (const s of scenes) {
    const img = resolveAssetPath(contentDir, s.visualFile, ['images', 'visual']);
    if (!img) throw new Error(`render input image missing: ${s.visualFile}`);
    args.push('-loop', '1', '-t', sceneDurationSec(s).toFixed(3), '-i', img);
    inputs.push(img);
  }
  // Audio inputs: narration wav per scene (written under audio/ by Voice Agent).
  const audioPaths: (string | null)[] = [];
  for (const s of scenes) {
    const wav = resolveAssetPath(contentDir, s.voiceFile, ['audio', 'voice']);
    audioPaths.push(wav);
    if (wav) {
      args.push('-i', wav);
    }
  }

  // ---- filter_complex ----
  const fc: string[] = [];
  const vOuts: string[] = [];

  for (let i = 0; i < n; i++) {
    // Scale to fill 9:16, then a slow Ken Burns zoom-drift so the still is not
    // dead static. format=yuv420p is required for H.264 / YouTube compatibility.
    const v = `scale=${RENDER_RESOLUTION_W}:${RENDER_RESOLUTION_H}:force_original_aspect_ratio=increase:force_divisible_by=2,` +
      `crop=${RENDER_RESOLUTION_W}:${RENDER_RESOLUTION_H},` +
      `zoompan=z='min(zoom+0.0008,1.2)':d=1:fps=${RENDER_FPS}:s=${RENDER_RESOLUTION_W}x${RENDER_RESOLUTION_H},` +
      `format=yuv420p,setsar=1`;
    fc.push(`[${i}:v]${v}[v${i}]`);
    vOuts.push(`[v${i}]`);
  }

  // Concat all video segments -> [vout].
  fc.push(`${vOuts.join('')}concat=n=${n}:v=1:a=0[outv]`);

  // Audio: each scene's narration, delayed to its start, resampled to stereo.
  const activeAudio: number[] = [];
  let audioIndex = n; // video inputs occupy 0..n-1
  for (let i = 0; i < n; i++) {
    if (!audioPaths[i]) continue; // skip missing narration
    const ms = Math.round(scenes[i]!.startSec * 1000);
    fc.push(
      `[${audioIndex}:a]aresample=48000,aformat=channel_layouts=stereo,` +
        `adelay=${ms}|${ms}[a${i}]`,
    );
    activeAudio.push(i);
    audioIndex++;
  }
  if (activeAudio.length === 0) {
    // No narration at all: silent track for the full duration.
    const total = scenes.reduce((t, s) => t + sceneDurationSec(s), 0);
    fc.push(`anullsrc=channel_layout=stereo:sample_rate=48000,duration=${total.toFixed(3)}[silent]`);
    fc.push(`[silent]atrim=0:${total.toFixed(3)}[outa]`);
  } else {
    const mixInputs = activeAudio.map((i) => `[a${i}]`).join('');
    fc.push(`${mixInputs}amix=inputs=${activeAudio.length}:normalize=0:dropout_transition=0[outa]`);
  }

  // Mux video + audio into final.mp4 (H.264 + AAC, faststart for streaming).
  const output = join(outputDir, 'final.mp4');
  args.push('-filter_complex', fc.join(';'), '-map', '[outv]', '-map', '[outa]');
  args.push('-r', String(RENDER_FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23');
  args.push('-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart');
  args.push(output);

  return { args, inputs, output };
}

/**
 * Render the final MP4 for a content. Returns a RenderResult metadata object
 * that becomes the `video_render` artifact.
 */
export async function renderAgent(
  input: RenderInput,
  runFfmpeg: FfmpegRunner = defaultFfmpegRunner,
): Promise<RenderResult> {
  const { args, output } = buildRenderArgs(input);

  const res = await runFfmpeg(args);
  if (res.code !== 0) {
    throw new Error(
      `ffmpeg render failed (code ${res.code}): ${(res.stderr || res.stdout).slice(-800)}`,
    );
  }
  if (!existsSync(output)) throw new Error('ffmpeg exited 0 but produced no final.mp4');

  const duration = input.scenes.reduce((t, s) => t + sceneDurationSec(s), 0);
  return {
    contentId: input.contentId,
    file: 'final.mp4',
    relativePath: `assembly/final.mp4`,
    resolution: `${RENDER_RESOLUTION_W}x${RENDER_RESOLUTION_H}`,
    fps: RENDER_FPS,
    durationSec: Math.round(duration * 10) / 10,
    mime: RENDER_MIME,
    model: 'ffmpeg',
    provider: config.ffmpeg.path,
    scenes: input.scenes.map((s) => ({
      sceneId: s.sceneId,
      startSec: s.startSec,
      endSec: s.endSec,
      durationSec: Math.round(sceneDurationSec(s) * 10) / 10,
    })),
  };
}

/** Rough flat estimate — rendering is local CPU, cost 0. */
export function estimateRenderCostEur(): number {
  return 0;
}