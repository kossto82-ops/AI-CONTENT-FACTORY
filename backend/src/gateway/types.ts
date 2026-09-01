/**
 * Model Gateway — the ONLY place agents meet models/providers.
 *
 * An agent asks conceptually (execute a task) and the Gateway:
 *   1. resolves task+pipeline-tier -> model combo (router)
 *   2. calls the provider through its adapter (OmniRoute here)
 *   3. normalizes the output shape
 *   4. records usage + estimated cost
 *
 * Agents never know providers/model ids. Swapping a provider = new adapter.
 */

export type GatewayTask =
  | 'idea.generation' // research: propose content ideas
  | 'trend.analysis' // research: analyze trends/formats
  | 'script.writing' // creative writing (higher quality)
  | 'direction.planning' // script -> production plan (structured)
  | 'quality.review' // QA structured verdict
  | 'classification' // cheap task
  | 'code' // internal tooling
  | 'reasoning'; // deep reasoning

export type Tier = 'cheap' | 'standard' | 'quality';

export interface GatewayUsage {
  tokensIn: number;
  tokensOut: number;
  requests: number;
  costEur: number;
}

export interface GatewayResult<T> {
  /** Parsed structured output, if the task requested JSON. */
  data: T;
  /** Raw assistant text (for diagnostics). */
  raw: string;
  model: string;
  provider: string;
  usage: GatewayUsage;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GatewayRequest {
  task: GatewayTask;
  tier?: Tier;
  system?: string;
  messages: ChatMessage[];
  /** When true, instruct the model to emit strict JSON matching the schema hint. */
  json?: boolean;
  /** Optional JSON schema description to embed in the prompt. */
  schemaHint?: string;
  temperature?: number;
}
