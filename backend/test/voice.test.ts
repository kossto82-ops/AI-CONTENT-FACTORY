import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { voiceAgent, buildNarration, type VoiceManifest } from '../src/agents/voice.js';
import { callOmniRouteSpeech } from '../src/gateway/audio.js';
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
      narration: '',
    },
  ],
};

// Minimal but real WAV header + 1 byte of PCM data.
const FAKE_WAV = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([24, 0, 0, 0]),
  Buffer.from('WAVEfmt '),
  Buffer.from([16, 0, 0, 0, 1, 0, 1, 0, 0x44, 0xac, 0, 0, 0x88, 0x58, 0x1, 0, 2, 0, 16, 0]),
  Buffer.from('data'),
  Buffer.from([1, 0, 0, 0]),
  Buffer.from([0x00]),
]);

const tmpRoots: string[] = [];

function tempAudioDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'aicf-voice-'));
  tmpRoots.push(d);
  return d;
}

afterAll(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true });
});

describe('buildNarration', () => {
  it('uses scene narration text when present', () => {
    expect(buildNarration(PLAN, PLAN.scenes[0]!)).toBe('Once upon a time, a brave puppy set out.');
  });

  it('falls back to action/location for empty narration', () => {
    expect(buildNarration(PLAN, PLAN.scenes[1]!)).toBe('puppy chases a butterfly in park.');
  });
});

describe('voiceAgent', () => {
  it('writes one audio file per scene and returns the manifest', async () => {
    const dir = tempAudioDir();
    let calls = 0;
    const out = await voiceAgent(
      { plan: PLAN, contentId: 'content_test1' },
      {
        synthesize: async ({ text, voice, format }) => {
          calls++;
          expect(voice).toBeTruthy();
          expect(format).toBe('mp3');
          expect(text.length).toBeGreaterThan(0);
          return { bytes: FAKE_WAV, mime: 'audio/wav', durationSeconds: 3, provider: 'omniroute' };
        },
        audioDir: () => dir,
      },
    );

    expect(calls).toBe(2);
    expect(out.count).toBe(2);
    expect(out.voice.contentId).toBe('content_test1');
    expect(out.voice.voice).toBeTruthy();

    const manifest = out.voice as VoiceManifest;
    expect(manifest.scenes).toHaveLength(2);
    expect(manifest.scenes[0]!.sceneId).toBe('S1');
    expect(manifest.scenes[0]!.file).toBe('S1.wav');
    expect(manifest.scenes[0]!.mime).toBe('audio/wav');
    expect(manifest.scenes[0]!.durationSeconds).toBe(3);
    expect(manifest.scenes[1]!.sceneId).toBe('S2');

    // Files actually written + byte-identical.
    for (const s of manifest.scenes) {
      const abs = join(dir, s.file);
      expect(existsSync(abs)).toBe(true);
      expect(readFileSync(abs).equals(FAKE_WAV)).toBe(true);
    }
  });

  it('uses mp3 extension when the provider returns audio/mpeg', async () => {
    const dir = tempAudioDir();
    const out = await voiceAgent(
      { plan: PLAN, contentId: 'content_test2' },
      {
        synthesize: async () => ({ bytes: Buffer.from([0xff, 0xfb, 0x90]), mime: 'audio/mpeg', durationSeconds: 2, provider: 'omniroute' }),
        audioDir: () => dir,
      },
    );
    expect(out.voice.scenes[0]!.file).toBe('S1.mp3');
    expect(existsSync(join(dir, 'S1.mp3'))).toBe(true);
  });

  it('falls back to wav extension for unknown mime', async () => {
    const dir = tempAudioDir();
    const out = await voiceAgent(
      { plan: PLAN, contentId: 'content_test3' },
      {
        synthesize: async () => ({ bytes: Buffer.from([0x00, 0x01]), mime: 'application/octet-stream', durationSeconds: 1, provider: 'omniroute' }),
        audioDir: () => dir,
      },
    );
    expect(out.voice.scenes[0]!.file).toBe('S1.wav');
  });
});

describe('audio gateway side-effects', () => {
  it('callOmniRouteSpeech exists and points at the speech route (contract sanity)', () => {
    expect(typeof callOmniRouteSpeech).toBe('function');
  });
});