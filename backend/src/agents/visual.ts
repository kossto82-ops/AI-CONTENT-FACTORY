import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  callOmniRouteImage,
  estimateImageCostEur,
  IMAGE_MODEL,
  IMAGE_SIZE,
  type ImageGenerationResult,
} from '../gateway/image.js';
import type { ProductionPlan } from './contracts.js';

/**
 * Visual Agent — generates one still image per scene from the ProductionPlan.
 * Produces an `assets` manifest (JSON) whose entries point at image files on
 * disk. This is binary I/O, so the agent owns the disk write; the manifest is
 * what gets persisted as the artifact (DB stays JSON-only).
 *
 * The contentId is passed in the job input so the agent writes under its own
 * `assets/{contentId}/` directory. `generate` is injectable for deterministic
 * unit tests (no gateway).
 */

export interface SceneAsset {
  sceneId: string;
  file: string; // relative path from the content's asset dir (servable)
  mime: string;
  bytes: number;
}

export interface AssetsManifest {
  contentId: string;
  visualStyle: string;
  totalDurationSeconds: number;
  scenes: SceneAsset[];
}

export interface VisualInput {
  plan: ProductionPlan;
  contentId: string;
}

export interface VisualOutput {
  assets: AssetsManifest;
  count: number;
  costEur: number;
  model: string;
  provider: string;
}

export interface SceneImage {
  mime: string;
  bytes: Buffer;
  model?: string;
  costEur?: number;
}

export interface VisualDeps {
  generateImage(input: { prompt: string; size: string }): Promise<SceneImage>;
  /** Absolute directory for a content's assets (default: <repo>/assets/{contentId}/). */
  assetDir(contentId: string): string;
}

const ASSETS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');

export function defaultAssetDir(contentId: string): string {
  return join(ASSETS_ROOT, contentId);
}

/** Build a deterministic image prompt for one scene (character-consistent). */
export function buildScenePrompt(
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
    `vertical 9:16 still, storyboard frame ${index + 1}`,
    'no text, no watermark, no words',
  ].filter(Boolean);
  return parts.join(', ');
}

/** Generate all scene images and write them under the content's asset dir. */
export async function visualAgent(
  input: VisualInput,
  deps: VisualDeps = {
    generateImage: ({ prompt, size }) =>
      callOmniRouteImage({ model: IMAGE_MODEL, prompt, size }).then((r) => ({
        mime: r.mime,
        bytes: r.bytes,
        model: r.model,
        costEur: estimateImageCostEur(),
      })),
    assetDir: defaultAssetDir,
  },
): Promise<VisualOutput> {
  const plan = input.plan;
  const dir = deps.assetDir(input.contentId);
  mkdirSync(dir, { recursive: true });

  const scenes: SceneAsset[] = [];
  let cost = 0;
  let model = IMAGE_MODEL;
  let provider = 'omniroute';

  for (let i = 0; i < plan.scenes.length; i++) {
    const scene = plan.scenes[i]!;
    const prompt = buildScenePrompt(plan, scene, i);
    const gen = await deps.generateImage({ prompt, size: IMAGE_SIZE });
    const ext = gen.mime === 'image/png' ? 'png' : 'jpg';
    const rel = `${scene.id}.${ext}`;
    writeFileSync(join(dir, rel), gen.bytes);

    scenes.push({ sceneId: scene.id, file: rel, mime: gen.mime, bytes: gen.bytes.length });
    cost += gen.costEur ?? estimateImageCostEur();
    model = gen.model ?? model;
    provider = 'omniroute';
  }

  return {
    assets: {
      contentId: input.contentId,
      visualStyle: plan.visualStyle,
      totalDurationSeconds: plan.totalDurationSeconds,
      scenes,
    },
    count: scenes.length,
    costEur: cost,
    model,
    provider,
  };
}
