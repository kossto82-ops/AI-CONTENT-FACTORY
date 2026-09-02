import { config } from '../config.js';
import { estimateCostEur } from './router.js';
import { OmniRouteError } from './omniroute.js';

/**
 * Vision-understanding channel — QA's visual review path (Phase 8).
 *
 * OmniRoute speaks the Anthropic-compatible Messages API (POST /v1/messages)
 * for text, and vision-capable combos (`auto/vision`, `auto/best-vision`, ...)
 * additionally accept `image` content blocks with inline base64 sources. This
 * channel lets an agent send actual image bytes to the model and get a text
 * analysis back — the "understanding" half of the image channel (image.ts is
 * generation-only and goes to /v1/images/generations).
 *
 * Honest stub (D-15 pattern, like audio.ts/video.ts): the live round-trip is
 * gated behind `OMNIROUTE_QA_STUB=0`. When unset (`=1`), a deterministic local
 * "no visible issues" verdict is produced so the whole QA wiring stays
 * E2E-verifiable offline. Live vision is UNPROVEN until a real image round-trip
 * succeeds against a running gateway.
 */

export interface VisionImage {
  bytes: Buffer;
  mime: string; // 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
}

export interface VisionCall {
  /** OmniRoute combo (default `auto/vision`). */
  model: string;
  system?: string;
  /** Text question the model must answer about the images. */
  prompt: string;
  images: VisionImage[];
  maxTokens?: number;
  temperature?: number;
}

export interface VisionResult {
  text: string;
  usage: { tokensIn: number; tokensOut: number; requests: number; costEur: number };
  model: string;
  provider: string;
}

/** Default vision combo (router's `quality.review` -> `quality` already points here). */
export const VISION_MODEL = 'auto/vision';
/** Hard cap on images per vision call (keeps the request body + tokens sane). */
export const VISION_MAX_IMAGES = 6;
/** Hard cap on total image bytes per call (base64 inflation ~1.37x). */
export const VISION_MAX_TOTAL_BYTES = 8 * 1024 * 1024;

/**
 * QA stub mode: when `OMNIROUTE_QA_STUB=1` (default) the QA agent runs its
 * deterministic technical checks only and the model passes (plan review +
 * vision) are skipped. Set `=0` to enable the live model review. This is a
 * dev-honesty default — live vision is UNPROVEN until the gateway round-trip
 * is verified.
 */
export function qaStubEnabled(): boolean {
  return process.env.OMNIROUTE_QA_STUB !== '0';
}

function sniffVisionMime(bytes: Buffer): string {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes.length > 11 && bytes.slice(0, 4).toString('ascii') === 'RIFF' && bytes.slice(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return 'image/png';
}

/** Deterministic local fallback when the live vision round-trip is disabled. */
export function stubVisionReview(call: VisionCall): VisionResult {
  // Deterministic per-prompt content so the verdict output is stable, exactly
  // like buildStubClip(gif) / buildStubWav(text). It reports no visible issues;
  // the QA matrix still runs full technical checks underneath.
  const h = hashText(`${call.model}|${call.prompt}|${call.images.length}`);
  const blurb = `[stub] inspected ${call.images.length} image(s). No visual defects detected (deterministic stub, provider=stub). seed=${h}`;
  return {
    text: blurb,
    usage: { tokensIn: 0, tokensOut: blurb.length / 4, requests: 1, costEur: 0 },
    model: 'stub-vision',
    provider: 'stub',
  };
}

export async function callOmniRouteVision(call: VisionCall): Promise<VisionResult> {
  if (qaStubEnabled()) return stubVisionReview(call);

  const images = call.images.slice(0, VISION_MAX_IMAGES);
  let totalBytes = 0;
  for (const img of images) totalBytes += img.bytes.length;
  while (images.length > 1 && totalBytes > VISION_MAX_TOTAL_BYTES) {
    const dropped = images.pop()!;
    totalBytes -= dropped.bytes.length;
  }

  const content: unknown[] = [];
  for (const img of images) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: sniffVisionMime(img.bytes),
        data: img.bytes.toString('base64'),
      },
    });
  }
  content.push({ type: 'text', text: call.prompt });

  const url = `${config.omniRoute.url.replace(/\/+$/, '')}/v1/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.omniRoute.apiKey,
      authorization: `Bearer ${config.omniRoute.apiKey}`,
    },
    body: JSON.stringify({
      model: call.model,
      system: call.system,
      messages: [{ role: 'user', content }],
      max_tokens: call.maxTokens ?? 2048,
      temperature: call.temperature ?? 0.2,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    try {
      const j = JSON.parse(text);
      throw new OmniRouteError(`OmniRoute vision error: ${j?.error?.message ?? res.statusText}`, res.status, text);
    } catch (e) {
      if (e instanceof OmniRouteError) throw e;
      throw new OmniRouteError(`OmniRoute vision HTTP ${res.status}: ${text}`, res.status, text);
    }
  }

  let body: { content?: { type?: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  try {
    body = JSON.parse(text);
  } catch {
    throw new OmniRouteError('OmniRoute vision returned non-JSON response', res.status, text);
  }

  const raw = (body.content ?? [])
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text as string)
    .join('\n')
    .trim();

  const tokensIn = body.usage?.input_tokens ?? Math.ceil(totalBytes / 4);
  const tokensOut = body.usage?.output_tokens ?? Math.ceil(raw.length / 4);

  return {
    text: raw,
    usage: {
      tokensIn,
      tokensOut,
      requests: 1,
      costEur: estimateCostEur(call.model, tokensIn, tokensOut),
    },
    model: call.model,
    provider: 'omniroute',
  };
}

function hashText(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h % 1000;
}