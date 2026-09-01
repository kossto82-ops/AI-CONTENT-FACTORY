import { callOmniRoute } from './omniroute.js';
import { resolveModel, estimateCostEur } from './router.js';
import type { GatewayRequest, GatewayResult, GatewayUsage } from './types.js';

const JSON_INSTRUCTION =
  '\n\nRespond with ONLY a single valid JSON object. Do not wrap in markdown fences. ' +
  'Do not add commentary.';

/**
 * Execute a conceptual task through the Model Gateway.
 * Returns a normalized result with usage + estimated cost.
 */
export async function gatewayExecute<T = unknown>(req: GatewayRequest): Promise<GatewayResult<T>> {
  const model = resolveModel(req.task, req.tier);

  let system = req.system ?? '';
  let maxTokens = 4096;
  if (req.json) {
    system = `${system}\n${JSON_INSTRUCTION}`.trim();
    if (req.schemaHint) {
      system = `${system}\nExpected JSON shape: ${req.schemaHint}`;
    }
    maxTokens = 8192;
  }

  const resp = await callOmniRoute({
    model,
    system: system || undefined,
    messages: req.messages,
    temperature: req.temperature ?? 0.5,
    max_tokens: maxTokens,
  });

  const raw = (resp.content ?? [])
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text as string)
    .join('\n')
    .trim();

  const tokensIn = resp.usage?.input_tokens ?? estimateTokens(req.messages.map((m) => m.content).join('\n') + system);
  const tokensOut = resp.usage?.output_tokens ?? estimateTokens(raw);

  const usage: GatewayUsage = {
    tokensIn,
    tokensOut,
    requests: 1,
    costEur: estimateCostEur(model, tokensIn, tokensOut),
  };

  let data: T = raw as T;
  if (req.json) {
    data = parseJson<T>(raw);
  }

  return { data, raw, model, provider: 'omniroute', usage };
}

function parseJson<T>(raw: string): T {
  const cleaned = stripCodeFence(raw);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Last resort: extract first balanced JSON object.
    const obj = extractJsonObject(cleaned);
    if (obj !== null) {
      try {
        return JSON.parse(obj) as T;
      } catch {
        /* fall through */
      }
    }
    throw new Error(`Gateway JSON parse failed. Received:\n${raw.slice(0, 1000)}`);
  }
}

function stripCodeFence(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return m ? m[1]! : s;
}

function extractJsonObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** Rough token estimate fallback (chars/4) when provider omits usage. */
function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}
