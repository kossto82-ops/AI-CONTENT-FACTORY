import { gatewayExecute } from '../gateway/gateway.js';
import type { GatewayUsage } from '../gateway/types.js';
import { scriptSchema, type Idea, type Script } from './contracts.js';

/**
 * Story / Script Agent — receive an approved idea, produce a structured,
 * versionable script (concept, hook, structure, narration, dialogues, scenes,
 * ending, CTA).
 */
export interface ScriptInput {
  idea: Idea;
}

export interface ScriptOutput {
  script: Script;
  usage: GatewayUsage;
  model: string;
  provider: string;
}

export async function scriptAgent(input: ScriptInput): Promise<ScriptOutput> {
  const idea = input.idea;
  const duration = 30;

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
          `Format: ${idea.format}\nHook: ${idea.hook}\n\nBreak into 3-6 scenes. Include a CTA for follow/subscribe.`,
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
