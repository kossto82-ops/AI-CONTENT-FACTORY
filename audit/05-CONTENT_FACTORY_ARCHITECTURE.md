# CONTENT FACTORY ARCHITECTURE — Definitive Design

## 1. Architecture Decision

**OPTION D: Hybrid architecture on our existing foundation.**

We keep our Node+TypeScript stack, SQLite, Vite+React, and OmniRoute Gateway. We selectively adopt proven patterns from the audited repos, adapting them to TypeScript. We do NOT fork any repo.

## 2. What We Keep (Already Built & Working)

```
+---------------------------------------------------------------+
|                    CONTROL CENTER (React)                      |
|  Dashboard · Agents · Content · Approvals · Pipelines         |
+-------------------------------|-------------------------------+
                                |
+---------------------------------------------------------------+
|                      API / ORCHESTRATOR (Node+TS)             |
|  HTTP API · State Machine · Pipeline Engine · Event Bus       |
+-------------------------------|-------------------------------+
                                |
+---------------------------------------------------------------+
|                        MODEL GATEWAY                          |
|  Task Router · OmniRoute Adapter · Cost Accounting            |
+---------------------------------------------------------------+
```

This is solid. The 4 repos have nothing comparable to our typed orchestrator, state machine, or OmniRoute integration.

## 3. What We Add (New Components)

### 3.1 Production Engine (Phase 5-7)

```
AGENT RUNTIME
      │
      ▼
┌─────────────────────────────────────────────┐
│              PRODUCTION ENGINE               │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  Visual   │  │  Voice   │  │ Assembly │  │
│  │  Agent    │  │  Agent   │  │  Agent   │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  │
│       │              │              │        │
│  ┌────▼──────────────▼──────────────▼────┐  │
│  │         PRODUCTION TOOLS (TS)         │  │
│  │  ImageGen · TTS · FFmpeg · Subtitles  │  │
│  │  StockFetch · MusicMix · KenBurns     │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

**Key principle:** Production tools are TypeScript modules (not Python subprocesses). For FFmpeg, we spawn a child process. For TTS/image-gen, we call APIs directly or via OmniRoute.

### 3.2 Asset Library (Phase 5+)

```
┌─────────────────────────────────────┐
│          ASSET LIBRARY               │
│                                      │
│  SQLite + embeddings + cosine search │
│  (adapted from AI Shorts Generator)  │
│                                      │
│  Tables:                             │
│  - assets (id, type, path, embed,    │
│    metadata, usage_count, created)   │
│  - asset_usage (asset_id, video_id)  │
│                                      │
│  Match-then-generate pattern:        │
│  1. Embed query (scene description)  │
│  2. Cosine search against library    │
│  3. If score > threshold → reuse     │
│  4. If miss → generate + catalog     │
└─────────────────────────────────────┘
```

### 3.3 Review Gate Engine (Phase 8, patterns from Phase 3+)

Adapted from Video Factory's `reviewer.py`:

```typescript
interface ReviewGate {
  name: string;
  maxAttempts: number;
  scoring: ScoringCriteria[];
  regenerationPrompt?: (feedback: string) => string;
  reviewPrompt: (artifact: Artifact) => string;
  approvalThreshold: number;
}

async function executeReviewGate(
  gate: ReviewGate,
  artifact: Artifact,
  gateway: ModelGateway
): Promise<ReviewResult> {
  for (let attempt = 1; attempt <= gate.maxAttempts; attempt++) {
    const result = await gateway.execute({
      task: 'quality.review',
      messages: [{ role: 'user', content: gate.reviewPrompt(artifact) }],
      json: true,
    });
    if (result.data.score >= gate.approvalThreshold) {
      return { approved: true, score: result.data.score, attempts: attempt };
    }
    if (gate.regenerationPrompt && attempt < gate.maxAttempts) {
      artifact = await regenerate(artifact, result.data.feedback);
    }
  }
  return { approved: false, score: lastScore, attempts: gate.maxAttempts };
}
```

## 4. Agent Architecture (Final)

### What IS an agent vs. what is NOT

| Component | Type | Rationale |
|-----------|------|-----------|
| Research Agent | **Agent** | LLM reasoning, autonomous idea generation |
| Script Agent | **Agent** | LLM creative writing, autonomous content generation |
| Director Agent | **Agent** | LLM planning, converting script to production contract |
| Visual Agent | **Agent** | LLM decides image prompts; BUT image generation is a tool call |
| Voice Agent | **Agent** | LLM decides narration structure; BUT TTS is a tool call |
| Assembly Agent | **Service/Tool** | Deterministic FFmpeg pipeline; no LLM reasoning needed |
| QA Agent | **Agent** | LLM reviews and scores; autonomous quality judgment |
| Publisher Agent | **Service** | Deterministic metadata formatting + API calls |
| Analytics Agent | **Service** | Deterministic data aggregation; LLM only for insights |
| Asset Library | **Service** | Deterministic SQLite + embeddings; no LLM needed |
| Model Gateway | **Service** | Deterministic routing + API calls; no LLM needed |
| FFmpeg wrapper | **Tool** | Deterministic subprocess call |
| TTS wrapper | **Tool** | Deterministic API call |
| Image gen wrapper | **Tool** | Deterministic API call |
| Subtitle generator | **Tool** | Deterministic (Whisper + formatting) |
| Ken Burns generator | **Tool** | Deterministic FFmpeg filter |
| Music mixer | **Tool** | Deterministic FFmpeg filter |

**Rules:**
- Agents use LLM for reasoning/autonomy → they call the Model Gateway
- Services/tools are deterministic → they execute without LLM
- Assembly, Publisher, Analytics are NOT agents (deterministic)
- FFmpeg, TTS, image gen are NOT agents (tool calls)

### Agent Interface (our existing pattern)

```typescript
interface AgentRunner {
  type: AgentType;
  run(input: unknown, context: AgentContext): Promise<{
    output: unknown;
    usage: UsageInfo;
  }>;
}
```

Each agent:
1. Receives typed input (from Orchestrator via `buildInput()`)
2. Calls Model Gateway (one or more calls)
3. Returns typed output + usage
4. NEVER calls other agents
5. NEVER picks providers
6. Orchestrator handles all state transitions

## 5. Pipeline Architecture (Final)

### Pipeline Definitions as Data

```typescript
interface PipelineStep {
  agent: AgentType;
  mode?: 'manual' | 'semi_automatic' | 'automatic';
  requiresApproval?: boolean;
  approvalKind?: string;
  retryPolicy?: { maxRetries: number; backoffMs: number };
}

const FULL_PIPELINE: PipelineStep[] = [
  { agent: 'research', mode: 'automatic', requiresApproval: true, approvalKind: 'idea' },
  { agent: 'script', mode: 'semi_automatic', requiresApproval: true, approvalKind: 'script' },
  { agent: 'director', mode: 'semi_automatic', requiresApproval: true, approvalKind: 'plan' },
  { agent: 'visual', mode: 'semi_automatic', requiresApproval: true, approvalKind: 'assets' },
  { agent: 'voice', mode: 'automatic' },
  { agent: 'assembly', mode: 'automatic' },
  { agent: 'qa', mode: 'automatic' },
  { agent: 'publisher', mode: 'semi_automatic', requiresApproval: true, approvalKind: 'publish' },
];
```

### Pipeline Execution (our existing drain() pattern)

1. Orchestrator creates Job for next step
2. If mode = SEMI_AUTOMATIC and requiresApproval → WAITING_APPROVAL
3. Human approves → Job becomes READY → drain() picks it up
4. Agent runs → output persisted as versioned artifact
5. Next step's input built from artifacts
6. Repeat until pipeline complete

### Parallel Execution (NEW — from Video Factory pattern)

For Visual Agent specifically, scenes can be processed in parallel:

```typescript
// In Visual Agent
const sceneJobs = scenes.map(scene => 
  gateway.execute({ task: 'image.generation', messages: [...] })
);
const results = await Promise.allSettled(sceneJobs);
// Aggregate results, mark failures for retry
```

## 6. Data Model (Extended)

### New tables (added to existing schema)

```sql
-- Asset Library (Phase 5)
CREATE TABLE asset (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,          -- 'image', 'clip', 'audio', 'music'
  path TEXT NOT NULL,
  description TEXT,
  embedding JSON,              -- float array as JSON
  metadata JSON,               -- prompt, model, provider, cost
  usage_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE asset_usage (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES asset(id),
  content_id TEXT NOT NULL REFERENCES content(id),
  scene_index INTEGER,
  used_at TEXT NOT NULL
);

-- Scene tracking (Phase 5)
CREATE TABLE scene (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL REFERENCES content(id),
  scene_index INTEGER NOT NULL,
  narration TEXT,
  image_prompt TEXT,
  motion_prompt TEXT,
  duration_seconds REAL,
  asset_id TEXT REFERENCES asset(id),
  status TEXT DEFAULT 'pending',
  metadata JSON
);
```

### Existing tables (no changes needed)
- `content` — lifecycle tracking (IDEA → PUBLISHED)
- `job` — execution tracking with full audit trail
- `agent` — agent configuration and status
- `approval` — typed approval gates
- `artifact` — versioned content artifacts
- `execution` — per-run model/token/cost data
- `pipeline` — pipeline definitions
- `event` — event log
- `model_registry` — task→tier→model routing

## 7. Model Gateway Extension

### New Tasks for Production

```typescript
type GatewayTask =
  // Existing (brain-first)
  | 'idea.generation' | 'trend.analysis' | 'script.writing'
  | 'direction.planning' | 'quality.review' | 'classification'
  | 'code' | 'reasoning'
  // New (production)
  | 'image.generation'    // FLUX, Imagen, SD
  | 'video.generation'    // Veo, Wan, Kling
  | 'text.to.speech'      // Edge TTS, OpenAI, ElevenLabs
  | 'speech.to.text'      // Whisper for timestamps
  | 'music.generation'    // Suno, ElevenLabs
  | 'image.understanding' // Vision QA
  | 'embedding';          // For asset library
```

### Provider Routing for New Tasks

```typescript
const PRODUCTION_ROUTES: Record<string, Record<Tier, string>> = {
  'image.generation': {
    cheap: 'auto/flux-schnell',      // Fast, cheap
    standard: 'auto/flux-dev',       // Good quality
    quality: 'auto/imagen-4',        // Best quality
  },
  'text.to.speech': {
    cheap: 'auto/edge-tts',          // Free (local)
    standard: 'auto/openai-tts',     // Good quality
    quality: 'auto/elevenlabs',      // Best quality
  },
  'video.generation': {
    cheap: 'auto/wan-1.3b',         // Local GPU
    standard: 'auto/wan-5b',        // Cloud
    quality: 'auto/veo-3',          // Best
  },
  // ...
};
```

## 8. Error Handling Strategy

### From Video Factory: Graceful Degradation

```typescript
// Adapted from Video Factory's fallback chain
const IMAGE_FALLBACK: FallbackChain = {
  primary: 'fal.flux-dev',
  fallbacks: [
    { condition: 'provider_unavailable', try: 'local.sdxl-turbo' },
    { condition: 'all_failed', try: 'stock.pexels' },
    { condition: 'stock_empty', use: 'placeholder' },
  ],
};
```

### Retry Strategy (from Video Factory + our state machine)

```typescript
// Our existing retry pattern + Video Factory's review loop
const RETRY_POLICY: Record<string, RetryConfig> = {
  agent: { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 },
  review_gate: { maxRetries: 2, backoffMs: 0 },  // No delay, just regenerate
  provider_call: { maxRetries: 3, backoffMs: 500, backoffMultiplier: 2 },
};
```

## 9. Observability Architecture

### Cost Tracking per Video (from Video Factory)

```typescript
// Extended from Video Factory's CostTracker pattern
interface VideoCostReport {
  contentId: string;
  stages: StageCost[];
  total: {
    tokensIn: number;
    tokensOut: number;
    costEur: number;
    modelBreakdown: Record<string, { calls: number; cost: number }>;
  };
}

// Example output:
// CONTENT-00142
// Research       €0.0012  (auto/cheap, 3 calls)
// Script         €0.0008  (auto/standard, 2 calls)
// Director       €0.0005  (auto/standard, 1 call)
// Visual         €0.0300  (fal flux-dev, 5 images)
// Voice          €0.0100  (openai-tts, 45s)
// Assembly       €0.0000  (local FFmpeg)
// QA             €0.0005  (auto/vision, 1 call)
// ─────────────────────
// TOTAL          €0.0430
```

### Event Stream (from our existing bus + OpenMontage's events.jsonl)

```typescript
// Our in-process bus + file-based event log
interface FactoryEvent {
  type: string;           // 'job.started', 'approval.requested', etc.
  entity: string;         // 'content', 'job', 'approval'
  entityId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}
```

## 10. What We Eliminate

| Eliminated | Reason |
|------------|--------|
| AGPL code from OpenMontage | License contamination |
| Remotion (Phase 5-6) | Overkill for FFmpeg-based shorts; defer to Phase 7 if needed |
| HyperFrames | Too complex for MVP |
| Character animation | Not needed for children's shorts initially |
| Talking head / lip sync | Requires specialized models, defer |
| AUTOMATIC1111 | Replaced by OmniRoute image gen |
| Flask dashboard | We have React |
| In-memory state | We have SQLite |
| String-based provider routing | We have typed Gateway |

## 11. Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript | Already built, stack consistency |
| Backend | Node + node:http | Already working, no need for Express |
| Database | SQLite (node:sqlite) | Zero-ops, already working |
| Frontend | Vite + React + Tailwind | Already built |
| AI routing | OmniRoute (local gateway) | Provider independence, cost control |
| Video engine | FFmpeg (subprocess) | Universal, free, proven |
| TTS | Edge TTS (subprocess) + OmniRoute | Free local + premium fallback |
| Image gen | OmniRoute (FLUX/Imagen) | Provider-independent |
| Captions | faster-whisper (Python subprocess) or OpenAI Whisper API | Word-level timestamps |
| Embeddings | OpenAI text-embedding-3-small via OmniRoute | For asset library |
| Music | User-provided + optional AI gen | Keep simple initially |
