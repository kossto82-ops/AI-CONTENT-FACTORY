import type { AgentMode } from './domain/types.js';
import type { AgentType } from './agents/registry.js';
import type { ApprovalKind } from './domain/types.js';

/**
 * Pipelines as DATA (Decision D-10). Operators define ordered steps; the
 * Orchestrator interprets them. Adding/removing/disabling a step is config,
 * not code.
 */

export interface PipelineStep {
  /** Index within the pipeline (ordering). */
  order: number;
  agent: AgentType;
  /** Mode for THIS step; overrides the agent default when present. */
  mode?: AgentMode;
  /** After this step completes, require human approval before next. */
  requiresApproval?: boolean;
  /** Approval kind requested at the gate (defaults to the step's artifact). */
  approvalKind?: ApprovalKind;
  /** Job id of the step this one depends on (default: previous step). */
  dependsOn?: string;
}

export interface PipelineDefinition {
  id: string;
  name: string;
  steps: PipelineStep[];
}

/** The default brain-first pipeline (Section 20). */
export const DEFAULT_PIPELINE: PipelineDefinition = {
  id: 'pipeline_brain',
  name: 'Brain-First (Research -> Script -> Director -> Visual -> Voice -> QA)',
  steps: [
    { order: 1, agent: 'research', requiresApproval: true, approvalKind: 'idea' },
    { order: 2, agent: 'script', requiresApproval: true, approvalKind: 'script' },
    { order: 3, agent: 'director', requiresApproval: true, approvalKind: 'plan' },
    { order: 4, agent: 'visual' },
    { order: 5, agent: 'voice' },
    { order: 6, agent: 'qa' },
  ],
};

/** Resolve the effective agent default mode for a step type. */
export function defaultAgentMode(agent: AgentType): AgentMode {
  // Research/QA/Visual/Voice default to AUTOMATIC; creative (script/director)
  // default to SEMI_AUTOMATIC (human gate on the creative artifact).
  switch (agent) {
    case 'research':
    case 'qa':
    case 'visual':
    case 'voice':
      return 'AUTOMATIC';
    default:
      return 'SEMI_AUTOMATIC';
  }
}
