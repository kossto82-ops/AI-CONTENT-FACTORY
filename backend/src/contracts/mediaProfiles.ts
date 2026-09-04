/**
 * Media profiles — centralized, reusable canvas/render profiles.
 *
 * Adopted from OpenMontage's concept of centralizing profile knowledge in one
 * place instead of scattering constants across composition/render code. The
 * first-class profile here is YOUTUBE_SHORTS; more can be added (e.g. a
 * landscape 16:9 educational profile) without touching callers.
 */

export interface MediaProfile {
  /** Stable id, e.g. 'youtube-shorts'. */
  id: string;
  /** Human name / label. */
  name: string;
  /** Aspect label used across docs/UI. */
  aspect: string;
  /** Vertical/Horizontal frames for render. */
  width: number;
  height: number;
  /** Frames per second (mobile short-form target). */
  fps: number;
  /** Target max duration in seconds. */
  maxDurationSec: number;
  /** Recommended codec / container for the final render. */
  container: string;
  /** Video codec. */
  videoCodec: string;
  /** Audio codec. */
  audioCodec: string;
  /** Optional caption subtitle format supported (e.g. 'srt/vtt'). */
  subtitles?: string;
}

/** YouTube Shorts: the primary vertical profile for short-form. */
export const YOUTUBE_SHORTS: MediaProfile = {
  id: 'youtube-shorts',
  name: 'YouTube Shorts',
  aspect: '9:16',
  width: 1080,
  height: 1920,
  fps: 30,
  maxDurationSec: 60,
  container: 'mp4',
  videoCodec: 'h264',
  audioCodec: 'aac',
  subtitles: 'vtt',
};

/** Landscape educational profile (illustrative; not yet wired). */
export const YOUTUBE_16_9: MediaProfile = {
  id: 'youtube-16-9',
  name: 'YouTube (16:9)',
  aspect: '16:9',
  width: 1920,
  height: 1080,
  fps: 30,
  maxDurationSec: 3600,
  container: 'mp4',
  videoCodec: 'h264',
  audioCodec: 'aac',
};

/** All registered profiles, indexed by id. */
export const MEDIA_PROFILES: Record<string, MediaProfile> = {
  [YOUTUBE_SHORTS.id]: YOUTUBE_SHORTS,
  [YOUTUBE_16_9.id]: YOUTUBE_16_9,
};

/** Look up a profile by id (throws on unknown id). */
export function getMediaProfile(id: string): MediaProfile {
  const p = MEDIA_PROFILES[id];
  if (!p) throw new Error(`Unknown media profile: ${id}`);
  return p;
}

/** Reverse helper: pick the profile matching a dimension/fps (first match). */
export function findProfileForSize(
  width: number,
  height: number,
  fps?: number,
): MediaProfile | undefined {
  return Object.values(MEDIA_PROFILES).find(
    (p) => p.width === width && p.height === height && (fps == null || p.fps === fps),
  );
}
