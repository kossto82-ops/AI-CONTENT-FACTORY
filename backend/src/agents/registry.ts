import type { GatewayUsage } from '../gateway/types.js';
import { researchAgent } from './research.js';
import { scriptAgent } from './script.js';
import { directorAgent } from './director.js';
import { qaAgent } from './qa.js';
import { visualAgent } from './visual.js';
import { voiceAgent } from './voice.js';
import { assemblyAgent } from './assembly.js';
import { publisherAgent, type PublishInput } from './publisher.js';
import { computeAnalytics, type AnalyticsInput } from './analytics.js';
import { computeLearning, type LearningInput } from './learning.js';
import type { Idea, ProductionPlan, Script } from './contracts.js';
import type { AssetsManifest } from './visual.js';
import type { VoiceManifest } from './voice.js';
import type { FinalVideoManifest } from './assembly.js';

export type AgentType =
  | 'research'
  | 'script'
  | 'director'
  | 'visual'
  | 'voice'
  | 'assembly'
  | 'qa'
  | 'publisher'
  | 'analytics'
  | 'learning';

/** Normalized result every agent returns for a Job. */
export interface AgentRunResult {
  /** Structured output payload persisted as Job output + artifact. */
  data: unknown;
  usage: GatewayUsage;
  /** Artifact kind to persist (or null to skip artifact persistence). */
  artifactKind?: string;
  /** Actual model/provider used (for observability + cost roll-up). */
  model?: string;
  provider?: string;
}

export interface AgentRunner {
  type: AgentType;
  /** Human title of the agent. */
  name: string;
  run(input: unknown): Promise<AgentRunResult>;
}

const runners: Record<AgentType, AgentRunner> = {
  research: {
    type: 'research',
    name: 'Research / Trend Agent',
    async run(input) {
      const out = await researchAgent(input as Parameters<typeof researchAgent>[0]);
      return { data: out.ideas, usage: out.usage, model: out.model, provider: out.provider, artifactKind: 'idea' };
    },
  },
  script: {
    type: 'script',
    name: 'Story / Script Agent',
    async run(input) {
      const out = await scriptAgent(input as ScriptInput);
      return { data: out.script, usage: out.usage, model: out.model, provider: out.provider, artifactKind: 'script' };
    },
  },
  director: {
    type: 'director',
    name: 'Director Agent',
    async run(input) {
      const out = await directorAgent(input as PlanInput);
      return { data: out.plan, usage: out.usage, model: out.model, provider: out.provider, artifactKind: 'production_plan' };
    },
  },
  visual: {
    type: 'visual',
    name: 'Visual / Image Agent',
    async run(input) {
      const out = await visualAgent(input as VisualInput);
      return {
        data: out.assets,
        usage: { tokensIn: 0, tokensOut: 0, requests: out.count, costEur: out.costEur },
        artifactKind: 'assets',
        model: out.model,
        provider: out.provider,
      };
    },
  },
  voice: {
    type: 'voice',
    name: 'Voice / Narration Agent',
    async run(input) {
      const out = await voiceAgent(input as VoiceInput);
      return {
        data: out.voice,
        usage: { tokensIn: 0, tokensOut: 0, requests: out.count, costEur: out.costEur },
        artifactKind: 'voice',
        model: out.model,
        provider: out.provider,
      };
    },
  },
  assembly: {
    type: 'assembly',
    name: 'Video Assembly Agent',
    async run(input) {
      const out = await assemblyAgent(input as AssemblyInput);
      return {
        data: out.video,
        usage: { tokensIn: 0, tokensOut: 0, requests: out.count, costEur: out.costEur },
        artifactKind: 'video',
        model: out.model,
        provider: out.provider,
      };
    },
  },
  qa: {
    type: 'qa',
    name: 'QA Agent',
    async run(input) {
      const out = await qaAgent(input as QaInput);
      return { data: out.verdict, usage: out.usage, model: out.model, provider: out.provider, artifactKind: 'qa' };
    },
  },
  publisher: {
    type: 'publisher',
    name: 'Publisher Agent',
    async run(input) {
      const out = publisherAgent(input as PublishInput);
      return {
        data: out.package,
        usage: { tokensIn: 0, tokensOut: 0, requests: 0, costEur: out.costEur },
        artifactKind: 'publish_package',
        model: out.model,
        provider: out.provider,
      };
    },
  },
  analytics: {
    type: 'analytics',
    name: 'Analytics Agent',
    async run(input) {
      const out = computeAnalytics(input as AnalyticsInput);
      // Analytics is a global aggregation (not per-content), so it does NOT
      // persist an artifact and does NOT enter the per-content pipeline.
      return {
        data: out,
        usage: { tokensIn: 0, tokensOut: 0, requests: 0, costEur: 0 },
        model: 'deterministic',
        provider: 'local',
      };
    },
  },
  learning: {
    type: 'learning',
    name: 'Learning Agent',
    async run(input) {
      const out = computeLearning(input as LearningInput);
      // Learning is a global aggregation (not per-content), so it does NOT
      // persist an artifact and does NOT enter the per-content pipeline.
      return {
        data: out,
        usage: { tokensIn: 0, tokensOut: 0, requests: 0, costEur: 0 },
        model: 'deterministic',
        provider: 'local',
      };
    },
  },
};

export type ScriptInput = Parameters<typeof scriptAgent>[0];
export type PlanInput = Parameters<typeof directorAgent>[0];
export type VisualInput = Parameters<typeof visualAgent>[0];
export type VoiceInput = Parameters<typeof voiceAgent>[0];
export type AssemblyInput = Parameters<typeof assemblyAgent>[0];
export type QaInput = Parameters<typeof qaAgent>[0];
export type PublisherInput = PublishInput;
export type AnalyticsInputType = AnalyticsInput;
export type LearningInputType = LearningInput;

export function getRunner(type: AgentType): AgentRunner {
  const r = runners[type];
  if (!r) throw new Error(`No agent runner for type: ${type}`);
  return r;
}

export function allRunners(): AgentRunner[] {
  return Object.values(runners);
}

// Re-export contract types for convenience.
export type { Idea, Script, ProductionPlan, AssetsManifest, VoiceManifest, FinalVideoManifest };
