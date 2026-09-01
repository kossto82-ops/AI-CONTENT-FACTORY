import type { GatewayTask, Tier } from './types.js';

/**
 * Task routing — DATA, not code. An agent never names a model; it names a
 * conceptual task + (optional) tier, and this table decides the OmniRoute
 * combo to use. Change routing (or which provider) here without touching
 * agent code.
 *
 * Combo ids verified against the running gateway:
 *   auto/cheap, auto/best-fast, auto/free, auto/best-coding
 *   auto/vision, auto/reasoning, auto/best-chat
 */

export interface RouteRule {
  task: GatewayTask;
  tier: Tier;
  model: string; // OmniRoute combo
}

export const ROUTES: Record<GatewayTask, Record<Tier, string>> = {
  'idea.generation': {
    cheap: 'auto/cheap',
    standard: 'auto/best-chat',
    quality: 'auto/best-coding',
  },
  'trend.analysis': {
    cheap: 'auto/cheap',
    standard: 'auto/best-fast',
    quality: 'auto/best-chat',
  },
  'script.writing': {
    cheap: 'auto/best-fast',
    standard: 'auto/best-chat',
    quality: 'auto/best-coding',
  },
  'direction.planning': {
    cheap: 'auto/best-fast',
    standard: 'auto/best-chat',
    quality: 'auto/best-coding',
  },
  'quality.review': {
    cheap: 'auto/best-fast',
    standard: 'auto/best-coding',
    quality: 'auto/vision',
  },
  classification: {
    cheap: 'auto/cheap',
    standard: 'auto/best-fast',
    quality: 'auto/best-fast',
  },
  code: {
    cheap: 'auto/best-fast',
    standard: 'auto/best-coding',
    quality: 'auto/best-coding',
  },
  reasoning: {
    cheap: 'auto/best-fast',
    standard: 'auto/best-reasoning',
    quality: 'auto/best-reasoning',
  },
};

const DEFAULT_TIER: Tier = 'cheap';
// Record every tier key is handled (compile-time guard).
export const TIERS: Tier[] = ['cheap', 'standard', 'quality'];

export function resolveModel(task: GatewayTask, tier?: Tier): string {
  const t = tier ?? DEFAULT_TIER;
  return ROUTES[task]?.[t] ?? ROUTES[task]?.cheap ?? 'auto/cheap';
}

/** Estimated blended EUR rate per 1M tokens per combo (approximate, configurable). */
const EST_RATE_EUR_PER_1M: Record<string, number> = {
  'auto/cheap': 0.1,
  'auto/best-fast': 0.25,
  'auto/best-chat': 0.5,
  'auto/best-coding': 0.6,
  'auto/best-reasoning': 1.2,
  'auto/vision': 0.8,
  'auto/free': 0,
};

export function estimateCostEur(model: string, tokensIn: number, tokensOut: number): number {
  const rate = EST_RATE_EUR_PER_1M[model] ?? 0.5;
  return ((tokensIn + tokensOut) / 1_000_000) * rate;
}
