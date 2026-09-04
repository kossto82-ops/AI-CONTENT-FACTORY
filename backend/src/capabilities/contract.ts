/**
 * Capability contracts — the keystone of the capability-first architecture.
 *
 * A creative/production agent NEVER names a concrete model/vendor. It asks for
 * a CAPABILITY (IMAGE_GENERATION, TTS, ...) and the registry resolves which
 * concrete tool/provider satisfies it. This keeps the pipeline
 * provider-independent and local-first while OpenMontage-style selectors do the
 * routing at runtime.
 *
 * This file defines the types only — the registry (registry.ts) and selectors
 * (scoring.ts) live beside it.
 */

/** A decoupled capability the pipeline can ask for. */
export type Capability =
  | 'LLM' // research / script / director / QA reasoning
  | 'IMAGE_GENERATION'
  | 'VIDEO_GENERATION'
  | 'TTS' // text-to-speech narration
  | 'MUSIC_GENERATION'
  | 'SFX_GENERATION'
  | 'COMPOSITION'
  | 'ANALYSIS' // ffprobe-style output probing
  | 'MODERATION' // child-safety screening
  | 'PUBLISH';

/** Where a tool actually runs — the local-first primitive. */
export type ToolRuntime = 'local' | 'local_gpu' | 'api' | 'hybrid';

/** Rough tier used to group tools + rank defaults (adopted from OpenMontage). */
export type ToolTier =
  | 'core' // project-level orchestrating tools
  | 'voice' // narration
  | 'enhance' // optional repertoire enhancements
  | 'generate' // image / video
  | 'source' // research
  | 'analyze' // QA / probing
  | 'publish';

/** Determinism class — drives resumability + whether outputs are reproducible. */
export type ToolDeterminism = 'deterministic' | 'seeded' | 'stochastic';

/** Honest availability — never fake a capability as available. */
export type ToolAvailability = 'available' | 'unavailable' | 'degraded';

/**
 * Runtime inputs to a tool call. Agents resolve a ToolContract for a
 * capability, then call the tool with these inputs.
 */
export type ToolInput = Record<string, unknown>;

/** Normalized result every capability tool returns. */
export interface ToolResult {
  ok: boolean;
  capability: Capability;
  toolId: string;
  /** Artifact (or schema-shaped payload) the tool produced. */
  data?: unknown;
  /** Artifact kind to persist (e.g. 'assets', 'voice', 'final_video'). */
  artifactKind?: string;
  error?: string;
  usage: {
    requests: number;
    costEur: number;
  };
}

/**
 * Self-describing capability tool that any agent can resolve + call.
 * Adopted from OpenMontage's BaseTool contract, adapted to TypeScript and to
 * our children's-short-form production needs.
 */
export interface ToolContract {
  /** Unique id, e.g. 'omniroute-flux'. */
  id: string;
  /** Optional human name (falls back to id). */
  name: string;
  version: string;
  /** The capability this tool satisfies. */
  capability: Capability;
  /** Concrete provider, e.g. 'omniroute', 'wan21', 'piper'. */
  provider: string;
  tier: ToolTier;
  /** Where it runs — local-first primitive. */
  runtime: ToolRuntime;
  determinism: ToolDeterminism;
  /** Honest availability. */
  availability: ToolAvailability;
  /** Free-form structured capability support (resolutions, framerates, ...). */
  supports?: Record<string, unknown>;
  /** Inputs this tool consumes (documentation only by default). */
  describe(): string;
  /** Run the tool with normalized inputs. */
  run(input: ToolInput): Promise<ToolResult>;
  /** Optional fallback tool ids (first available used on failure). */
  fallbackTools?: string[];
  /**
   * Optional dependency keys (e.g. 'env:OMNIROUTE_API_KEY', 'binary:ffmpeg')
   * a control panel can surface to explain availability.
   */
  dependencyKeys?: string[];
  /** Optional cost estimate in EUR for given inputs (used by cost governance). */
  estimateCostEur?(input: ToolInput): number;
}

/** Where a resolved capability points after routing. */
export interface SelectorRoute {
  capability: Capability;
  chosen: ToolContract;
  /** Alternative tools that also satisfy the capability, ranked. */
  alternatives: ToolContract[];
  /** Why the chosen tool won (from the score breakdown). */
  rationale: string;
}
