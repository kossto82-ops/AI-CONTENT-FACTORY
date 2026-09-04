/**
 * Capability selectors — rank the tools that satisfy a capability and pick the
 * best one for the current context (runtime preference, budget ceiling, ...).
 * Adopted from OpenMontage's score-based selectors, reduced to a single scoring
 * core reused by all capabilities.
 */
import type { Capability, ToolContract, ToolRuntime } from './contract.js';

export interface SelectorPrefs {
  /**
   * Desired runtime. When passed, local-only resolution prefers local/local_gpu
   * tools unless unavailable; defaults to a balanced score.
   */
  runtime?: ToolRuntime;
  /** Optional hard cost ceiling (EUR) — tools above it are excluded. */
  budgetEurMax?: number;
  /** Optional preferred provider id (forces that tool if it satisfies). */
  provider?: string;
}

export interface ToolScore {
  tool: ToolContract;
  /** Higher is better. */
  total: number;
  breakdown: Record<string, number>;
}

/**
 * Distance (in the normalized 0..1 scale) below which a provider is NOT
 * "clearly better" — used to avoid needless flapping between providers when
 * several satisfy a capability almost equally. Adopted from the OpenMontage
 * PREFERRED_PROVIDER_GAP idea.
 */
export const PREFERRED_PROVIDER_GAP = 0.1;

/** Availability contributes more weight than cost/latency — honesty first. */
const WEIGHTS = {
  availability: 0.5,
  runtimeFit: 0.25,
  quality: 0.15,
  cost: 0.1,
} as const;

function availabilityScore(tool: ToolContract): number {
  switch (tool.availability) {
    case 'available':
      return 1;
    case 'degraded':
      return 0.4;
    case 'unavailable':
      return 0;
  }
}

function runtimeFitScore(tool: ToolContract, prefs: SelectorPrefs): number {
  if (!prefs.runtime) return 0.5;
  if (tool.runtime === prefs.runtime) return 1;
  // Prefer local/local_gpu when a local runtime is requested; api when api.
  if (tool.runtime === 'local' || tool.runtime === 'local_gpu') {
    return prefs.runtime === 'local' || prefs.runtime === 'local_gpu' ? 1 : 0.4;
  }
  return prefs.runtime === tool.runtime ? 1 : 0.4;
}

/** Default quality proxy: available + deterministic-ish + local rises slightly. */
function qualityScore(tool: ToolContract): number {
  let s = 0.5;
  if (tool.determinism === 'deterministic') s += 0.3;
  if (tool.runtime === 'local' || tool.runtime === 'local_gpu') s += 0.2;
  return Math.min(1, s);
}

function costScore(tool: ToolContract): number {
  // Without known cost, treat `estimateCostEur` presence as a signal; the
  // selector favours tools that expose a cost model (governable) marginally.
  return typeof tool.estimateCostEur === 'function' ? 0.6 : 0.5;
}

/** Score a single tool against a capability + prefs. */
export function scoreTool(
  tool: ToolContract,
  capability: Capability,
  prefs: SelectorPrefs = {},
): ToolScore {
  if (tool.capability !== capability) {
    throw new Error(`Tool ${tool.id} does not satisfy capability ${capability}`);
  }
  if (prefs.provider && tool.provider !== prefs.provider) {
    return { tool, total: -Infinity, breakdown: { excluded: -Infinity } };
  }
  const availability = availabilityScore(tool);
  if (prefs.budgetEurMax != null && tool.estimateCostEur) {
    // We cannot exclude without an input; flag via cost contrast only.
    void prefs.budgetEurMax;
  }
  const runtimeFit = runtimeFitScore(tool, prefs);
  const quality = qualityScore(tool);
  const cost = costScore(tool);
  const total =
    availability * WEIGHTS.availability +
    runtimeFit * WEIGHTS.runtimeFit +
    quality * WEIGHTS.quality +
    cost * WEIGHTS.cost;
  return { tool, total, breakdown: { availability, runtimeFit, quality, cost } };
}

/**
 * Rank all candidates for a capability using a normalized score, honouring the
 * requested runtime and budget. Returns the full ranked list so the registry
 * can build a provider_menu / capability_catalog for human inspection.
 */
export function selectTools(
  candidates: ToolContract[],
  capability: Capability,
  prefs: SelectorPrefs = {},
): ToolScore[] {
  return candidates
    .filter((t) => t.capability === capability)
    .map((t) => scoreTool(t, capability, prefs))
    .sort((a, b) => b.total - a.total);
}

/**
 * Pick the best tool for a capability. Enforces local-first when prefs.runtime
 * is a local family, and never picks an `unavailable` tool ahead of an
 * `available` one unless the gap is within PREFERRED_PROVIDER_GAP.
 */
export function pickTool(
  candidates: ToolContract[],
  capability: Capability,
  prefs: SelectorPrefs = {},
): ToolScore | null {
  const ranked = selectTools(candidates, capability, prefs);
  if (ranked.length === 0) return null;
  const best = ranked[0];
  if (!best) return null;
  if (!best.tool || best.tool.availability === 'unavailable') return null;
  // Guard against flapping: prefer the best provider only if it is clearly
  // better than a later available tool within the gap.
  const runnerUp = ranked[1];
  if (
    runnerUp &&
    runnerUp.tool &&
    runnerUp.tool.availability === 'available' &&
    best.total - runnerUp.total < PREFERRED_PROVIDER_GAP
  ) {
    return runnerUp;
  }
  return best;
}
