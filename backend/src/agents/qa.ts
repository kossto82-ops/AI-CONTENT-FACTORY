import { gatewayExecute } from '../gateway/gateway.js';
import type { GatewayUsage } from '../gateway/types.js';
import { qaVerdictSchema, type ProductionPlan, type QaVerdict } from './contracts.js';

/**
 * QA Agent — automated review of a ProductionPlan (and, later, final video).
 * For the brain-first MVP it reviews the production plan for coherence,
 * duration, continuity, and appropriateness, returning a verdict.
 */
export interface QaInput {
  plan: ProductionPlan;
  scriptTitle?: string;
}

export interface QaOutput {
  verdict: QaVerdict;
  usage: GatewayUsage;
  model: string;
  provider: string;
}

export async function qaAgent(input: QaInput): Promise<QaOutput> {
  const plan = input.plan;

  const schemaHint =
    '{"status":"approved|rejected","score":0.0,"issues":[{"severity":"low|medium|high",' +
    '"category":"string","message":"string"}]}';

  const r = await gatewayExecute<QaVerdict>({
    task: 'quality.review',
    system:
      'You are a QA reviewer for children\'s video production plans. Review the plan for: total duration vs ' +
      'scene sum, scene continuity, missing/incoherent narration, character/location consistency, and ' +
      'age-appropriateness (must be safe for young children). Produce a verdict with a 0-1 score and a list of ' +
      'issues. Reject (score < 0.7) if there are high-severity issues.',
    messages: [
      {
        role: 'user',
        content:
          'Review this ProductionPlan and return a verdict:\n' + JSON.stringify(plan, null, 2),
      },
    ],
    json: true,
    schemaHint,
    temperature: 0.2,
  });

  const verdict = qaVerdictSchema.parse(r.data);
  // Guarantee deterministic mapping of score -> status if model is inconsistent.
  if (verdict.score >= 0.7 && verdict.status !== 'approved') {
    verdict.status = 'approved';
  } else if (verdict.score < 0.7) {
    verdict.status = 'rejected';
  }
  return { verdict, usage: r.usage, model: r.model, provider: r.provider };
}
