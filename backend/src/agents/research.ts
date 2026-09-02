import { gatewayExecute } from '../gateway/gateway.js';
import type { GatewayUsage } from '../gateway/types.js';
import {
  channelPromptOverride,
  ideaListSchema,
  type ChannelConfig,
  type IdeaList,
} from './contracts.js';

/**
 * Research / Trend Agent — discover ideas, analyze trends/formats, produce
 * structured content proposals. Manual/semi/auto handled by the Orchestrator.
 */
export interface ResearchInput {
  topic?: string;
  targetAge?: string;
  niche?: string;
  count?: number;
  /** Channel config drives audience + prompt overrides (optional — defaults). */
  channelConfig?: ChannelConfig;
}

export interface ResearchOutput {
  ideas: IdeaList;
  usage: GatewayUsage;
  model: string;
  provider: string;
}

export async function researchAgent(input: ResearchInput): Promise<ResearchOutput> {
  const count = input.count ?? 5;
  const topic = input.topic ?? 'curiosity and friendship for young children';
  const age = input.targetAge ?? input.channelConfig?.audience.targetAge ?? '4-7';
  const override = channelPromptOverride(input.channelConfig, 'research');

  const schemaHint = `{"ideas":[{"title":"string","concept":"string","target_age":"string","format":"string","hook":"string","reason":"string","score":0.0}]} with exactly ${count} ideas`;

  const r = await gatewayExecute<IdeaList>({
    task: 'idea.generation',
    system:
      'You are a children\'s short-video content researcher. Propose ideas for vertical YouTube Shorts / Reels ' +
      'aimed at young children. Each idea must be safe, engaging, age-appropriate, and structured. Score 0-1.',
    messages: [
      {
        role: 'user',
        content:
          `Topic/niche: ${topic}\nTarget age: ${age}\n` +
          (override ? `Channel directive: ${override}\n` : '') +
          `Generate exactly ${count} content ideas. Format field is one of: story | explainer | singalong | quiz | "how-to".`,
      },
    ],
    json: true,
    schemaHint,
  });

  const ideas = ideaListSchema.parse(r.data);
  return { ideas, usage: r.usage, model: r.model, provider: r.provider };
}
