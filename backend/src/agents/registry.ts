import type { GatewayUsage } from '../gateway/types.js';
import { researchAgent } from './research.js';
import { scriptAgent } from './script.js';
import { directorAgent } from './director.js';
import { qaAgent } from './qa.js';
import type { Idea, ProductionPlan, Script } from './contracts.js';

export type AgentType = 'research' | 'script' | 'director' | 'qa';

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
  qa: {
    type: 'qa',
    name: 'QA Agent',
    async run(input) {
      const out = await qaAgent(input as QaInput);
      return { data: out.verdict, usage: out.usage, model: out.model, provider: out.provider, artifactKind: 'qa' };
    },
  },
};

export type ScriptInput = Parameters<typeof scriptAgent>[0];
export type PlanInput = Parameters<typeof directorAgent>[0];
export type QaInput = Parameters<typeof qaAgent>[0];

export function getRunner(type: AgentType): AgentRunner {
  const r = runners[type];
  if (!r) throw new Error(`No agent runner for type: ${type}`);
  return r;
}

export function allRunners(): AgentRunner[] {
  return Object.values(runners);
}

// Re-export contract types for convenience.
export type { Idea, Script, ProductionPlan };
