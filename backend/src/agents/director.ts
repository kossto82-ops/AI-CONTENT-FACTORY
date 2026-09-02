import { gatewayExecute } from '../gateway/gateway.js';
import type { GatewayUsage } from '../gateway/types.js';
import {
  channelPromptOverride,
  productionPlanSchema,
  type ChannelConfig,
  type ProductionPlan,
  type Script,
} from './contracts.js';

/**
 * Director Agent — does NOT produce video. Converts a script into a
 * ProductionPlan (the contract between creative content and production
 * systems). Scene-by-scene directives. Supports revision: when QA rejects a
 * plan, the next run receives the prior QA issues to fix (produces plan v2+).
 */
export interface RevisionContext {
  issues: { severity: string; category: string; message: string }[];
  previousPlan?: ProductionPlan;
}

export interface PlanInput {
  script: Script;
  revision?: RevisionContext;
  channelConfig?: ChannelConfig;
}

export interface PlanOutput {
  plan: ProductionPlan;
  usage: GatewayUsage;
  model: string;
  provider: string;
}

export async function directorAgent(input: PlanInput): Promise<PlanOutput> {
  const script = input.script;
  const revision = input.revision;
  const cfg = input.channelConfig;
  const override = channelPromptOverride(cfg, 'director');

  const schemaHint =
    '{"title":"string","targetAge":"string","totalDurationSeconds":number,"visualStyle":"string",' +
    '"scenes":[{"id":"string","durationSeconds":number,"characters":["string"],"location":"string",' +
    '"action":"string","camera":"string","emotion":"string","narration":"string"}]}';

  const styleBible = cfg?.visualStyle
    ? ` Style bible: visual style "${cfg.visualStyle.style}".${cfg.visualStyle.characterDescription ? ` Character/art: ${cfg.visualStyle.characterDescription}` : ''}`
    : '';
  const system =
    'You are a video director for children\'s shorts. Convert the script into a precise ProductionPlan: a ' +
    'shot-by-shot technical contract. Specify visual style and a camera framing for each scene. This plan will ' +
    'feed asset generation, voice, and assembly. Be unambiguous and reproducible.' +
    styleBible;

  const revisionBlock = revision
    ? [
        '\nThe PREVIOUS version of this plan was REJECTED by the QA reviewer.',
        `QA issues to fix (${revision.issues.length}):`,
        ...revision.issues.map((i, n) => `${n + 1}. [${i.severity}] ${i.category}: ${i.message}`),
        revision.previousPlan
          ? `Here is the REJECTED previous plan for reference (do not copy its flaws):\n${JSON.stringify(revision.previousPlan, null, 2)}`
          : '',
        'Produce a REVISED plan (same title/scenes as the script) that resolves every listed issue. ' +
          'Ensure totalDurationSeconds matches the sum of scene durations exactly, scenes flow in spatial/sequencing ' +
          'order, every scene keeps its narration, and pacing fits the target age.',
      ].join('\n')
    : '';

  const r = await gatewayExecute<ProductionPlan>({
    task: 'direction.planning',
    system,
    messages: [
      {
        role: 'user',
        content:
          'Convert this script into a ProductionPlan (keep the same scenes and narration):\n' +
          JSON.stringify(script, null, 2) +
          (override ? `\nChannel directive: ${override}` : '') +
          revisionBlock,
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
