import { gatewayExecute } from '../gateway/gateway.js';
import type { GatewayUsage } from '../gateway/types.js';
import { productionPlanSchema, type ProductionPlan, type Script } from './contracts.js';

/**
 * Director Agent — does NOT produce video. Converts a script into a
 * ProductionPlan (the contract between creative content and production
 * systems). Scene-by-scene directives.
 */
export interface PlanInput {
  script: Script;
}

export interface PlanOutput {
  plan: ProductionPlan;
  usage: GatewayUsage;
  model: string;
  provider: string;
}

export async function directorAgent(input: PlanInput): Promise<PlanOutput> {
  const script = input.script;

  const schemaHint =
    '{"title":"string","targetAge":"string","totalDurationSeconds":number,"visualStyle":"string",' +
    '"scenes":[{"id":"string","durationSeconds":number,"characters":["string"],"location":"string",' +
    '"action":"string","camera":"string","emotion":"string","narration":"string"}]}';

  const r = await gatewayExecute<ProductionPlan>({
    task: 'direction.planning',
    system:
      'You are a video director for children\'s shorts. Convert the script into a precise ProductionPlan: a ' +
      'shot-by-shot technical contract. Specify visual style and a camera framing for each scene. This plan will ' +
      'feed asset generation, voice, and assembly. Be unambiguous and reproducible.',
    messages: [
      {
        role: 'user',
        content:
          'Convert this script into a ProductionPlan (keep the same scenes and narration):\n' +
          JSON.stringify(script, null, 2),
      },
    ],
    json: true,
    schemaHint,
    temperature: 0.3,
  });

  const plan = productionPlanSchema.parse(r.data);
  if (plan.totalDurationSeconds <= 0) {
    plan.totalDurationSeconds = script.scenes.reduce((acc, s) => acc + s.durationSeconds, 0);
  }
  return { plan, usage: r.usage, model: r.model, provider: r.provider };
}
