import { gatewayExecute } from '../gateway/gateway.js';
import type { GatewayUsage } from '../gateway/types.js';
import {
  channelPromptOverride,
  scriptSchema,
  type ChannelBeat,
  type ChannelConfig,
  type Idea,
  type Script,
} from './contracts.js';

/**
 * Story / Script Agent — receive an approved idea, produce a structured,
 * versionable script (concept, hook, structure, narration, dialogues, scenes,
 * ending, CTA). Duration and beat structure come from the channel config when
 * present (e.g. ToyMonster Club: 15s Hook/Caos/CTA), else default 30s.
 */
export interface ScriptInput {
  idea: Idea;
  channelConfig?: ChannelConfig;
}

export interface ScriptOutput {
  script: Script;
  usage: GatewayUsage;
  model: string;
  provider: string;
}

function beatDirective(beats?: ChannelBeat[]): string {
  if (!beats || beats.length === 0) return '';
  return (
    '\nBeat structure (follow these time windows exactly, one scene per beat):' +
    beats
      .map((b, i) => `\n  Beat ${i + 1} [${b.name}] ${b.start}s-${b.end}s: ${b.description}`)
      .join('')
  );
}

export async function scriptAgent(input: ScriptInput): Promise<ScriptOutput> {
  const idea = input.idea;
  const cfg = input.channelConfig;
  const duration = cfg?.format.defaultDurationSec ?? 30;
  const override = channelPromptOverride(cfg, 'script');

  const schemaHint =
    '{"title":"string","concept":"string","hook":"string","targetAge":"string","structure":"string",' +
    '"narration":"string","dialogues":["string"],"ending":"string","cta":"string","scenes":[{"id":"string",' +
    '"durationSeconds":number,"characters":["string"],"location":"string","action":"string","camera":"string",' +
    '"emotion":"string","narration":"string"}]}';

  const r = await gatewayExecute<Script>({
    task: 'script.writing',
    system:
      'You are a children\'s short-video scriptwriter. Write a complete vertical Short script that is safe, ' +
      'clear, and emotionally engaging. Split it into scenes; each scene must have an id like "SCENE 01", ' +
      'a duration in seconds (summing to the total), characters, location, action, camera cue, emotion, and ' +
      'matching narration. Keep language simple for young children.',
    messages: [
      {
        role: 'user',
        content:
          `Write a ${duration}-second script based on this approved idea:\n` +
          `Title: ${idea.title}\nConcept: ${idea.concept}\nTarget age: ${idea.target_age}\n` +
          `Format: ${idea.format}\nHook: ${idea.hook}` +
          `\n\nBreak into exactly ${(cfg?.format.beats?.length ?? 1) === 3 ? 3 : '3-6'} scenes.` +
          beatDirective(cfg?.format.beats) +
          (override ? `\nChannel directive: ${override}` : '') +
          `\nInclude a CTA for follow/subscribe and ensure the final beat loops back to the start (perfect loop).`,
      },
    ],
    json: true,
    schemaHint,
  });

  const script = scriptSchema.parse(r.data);
  // Normalize scene ids even if the model did not produce "SCENE n".
  script.scenes = script.scenes.map((s, i) => ({
    ...s,
    id: s.id && /SCENE/i.test(s.id) ? s.id : `SCENE ${String(i + 1).padStart(2, '0')}`,
  }));
  return { script, usage: r.usage, model: r.model, provider: r.provider };
}
