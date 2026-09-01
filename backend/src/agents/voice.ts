import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  callOmniRouteSpeech,
  SPEECH_FORMAT,
  SPEECH_MODEL,
  SPEECH_VOICE,
  estimateSpeechCostEur,
  estimateSpeechDurationSeconds,
  type SpeechResult,
} from '../gateway/audio.js';
import type { ProductionPlan } from './contracts.js';

/**
 * Voice Agent — generates one narration audio clip per scene from the
 * ProductionPlan's per-scene `narration` text. Produces a `voice` manifest
 * (JSON) whose entries point at audio files on disk. This is binary I/O, so
 * the agent owns the disk write; the manifest is what gets persisted as the
 * artifact (DB stays JSON-only).
 *
 * The contentId is passed in the job input so the agent writes under its own
 * `assets/{contentId}/audio/` directory. `synthesize` is injectable for
 * deterministic unit tests (no gateway).
 */

export interface SceneAudio {
  sceneId: string;
  file: string; // relative path from the content's audio dir (servable)
  mime: string;
  bytes: number;
  durationSeconds: number;
  text: string;
}

export interface VoiceManifest {
  contentId: string;
  voice: string;
  scenes: SceneAudio[];
}

export interface VoiceInput {
  plan: ProductionPlan;
  contentId: string;
}

export interface VoiceOutput {
  voice: VoiceManifest;
  count: number;
  costEur: number;
  model: string;
  provider: string;
}

export interface VoiceDeps {
  synthesize(input: { text: string; voice: string; format: string }): Promise<SpeechResult>;
  /** Absolute directory for a content's audio (default: <repo>/assets/{contentId}/audio/). */
  audioDir(contentId: string): string;
}

const ASSETS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');

export function defaultAudioDir(contentId: string): string {
  return join(ASSETS_ROOT, contentId, 'audio');
}

const EXT_BY_MIME: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
};

/** Build the narration text snippet for one scene (used for logs/transcripts). */
export function buildNarration(
  plan: ProductionPlan,
  scene: ProductionPlan['scenes'][number],
): string {
  const narration = (scene.narration ?? '').trim();
  if (narration) return narration;
  return `${scene.action}${scene.location ? ` in ${scene.location}` : ''}.`;
}

/** Generate narration audio for every scene and write under the content's audio dir. */
export async function voiceAgent(
  input: VoiceInput,
  deps: VoiceDeps = {
    synthesize: ({ text, voice, format }) =>
      callOmniRouteSpeech({
        model: SPEECH_MODEL,
        input: text,
        voice,
        format: format ?? SPEECH_FORMAT,
      }),
    audioDir: defaultAudioDir,
  },
): Promise<VoiceOutput> {
  const plan = input.plan;
  const dir = deps.audioDir(input.contentId);
  mkdirSync(dir, { recursive: true });

  const scenes: SceneAudio[] = [];
  let cost = 0;
  let provider = 'omniroute';

  for (let i = 0; i < plan.scenes.length; i++) {
    const scene = plan.scenes[i]!;
    const text = buildNarration(plan, scene);
    const gen = await deps.synthesize({ text, voice: SPEECH_VOICE, format: SPEECH_FORMAT });
    const ext = EXT_BY_MIME[gen.mime] ?? 'wav';
    const rel = `${scene.id}.${ext}`;
    writeFileSync(join(dir, rel), gen.bytes);

    scenes.push({
      sceneId: scene.id,
      file: rel,
      mime: gen.mime,
      bytes: gen.bytes.length,
      durationSeconds: gen.durationSeconds || estimateSpeechDurationSeconds(text),
      text,
    });
    cost += estimateSpeechCostEur(text);
    provider = 'omniroute';
  }

  return {
    voice: {
      contentId: input.contentId,
      voice: SPEECH_VOICE,
      scenes,
    },
    count: scenes.length,
    costEur: cost,
    model: SPEECH_MODEL,
    provider,
  };
}
