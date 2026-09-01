import { config } from '../config.js';

/**
 * OmniRoute adapter — speaks the Anthropic-compatible Messages API
 * (POST /v1/messages) against the local gateway.
 */
export interface OmniRouteCall {
  model: string;
  system?: string;
  messages: { role: string; content: string }[];
  max_tokens?: number;
  temperature?: number;
}

export interface OmniRouteResponse {
  content: { type: string; text?: string }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  model?: string;
}

export class OmniRouteError extends Error {
  constructor(
    msg: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(msg);
  }
}

const DEFAULT_MAX_OUTPUT = 4096;

export async function callOmniRoute(call: OmniRouteCall): Promise<OmniRouteResponse> {
  const url = `${config.omniRoute.url.replace(/\/+$/, '')}/v1/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.omniRoute.apiKey,
      authorization: `Bearer ${config.omniRoute.apiKey}`,
    },
    body: JSON.stringify({
      model: call.model,
      system: call.system,
      messages: call.messages,
      max_tokens: call.max_tokens ?? DEFAULT_MAX_OUTPUT,
      temperature: call.temperature ?? 0.5,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    try {
      const j = JSON.parse(text);
      throw new OmniRouteError(
        `OmniRoute error: ${j?.error?.message ?? res.statusText}`,
        res.status,
        text,
      );
    } catch (e) {
      if (e instanceof OmniRouteError) throw e;
      throw new OmniRouteError(`OmniRoute HTTP ${res.status}: ${text}`, res.status, text);
    }
  }

  let body;
  try {
    body = JSON.parse(text) as OmniRouteResponse;
  } catch {
    throw new OmniRouteError('OmniRoute returned non-JSON response', res.status, text);
  }

  return body;
}
