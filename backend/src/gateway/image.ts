import { config } from '../config.js';
import { OmniRouteError } from './omniroute.js';

/**
 * Image generation channel — OmniRoute exposes an OpenAI-compatible Images API
 * (POST /v1/images/generations) that returns inline base64 (`data[0].b64_json`).
 *
 * This is intentionally a SEPARATE channel from the text `callOmniRoute`:
 * the response is binary (base64) with no `content[].text`, so it needs its
 * own request shape, decode path, and error handling.
 */

export interface ImageGenerationCall {
  model: string;
  prompt: string;
  size: string;
}

export interface ImageGenerationResult {
  bytes: Buffer;
  mime: string;
  finishReason: string;
  model: string;
  provider: string;
}

const MIME_BY_HEAD: Array<[number[], string]> = [
  [[0xff, 0xd8, 0xff], 'image/jpeg'],
  [[0x89, 0x50, 0x4e, 0x47], 'image/png'],
  [[0x47, 0x49, 0x46], 'image/gif'],
  [[0x52, 0x49, 0x46, 0x46], 'image/webp'],
];

function sniffMime(bytes: Buffer): string {
  for (const [sig, mime] of MIME_BY_HEAD) {
    if (sig.every((b, i) => bytes[i] === b)) return mime;
  }
  return 'image/jpeg';
}

/** Default image model: FLUX.2 klein — fast (~2s) and reliable on the test rig. */
export const IMAGE_MODEL = 'nvidia/black-forest-labs/flux.2-klein-4b';
/** Default vertical output for Shorts/Reels (9:16-ish). */
export const IMAGE_SIZE = '768x1344';
/** Fallback square size (narrower provider support). */
export const IMAGE_SIZE_SQUARE = '1024x1024';

export async function callOmniRouteImage(call: ImageGenerationCall): Promise<ImageGenerationResult> {
  const url = `${config.omniRoute.url.replace(/\/+$/, '')}/v1/images/generations`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.omniRoute.apiKey,
      authorization: `Bearer ${config.omniRoute.apiKey}`,
    },
    body: JSON.stringify({
      model: call.model,
      prompt: call.prompt,
      n: 1,
      size: call.size,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    try {
      const j = JSON.parse(text);
      throw new OmniRouteError(`OmniRoute image error: ${j?.error?.message ?? res.statusText}`, res.status, text);
    } catch (e) {
      if (e instanceof OmniRouteError) throw e;
      throw new OmniRouteError(`OmniRoute image HTTP ${res.status}: ${text}`, res.status, text);
    }
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new OmniRouteError('OmniRoute image returned non-JSON response', res.status, text);
  }

  const b64 = body?.data?.[0]?.b64_json as string | undefined;
  if (!b64) {
    // Some providers return `url` instead; we request base64 and require it.
    throw new OmniRouteError(
      'OmniRoute image response had no b64_json (provider returned url only)',
      res.status,
      text,
    );
  }

  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length === 0) {
    throw new OmniRouteError('OmniRoute image response was empty (0 bytes decoded)', res.status, text);
  }

  return {
    bytes,
    mime: sniffMime(bytes),
    finishReason: String(body?.data?.[0]?.finish_reason ?? 'SUCCESS'),
    model: call.model,
    provider: 'omniroute',
  };
}

/** Rough cost estimate for an image generation (flat per-image rate). */
export function estimateImageCostEur(): number {
  return 0.002; // ~<1c flat, approximates FLUX.2 klein per-image
}
