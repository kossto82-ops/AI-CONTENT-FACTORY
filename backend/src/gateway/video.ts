import { config } from '../config.js';
import { OmniRouteError } from './omniroute.js';

/**
 * Video generation channel — OmniRoute exposes video models (veo, seedance)
 * over an OpenAI-compatible surface at POST /v1/videos/generations. Model
 * list verified LIVE against the gateway (GET /v1/videos/generations returns
 * the video-model catalog). Like image.ts / audio.ts this is a SEPARATE
 * channel: the response is media, not the text `callOmniRoute` shape.
 *
 * Live vs stub (honesty about the upstream, exactly like D-13 / audio.ts):
 * a real veo/seedance generation is QUEUED and slow — a probe POST against
 * veo-free/veo did not return within 20s, and free video NIMs are flaky. So
 * the channel DEFAULTS to a deterministic, browser-playable animated GIF
 * ("clip") synthesized locally, and calls the real gateway ONLY when the
 * operator opts in with `OMNIROUTE_VIDEO_STUB=0`. This keeps the whole
 * pipeline / file-write / serve / UI path E2E-verifiable in dev without
 * burning minutes per clip on a flaky upstream. Live MP4/WebM output is
 * UNPROVEN until the upstream proves stable.
 */

export interface VideoGenerationCall {
  model: string;
  prompt: string;
  size: string;
}

export interface VideoGenerationResult {
  bytes: Buffer;
  mime: string;
  model: string;
  provider: string;
}

/** Default video model: Veo 3.1 (free tier), verified present on the gateway. */
export const VIDEO_MODEL = 'veo-free/veo';
/** Default vertical output for Shorts/Reels (same 9:16 as the Visual Agent). */
export const VIDEO_SIZE = '768x1344';
/** Stub clip length (seconds) when using the local deterministic generator. */
export const VIDEO_STUB_FPS = 4;
export const VIDEO_STUB_SECONDS = 5;

const EXT_BY_MIME: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'image/gif': 'gif',
};

function sniffVideoMime(bytes: Buffer): string {
  if (bytes.length > 11 && bytes.slice(4, 8).toString('ascii') === 'ftyp') return 'video/mp4';
  if (bytes.length > 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return 'video/webm'; // EBML (WebM/MKV)
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'; // "GIF"
  return 'video/mp4';
}

/** Deterministic HSL -> RGB (used for the stub clip palette). */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/**
 * Minimal GIF89a LZW encoder ("no compression", only literal codes). Generates
 * a fully valid animated GIF: a vertical highlight band sweeps top-to-bottom
 * over a scene-derived background — deterministic, browser-playable "motion".
 * min code size 8, literals 0..palette-1, clear/eoi mirror the decoder's code
 * width growth so players parse it correctly.
 */
export function gifLzwEncode(indices: Uint8Array, palette: number): Buffer {
  const minCode = 8;
  const clear = 1 << minCode; // 256
  const eoi = clear + 1; // 257
  let codeSize = minCode + 1;
  let next = eoi + 1; // next dictionary slot (mirrors the decoder's growth)
  const codes = [clear];
  for (const idx of indices) {
    codes.push(idx & 0xff);
    next++;
    if (next === 1 << codeSize && codeSize < 12) codeSize++;
  }
  codes.push(eoi);

  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const code of codes) {
    acc |= (code & ((1 << 24) - 1)) << bits; // safe width (≤12 bits stored)
    bits += codeSize;
    while (bits >= 8) {
      out.push(acc & 0xff);
      acc >>>= 8;
      bits -= 8;
    }
  }
  if (bits > 0) out.push(acc & 0xff);

  const blocks: number[] = [];
  for (let i = 0; i < out.length; i += 255) {
    const n = Math.min(255, out.length - i);
    blocks.push(n, ...out.slice(i, i + n));
  }
  blocks.push(0);
  return Buffer.from(blocks);
}

/** Build a deterministic animated-GIF "clip" for one scene (seed = scene idx). */
export function buildStubClip(
  seed: number,
  opts: { width?: number; height?: number; seconds?: number; fps?: number } = {},
): Buffer {
  const width = opts.width ?? 64;
  const height = opts.height ?? 112;
  const seconds = opts.seconds ?? VIDEO_STUB_SECONDS;
  const fps = opts.fps ?? VIDEO_STUB_FPS;
  const frames = Math.max(1, Math.round(seconds * fps));
  const delay = Math.max(1, Math.round(100 / fps)); // centiseconds

  const hue = (seed * 47) % 360;
  const palette = [
    hslToRgb(hue, 0.55, 0.4),
    hslToRgb(hue, 0.85, 0.68),
    hslToRgb(hue, 0.5, 0.22),
    [255, 255, 255] as [number, number, number],
  ];
  const bandH = Math.max(3, Math.round(height * 0.12));

  const outPieces: Buffer[] = [];
  outPieces.push(Buffer.from('GIF89a'));
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(width, 0);
  lsd.writeUInt16LE(height, 2);
  lsd[4] = 0; // no global color table
  lsd[5] = 0;
  lsd[6] = 0;
  outPieces.push(lsd);

  for (let f = 0; f < frames; f++) {
    const bandY = Math.max(0, Math.floor((f / frames) * (height + bandH)) - bandH);
    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const accent = y >= bandY && y < bandY + bandH;
      const value = accent ? 1 : y % 9 === 0 ? 2 : 0;
      pixels.fill(value, y * width, (y + 1) * width);
    }

    const img = Buffer.alloc(10);
    img[0] = 0x2c; // image descriptor
    img.writeUInt16LE(0, 1); // left
    img.writeUInt16LE(0, 3); // top
    img.writeUInt16LE(width, 5);
    img.writeUInt16LE(height, 7);
    img[9] = 0x80 | 2; // local color table, 4 entries (size bits 2)

    const palBuf = Buffer.alloc(12);
    palette.forEach((c, i) => {
      palBuf[i * 3] = c[0];
      palBuf[i * 3 + 1] = c[1];
      palBuf[i * 3 + 2] = c[2];
    });

    const gce = Buffer.from([0x21, 0xf9, 0x04, 0x00, delay & 0xff, (delay >> 8) & 0xff, 0x00, 0x00]);
    const data = gifLzwEncode(pixels, palette.length);
    const minCode = Buffer.from([8]);
    outPieces.push(gce, img, palBuf, minCode, data);
  }
  outPieces.push(Buffer.from([0x3b])); // trailer
  return Buffer.concat(outPieces);
}

/** Live generation is queued/slow upstream — never hang a job on it. */
const LIVE_TIMEOUT_MS = 120_000;

export async function callOmniRouteVideo(call: VideoGenerationCall): Promise<VideoGenerationResult> {
  const useLive = process.env.OMNIROUTE_VIDEO_STUB === '0';
  if (!useLive) {
    const seed = hashSeed(call.prompt);
    return {
      bytes: buildStubClip(seed),
      mime: 'image/gif',
      model: 'stub-animated-gif',
      provider: 'stub',
    };
  }

  const url = `${config.omniRoute.url.replace(/\/+$/, '')}/v1/videos/generations`;
  let res: Response;
  try {
    res = await fetch(url, {
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
      signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') {
      throw new OmniRouteError(
        `OmniRoute video generation timed out after ${LIVE_TIMEOUT_MS / 1000}s (upstream queued/slow). ` +
          'Live veo/seedance clips are UNPROVEN in this environment; keep OMNIROUTE_VIDEO_STUB=1 to use the deterministic animated-GIF stub.',
        0,
        '',
      );
    }
    throw new OmniRouteError(`OmniRoute video request failed: ${e instanceof Error ? e.message : String(e)}`, 0, '');
  }

  const text = await res.text();
  if (!res.ok) {
    try {
      const j = JSON.parse(text);
      throw new OmniRouteError(`OmniRoute video error: ${j?.error?.message ?? res.statusText}`, res.status, text);
    } catch (e) {
      if (e instanceof OmniRouteError) throw e;
      throw new OmniRouteError(`OmniRoute video HTTP ${res.status}: ${text}`, res.status, text);
    }
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new OmniRouteError('OmniRoute video returned non-JSON response', res.status, text);
  }

  const item = body?.data?.[0] as { b64_json?: string; url?: string } | undefined;
  if (!item) {
    throw new OmniRouteError('OmniRoute video response had no data[0] entry', res.status, text);
  }
  const b64 = item.b64_json;
  let bytes: Buffer | null = null;
  if (typeof b64 === 'string' && b64.length > 0) {
    bytes = Buffer.from(b64, 'base64');
  } else if (typeof item.url === 'string' && item.url.length > 0) {
    try {
      const dl = await fetch(item.url);
      bytes = Buffer.from(await dl.arrayBuffer());
    } catch (e) {
      throw new OmniRouteError(`OmniRoute video url fetch failed: ${e instanceof Error ? e.message : String(e)}`, 0, item.url);
    }
  }
  if (!bytes || bytes.length === 0) {
    throw new OmniRouteError('OmniRoute video response was empty (0 bytes decoded)', res.status, text);
  }

  return {
    bytes,
    mime: sniffVideoMime(bytes),
    model: call.model,
    provider: 'omniroute',
  };
}

/** Stable small hash for the stub's per-prompt deterministic seed. */
function hashSeed(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h % 1000;
}

/** Rough flat estimate per video clip generation. */
export function estimateVideoCostEur(): number {
  return 0.01; // ~€0.01 quick clip (veo-free tier is free; keep a placeholder)
}