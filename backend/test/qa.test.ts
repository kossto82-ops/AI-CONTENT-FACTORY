import { describe, expect, it } from 'vitest';
import { qaAgent, runMediaQa, runPlanQa, type QaFileSystem } from '../src/agents/qa.js';
import type { ProductionPlan } from '../src/agents/contracts.js';
import type { FinalVideoManifest } from '../src/agents/assembly.js';

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
      narration: 'And then it was off!',
    },
  ],
};

const VIDEO: FinalVideoManifest = {
  videoId: 'video_x_2sc',
  planId: 'The Brave Puppy',
  contentId: 'content_x',
  version: 1,
  durationSec: 60,
  resolution: '768x1344',
  fps: 4,
  aspectRatio: '9:16',
  subtitleFile: 'subtitles.vtt',
  scenes: [
    {
      sceneId: 'S1',
      startSec: 0,
      endSec: 30,
      visualFile: 'S1.png',
      voiceFile: 'S1.wav',
      clipFile: 'S1.gif',
      clipMime: 'image/gif',
      clipBytes: 1500,
      narration: 'Once upon a time, a brave puppy set out.',
    },
    {
      sceneId: 'S2',
      startSec: 30,
      endSec: 60,
      visualFile: 'S2.png',
      voiceFile: 'S2.wav',
      clipFile: 'S2.gif',
      clipMime: 'image/gif',
      clipBytes: 1600,
      narration: 'And then it was off!',
    },
  ],
  layers: { visual: [], voice: [], clips: [], subtitles: '', music: '', sfx: '' },
  exportSettings: { codec: '', bitrate: '', audio: '', notes: '' },
  reproducibilityNotes: '',
  poster: 'S1.png',
  model: 'stub-animated-gif',
  provider: 'stub',
  costEur: 0.02,
};

const MANIFESTS = {
  assets: {
    contentId: 'content_x',
    visualStyle: 'pastel cartoon',
    totalDurationSeconds: 60,
    scenes: [
      { sceneId: 'S1', file: 'S1.png', mime: 'image/png', bytes: 900 },
      { sceneId: 'S2', file: 'S2.png', mime: 'image/png', bytes: 910 },
    ],
  },
  voice: {
    contentId: 'content_x',
    voice: 'Magpie',
    scenes: [
      { sceneId: 'S1', file: 'S1.wav', mime: 'audio/wav', bytes: 4000, durationSeconds: 3, text: 'Once upon a time' },
      { sceneId: 'S2', file: 'S2.wav', mime: 'audio/wav', bytes: 3500, durationSeconds: 2.5, text: 'And then' },
    ],
  },
};

const CONTENT_DIR = '/assets/content_x';

/** Hermetic file system: a content asset dir backed by a fixed file list. */
function fsWith(files: string[]): QaFileSystem {
  return {
    contentDir: () => CONTENT_DIR,
    exists: (abs: string) => {
      const norm = abs.replace(/\\/g, '/').replace(`${CONTENT_DIR}/`, '');
      return files.includes(norm) || files.includes(abs);
    },
    readBytes: () => Buffer.from('stub'),
  };
}

function allPresent(): QaFileSystem {
  return fsWith([
    'S1.png',
    'S2.png',
    'audio/S1.wav',
    'audio/S2.wav',
    'assembly/S1.gif',
    'assembly/S2.gif',
    'assembly/subtitles.vtt',
  ]);
}

function input(video?: FinalVideoManifest | null, overrides: Partial<{ plan: ProductionPlan; assets: unknown; voice: unknown }> = {}) {
  return {
    plan: overrides.plan ?? PLAN,
    scriptTitle: PLAN.title,
    contentId: 'content_x',
    video: video === undefined ? VIDEO : video,
    assets: (overrides.assets ?? MANIFESTS.assets) as never,
    voice: (overrides.voice ?? MANIFESTS.voice) as never,
  };
}

describe('runPlanQa — plan-internal consistency', () => {
  it('passes a consistent plan', () => {
    const { issues, checklist } = runPlanQa(PLAN);
    expect(issues).toHaveLength(0);
    expect(checklist.metadata_complete).toBe(true);
    expect(checklist.duration_ok).toBe(true);
    expect(checklist.subtitles_present).toBe(true);
  });

  it('flags scene-duration sum mismatch vs the plan total', () => {
    const bad: ProductionPlan = { ...PLAN, totalDurationSeconds: 120 };
    const { issues } = runPlanQa(bad);
    expect(issues.some((i) => i.category === 'duration' && i.severity === 'medium')).toBe(true);
  });

  it('flags duplicate scene ids as blocking', () => {
    const dup: ProductionPlan = { ...PLAN, scenes: [PLAN.scenes[0]!, { ...PLAN.scenes[1]!, id: 'S1' }] };
    const { issues } = runPlanQa(dup);
    const high = issues.find((i) => i.category === 'structure' && i.severity === 'high');
    expect(high).toBeTruthy();
    expect(high?.message).toContain('S1');
  });

  it('flags scenes without narration', () => {
    const noNarr: ProductionPlan = { ...PLAN, scenes: [PLAN.scenes[0]!, { ...PLAN.scenes[1]!, narration: '  ' }] };
    const { issues, checklist } = runPlanQa(noNarr);
    expect(issues.some((i) => i.category === 'subtitles')).toBe(true);
    expect(checklist.subtitles_present).toBe(false);
  });

  it('flags missing metadata', () => {
    const noMeta: ProductionPlan = { ...PLAN, targetAge: '' };
    const { issues, checklist } = runPlanQa(noMeta);
    expect(issues.some((i) => i.category === 'metadata')).toBe(true);
    expect(checklist.metadata_complete).toBe(false);
  });
});

describe('runMediaQa — deterministic file/timeline checks', () => {
  it('passes a healthy assembled video', () => {
    const { issues, checklist } = runMediaQa(input(VIDEO), allPresent());
    expect(issues).toHaveLength(0);
    for (const k of [
      'duration_ok',
      'resolution_ok',
      'vertical_9_16',
      'audio_clean',
      'subtitles_present',
      'clips_ok',
      'continuity_ok',
    ] as (keyof QaChecklist)[]) {
      expect(checklist[k]).toBe(true);
    }
  });

  it('flags a duration drift >10% vs the plan', () => {
    const { issues, checklist } = runMediaQa(input({ ...VIDEO, durationSec: 45 }), allPresent());
    expect(issues.some((i) => i.category === 'duration')).toBe(true);
    expect(checklist.duration_ok).toBe(false);
  });

  it('flags non-vertical output', () => {
    const { issues, checklist } = runMediaQa(input({ ...VIDEO, resolution: '1920x1080', aspectRatio: '16:9' }), allPresent());
    expect(issues.some((i) => i.category === 'format')).toBe(true);
    expect(checklist.vertical_9_16).toBe(false);
    expect(checklist.resolution_ok).toBe(true); // resolution is fine, only the aspect is wrong
  });

  it('flags low resolution output', () => {
    const { issues, checklist } = runMediaQa(input({ ...VIDEO, resolution: '200x300', aspectRatio: '9:16' }), allPresent());
    expect(issues.some((i) => i.category === 'resolution')).toBe(true);
    expect(checklist.resolution_ok).toBe(false);
  });

  it('flags missing voice files on disk', () => {
    const noAudio: QaFileSystem = { ...allPresent(), exists: (abs) => !abs.replace(/\\/g, '/').includes('audio/') };
    const { issues, checklist } = runMediaQa(input(VIDEO), noAudio);
    expect(issues.some((i) => i.category === 'audio')).toBe(true);
    expect(checklist.audio_clean).toBe(false);
  });

  it('flags missing subtitle file', () => {
    const noSubs: QaFileSystem = { ...allPresent(), exists: (abs) => !abs.includes('subtitles.vtt') };
    const { issues, checklist } = runMediaQa(input(VIDEO), noSubs);
    expect(issues.some((i) => i.category === 'subtitles')).toBe(true);
    expect(checklist.subtitles_present).toBe(false);
  });

  it('flags missing clip file', () => {
    const noClip: QaFileSystem = { ...allPresent(), exists: (abs) => !abs.includes('S2.gif') };
    const { issues, checklist } = runMediaQa(input(VIDEO), noClip);
    expect(issues.some((i) => i.category === 'visual' && i.message.includes('S2'))).toBe(true);
    expect(checklist.clips_ok).toBe(false);
  });

  it('flags a timeline gap between scenes', () => {
    const gap: FinalVideoManifest = {
      ...VIDEO,
      scenes: [VIDEO.scenes[0]!, { ...VIDEO.scenes[1]!, startSec: 31, endSec: 61 }],
    };
    const { issues, checklist } = runMediaQa(input(gap), allPresent());
    expect(issues.some((i) => i.category === 'continuity')).toBe(true);
    expect(checklist.continuity_ok).toBe(false);
  });

  it('treats a missing video artifact as blocking', () => {
    const { issues, checklist } = runMediaQa(input(null), allPresent());
    expect(issues.some((i) => i.severity === 'high' && i.category === 'visual')).toBe(true);
    expect(checklist.clips_ok).toBe(false);
  });
});

describe('qaAgent — verdict composition (default stub mode, no gateway)', () => {
  it('approves a healthy assembled video deterministically', async () => {
    const out = await qaAgent(input(VIDEO), allPresent());
    expect(out.verdict.status).toBe('approved');
    expect(out.verdict.score).toBe(1);
    expect(out.model).toBe('stub');
    expect(out.provider).toBe('stub');
    expect(out.verdict.reviewScope?.technical).toBe(true);
    expect(out.verdict.reviewScope?.plan).toBe(false);
    expect(out.verdict.checklist?.coherence_ok).toBe(null); // model pass skipped
    expect(out.verdict.summary).toContain('OMNIROUTE_QA_STUB');
  });

  it('a missing video forces a rejection regardless of score', async () => {
    const out = await qaAgent(input(null), allPresent());
    expect(out.verdict.status).toBe('rejected');
    expect(out.verdict.score).toBeLessThanOrEqual(0.7);
    expect(out.verdict.issues.some((i) => i.severity === 'high')).toBe(true);
  });

  it('persists the full checklist with null marks for unchecked model dimensions', async () => {
    const out = await qaAgent(input(VIDEO), allPresent());
    const c = out.verdict.checklist!;
    expect(c.duration_ok).toBe(true);
    expect(c.resolution_ok).toBe(true);
    expect(c.vertical_9_16).toBe(true);
    expect(c.audio_clean).toBe(true);
    expect(c.subtitles_present).toBe(true);
    expect(c.clips_ok).toBe(true);
    expect(c.continuity_ok).toBe(true);
    expect(c.visuals_clean).toBeNull();
    expect(c.coherence_ok).toBeNull();
    expect(c.appropriateness_ok).toBeNull();
  });
});