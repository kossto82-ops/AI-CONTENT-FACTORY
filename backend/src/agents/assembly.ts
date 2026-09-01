import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  callOmniRouteVideo,
  VIDEO_MODEL,
  VIDEO_SIZE,
  estimateVideoCostEur,
  VIDEO_STUB_FPS,
  type VideoGenerationResult,
} from '../gateway/video.js';
import type { ProductionPlan } from './contracts.js';

/**
 * Video Assembly Agent — composes the ProductionPlan + Visual assets + Voice
 * tracks into a reproducible final video (Phase 7).
 *
 * No ffmpeg exists in this environment (Phase 0 audit), so "assembly" is
 * expressed as DATA (Decision D-14): per-scene motion clips generated via the
 * video channel plus an exact, reproducible timeline (scene order, cue times,
 * layer references), a WebVTT subtitle track, and poster references. The
 * Control Center renders this composition in-browser; a real muxed MP4 render
 * is deferred to a future render backend (Remotion/ffmpeg, see audit §Reuse).
 *
 * Like Visual / Voice, the agent owns binary I/O: clips + subtitles.vtt are
 * written under `assets/{contentId}/assembly/` and the JSON manifest is what
 * gets persisted as the artifact (DB stays JSON-only, Decision D-03/D-12).
 */

export interface SceneClipInput {
  sceneId: string;
  /** Image file from the latest `assets` manifest (relative, servable). */
  visualFile: string;
  /** Audio file from the latest `voice` manifest (relative, servable). */
  voiceFile: string;
  /** Narration text used for the subtitle cue. */
  narration: string;
  /** Voice clip duration seconds (from the voice manifest). */
  voiceDurationSeconds: number;
  durationSeconds: number;
}

export interface FinalVideoScene {
  sceneId: string;
  startSec: number;
  endSec: number;
  visualFile: string;
  voiceFile: string;
  clipFile: string;
  clipMime: string;
  clipBytes: number;
  narration: string;
}

export interface FinalVideoManifest {
  videoId: string;
  planId: string;
  contentId: string;
  version: number;
  durationSec: number;
  resolution: string;
  fps: number;
  aspectRatio: '9:16';
  subtitleFile: string;
  scenes: FinalVideoScene[];
  layers: {
    visual: string[];
    voice: string[];
    clips: string[];
    subtitles: string;
    music: string;
    sfx: string;
  };
  exportSettings: {
    codec: string;
    bitrate: string;
    audio: string;
    notes: string;
  };
  reproducibilityNotes: string;
  poster: string;
  model: string;
  provider: string;
  costEur: number;
}

export interface AssemblyInput {
  plan: ProductionPlan;
  contentId: string;
  /** Per-scene still images (latest `assets` manifest scenes). */
  sceneImages: { sceneId: string; file: string; mime: string }[];
  /** Per-scene narration audio (latest `voice` manifest scenes). */
  sceneVoice: { sceneId: string; file: string; mime: string; durationSeconds: number }[];
}

export interface AssemblyOutput {
  video: FinalVideoManifest;
  count: number;
  costEur: number;
  model: string;
  provider: string;
}

export interface SceneClip {
  mime: string;
  bytes: Buffer;
  model?: string;
  costEur?: number;
  durationSeconds?: number;
}

export interface AssemblyDeps {
  generateClip(input: { prompt: string; size: string }): Promise<SceneClip>;
  /** Absolute directory for a content's assembly output. */
  assemblyDir(contentId: string): string;
  /** Helpers for unit tests: construct a manifest id / timing determinism. */
}

const ASSETS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');

export function defaultAssemblyDir(contentId: string): string {
  return join(ASSETS_ROOT, contentId, 'assembly');
}

const EXT_BY_MIME: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'image/gif': 'gif',
};

/** Build a deterministic clip prompt for one scene (visual + motion cues). */
export function buildClipPrompt(
  plan: ProductionPlan,
  scene: ProductionPlan['scenes'][number],
  index: number,
): string {
  const cast = (plan.visualStyle || "children's cartoon").trim();
  const chars = (scene.characters ?? []).join(', ');
  const parts = [
    scene.action,
    scene.location ? `in ${scene.location}` : '',
    chars ? `featuring ${chars}` : '',
    `emotion: ${scene.emotion ?? 'neutral'}`,
    `camera: ${scene.camera ?? 'wide shot'}`,
    `consistent art style: ${cast}`,
    'gentle continuous motion, subtle camera drift, no cuts',
    `vertical 9:16 clip, ${Math.max(1, scene.durationSeconds)}s`,
    'no text, no watermark, no words',
  ].filter(Boolean);
  return parts.join(', ');
}

/** Normalize per-scene durations so the timeline sums exactly to the plan total. */
export function normalizedTimings(
  scenes: { durationSeconds: number }[],
  total: number,
): { startSec: number; endSec: number }[] {
  const raw = scenes.map((s) => Math.max(0.5, s.durationSeconds));
  const rawSum = raw.reduce((a, b) => a + b, 0) || 1;
  const out: { startSec: number; endSec: number }[] = [];
  let t = 0;
  for (let i = 0; i < raw.length; i++) {
    const scaled = (raw[i]! / rawSum) * Math.max(0.5, total);
    out.push({ startSec: t, endSec: t + scaled });
    t += scaled;
  }
  return out;
}

export function formatVttTime(sec: number): string {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const mm = (ms % 1000).toString().padStart(3, '0');
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${mm}`;
}

/** Build the WebVTT subtitle track from per-scene narration + cue windows. */
export function buildSubtitles(
  scenes: {
    sceneId: string;
    startSec: number;
    endSec: number;
    narration: string;
    voiceDurationSeconds: number;
  }[],
): string {
  const lines = ['WEBVTT', ''];
  for (const sc of scenes) {
    const text = (sc.narration ?? '').trim();
    if (!text) continue;
    const cueDur = Math.min(Math.max(0.8, sc.voiceDurationSeconds), Math.max(0.8, sc.endSec - sc.startSec));
    const end = Math.min(sc.startSec + cueDur, sc.endSec);
    lines.push(`${formatVttTime(sc.startSec)} --> ${formatVttTime(Math.max(sc.startSec + 0.8, end))}`, text, '');
  }
  return `${lines.join('\n')}\n`;
}

/** Assemble the final video: per-scene clips + reproducible timeline + VTT. */
export async function assemblyAgent(
  input: AssemblyInput,
  deps: AssemblyDeps = {
    generateClip: ({ prompt, size }) =>
      callOmniRouteVideo({ model: VIDEO_MODEL, prompt, size }).then((r) => ({
        bytes: r.bytes,
        mime: r.mime,
        model: r.model,
        costEur: estimateVideoCostEur(),
      })),
    assemblyDir: defaultAssemblyDir,
  },
): Promise<AssemblyOutput> {
  const plan = input.plan;
  const dir = deps.assemblyDir(input.contentId);
  mkdirSync(dir, { recursive: true });

  const imagesByScene = new Map(input.sceneImages.map((s) => [s.sceneId, s]));
  const voiceByScene = new Map(input.sceneVoice.map((s) => [s.sceneId, s]));
  const timings = normalizedTimings(plan.scenes, plan.totalDurationSeconds);

  const scenes: FinalVideoScene[] = [];
  let cost = 0;
  let usedStub = false;

  for (let i = 0; i < plan.scenes.length; i++) {
    const scene = plan.scenes[i]!;
    const timing = timings[i]!;
    const img = imagesByScene.get(scene.id);
    const vo = voiceByScene.get(scene.id);
    const prompt = buildClipPrompt(plan, scene, i);
    const gen = await deps.generateClip({ prompt, size: VIDEO_SIZE });
    const ext = EXT_BY_MIME[gen.mime] ?? 'mp4';
    const rel = `${scene.id}.${ext}`;
    writeFileSync(join(dir, rel), gen.bytes);

    scenes.push({
      sceneId: scene.id,
      startSec: timing.startSec,
      endSec: timing.endSec,
      visualFile: img?.file ?? `${scene.id}.png`,
      voiceFile: vo?.file ?? `${scene.id}.wav`,
      clipFile: rel,
      clipMime: gen.mime,
      clipBytes: gen.bytes.length,
      narration: scene.narration ?? scene.action,
    });
    cost += gen.costEur ?? estimateVideoCostEur();
    if (gen.mime === 'image/gif') usedStub = true;
  }

  const provider = usedStub ? 'stub' : 'omniroute';
  const model = usedStub ? 'stub-animated-gif (live veo/seedance gating: OMNIROUTE_VIDEO_STUB=0)' : VIDEO_MODEL;

  const poster = input.sceneImages[0]?.file ?? scenes[0]?.visualFile ?? '';
  const subtitles = buildSubtitles(
    scenes.map((s) => ({
      sceneId: s.sceneId,
      startSec: s.startSec,
      endSec: s.endSec,
      narration: s.narration,
      voiceDurationSeconds: voiceByScene.get(s.sceneId)?.durationSeconds ?? 0,
    })),
  );
  writeFileSync(join(dir, 'subtitles.vtt'), Buffer.from(subtitles, 'utf8'));

  const video: FinalVideoManifest = {
    videoId: `video_${input.contentId.slice(-8)}_${plan.scenes.length}sc`,
    planId: plan.title || 'untitled',
    contentId: input.contentId,
    version: 1,
    durationSec: Math.max(0.5, Math.round(plan.totalDurationSeconds * 10) / 10),
    resolution: '768x1344',
    fps: VIDEO_STUB_FPS,
    aspectRatio: '9:16',
    subtitleFile: 'subtitles.vtt',
    scenes,
    layers: {
      visual: scenes.map((s) => s.visualFile),
      voice: scenes.map((s) => s.voiceFile),
      clips: scenes.map((s) => s.clipFile),
      subtitles: 'separate-file',
      music: 'none',
      sfx: 'none',
    },
    exportSettings: {
      codec: 'timeline-composition (no muxer in MVP)',
      bitrate: 'n/a',
      audio: 'scene voice wav (browser preview)',
      notes: 'MVP assembly = reproducible composition data + per-scene clips; real MP4 render (Remotion/ffmpeg) deferred to a render backend.',
    },
    reproducibilityNotes: `inputs: production_plan + assets manifest + voice manifest for ${input.contentId}; per-scene clips deterministic via seed(prompt).`,
    poster,
    model,
    provider,
    costEur: cost,
  };

  return {
    video,
    count: scenes.length,
    costEur: cost,
    model,
    provider,
  };
}