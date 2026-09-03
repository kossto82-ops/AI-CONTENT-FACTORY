import { config } from '../config.js';
import { OmniRouteError } from './omniroute.js';

/**
 * Text-to-Speech (audio) channel — OmniRoute exposes an OpenAI-compatible
 * Audio Speech API (POST /v1/audio/speech) that returns a raw audio body
 * (audio/wav | audio/mpeg | ...) rather than JSON.
 *
 * Like image.ts this is a SEPARATE channel from the text `callOmniRoute`:
 * the response is binary audio, so it needs its own request shape, decode
 * path, and error handling.
 *
 * Offline dev mode: when `OMNIROUTE_TTS_STUB=1` the channel returns a locally
 * synthesized, playable WAV (sine "voice") instead of calling the gateway.
 * This lets the pipeline/file-write/serving path be exercised when the NVIDIA
 * TTS NIM upstream is unavailable. It is NOT live TTS.
 */

export interface SpeechCall {
  model: string;
  input: string;
  voice: string;
  format?: string;
}

export interface SpeechResult {
  bytes: Buffer;
  mime: string;
  /** Approx. synthesized duration in seconds (estimated from size/rate). */
  durationSeconds: number;
  provider: string;
}

const MIME_BY_HEAD: Array<[number[], string]> = [
  [[0x52, 0x49, 0x46, 0x46], 'audio/wav'], // "RIFF" (WAV container)
  [[0x49, 0x44, 0x33], 'audio/mpeg'], // "ID3" (MP3 tag)
  [[0xff, 0xfb], 'audio/mpeg'], // MP3 frame sync
  [[0xff, 0xf3], 'audio/mpeg'], // MP3 frame sync (MPEG2)
  [[0x4f, 0x67, 0x67, 0x53], 'audio/ogg'], // "OggS"
  [[0x66, 0x4c, 0x61, 0x43], 'audio/flac'], // "fLaC"
];

function sniffAudioMime(bytes: Buffer): string {
  for (const [sig, mime] of MIME_BY_HEAD) {
    if (sig.every((b, i) => bytes[i] === b)) {
      // "RIFF" could be WAV or AVI; WAV carries a "WAVE" chunk at offset 8.
      if (mime === 'audio/wav') {
        return bytes.length > 8 && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45
          ? 'audio/wav'
          : 'audio/wav';
      }
      return mime;
    }
  }
  return 'audio/wav';
}

/**
 * Default TTS model: OpenAI gpt-4o-mini-tts via the OmniRoute `/v1/audio/speech`
 * channel. OmniRoute only recognizes a fixed set of speech providers
 * (openai | elevenlabs | cartesia) and requires the provider to have
 * credentials loaded — `nvidia/*` is NOT a supported speech provider.
 */
export const SPEECH_MODEL = 'openai/gpt-4o-mini-tts';
/** Default narrator voice available on that model. */
export const SPEECH_VOICE = 'alloy';
/** Default output format (MP3: the format OmniRoute/OpenAI actually return). */
export const SPEECH_FORMAT = 'mp3';

/** Approx. chars per second of natural speech (used for duration estimate). */
const CHARS_PER_SECOND = 15;

/** 16-bit mono PCM WAV for a sine "voice" — real, playable, deterministic. */
function buildStubWav(text: string): Buffer {
  const seconds = estimateSpeechDurationSeconds(text);
  const rate = 22050;
  const total = Math.floor(seconds * rate);
  const data = Buffer.alloc(total * 2);
  const baseFreq = 220; // "Ah" vowel-ish
  const wobble = 8;
  for (let i = 0; i < total; i++) {
    const t = i / rate;
    const env = 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / seconds); // amplitude envelope
    const freq = baseFreq + wobble * Math.sin(2 * Math.PI * 0.5 * t);
    const v = Math.round(env * 6000 * Math.sin(2 * Math.PI * freq * t));
    data.writeInt16LE(Math.max(-32768, Math.min(32767, v)), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export async function callOmniRouteSpeech(call: SpeechCall): Promise<SpeechResult> {
  const stubWav = process.env.OMNIROUTE_TTS_STUB === '1';
  if (stubWav) {
    return {
      bytes: buildStubWav(call.input),
      mime: 'audio/wav',
      durationSeconds: estimateSpeechDurationSeconds(call.input),
      provider: 'stub',
    };
  }

  const url = `${config.omniRoute.url.replace(/\/+$/, '')}/v1/audio/speech`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.omniRoute.apiKey,
      authorization: `Bearer ${config.omniRoute.apiKey}`,
    },
    body: JSON.stringify({
      model: call.model,
      input: call.input,
      voice: call.voice,
      ...(call.format ? { format: call.format } : {}),
    }),
  });

  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) {
    const text = buf.toString('utf8');
    try {
      const j = JSON.parse(text);
      throw new OmniRouteError(
        `OmniRoute audio error: ${j?.error?.message ?? res.statusText}`,
        res.status,
        text,
      );
    } catch (e) {
      if (e instanceof OmniRouteError) throw e;
      throw new OmniRouteError(`OmniRoute audio HTTP ${res.status}: ${text}`, res.status, text);
    }
  }

  if (buf.length === 0) {
    throw new OmniRouteError('OmniRoute audio response was empty (0 bytes)', res.status, '');
  }

  const mime = sniffAudioMime(buf);
  return {
    bytes: buf,
    mime,
    durationSeconds: estimateSpeechDurationSeconds(call.input),
    provider: 'omniroute',
  };
}

/** Cheap duration estimate from input length (no real TTS metadata available). */
export function estimateSpeechDurationSeconds(text: string): number {
  return Math.max(1, Math.round(text.trim().length / CHARS_PER_SECOND));
}

/** Rough cost estimate for TTS generation (~ per 1k characters). */
export function estimateSpeechCostEur(text: string): number {
  return (text.trim().length / 1000) * 0.06; // ~€0.06 / 1k chars metadata-rate
}
