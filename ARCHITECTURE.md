# AI Content Factory — Architecture

Status: PROPOSED (Phase 6). Control Center + configurable pipeline modes +
Director revision loop + Visual Agent (FLUX image generation, asset store) +
Voice Agent (TTS narration audio, audio store). E2E-verified against live
gateway (voice: file/pipeline path with stub synth; neural TTS pending NIM).

## 1. Purpose

A platform that produces and manages short-form vertical video content
(YouTube Shorts / Reels), initially for children, via a controlled,
multi-agent production pipeline orchestrated from a **Control Center**.

The architecture is a **controlled production platform**, NOT a swarm of
autonomous agents. Every step is deterministic, observable, idempotent, and
recoverable. Humans approve at defined gateways.

## 2. Non-functional requirements (design drivers)

| Driver | Consequence |
|--------|-------------|
| Provider independence | All external AI/voice/video calls behind adapters; swap without touching agent logic |
| Cost control | Every call records tokens/requests/model/cost; routing prefers cheap/free when quality permits |
| Observability | Every Job stores full input/output/logs/trace; open a Job to see exactly what happened |
| Recoverability | Jobs + approvals persist; Orchestrator resumes after interruption without losing state |
| Simplicity first | Prefer boring tech; no new infra unless it earns its place |

## 3. Component layering

```
+---------------------------------------------------------------+
|                        CONTROL CENTER                         |
|  (Web UI: Dashboard / Agents / Jobs / Pipelines / Approvals)  |
+-------------------------------|-------------------------------+
                                |
                                v
+---------------------------------------------------------------+
|                         API / BACKEND                          |
+-------------------------------|-------------------------------+
                                v
+---------------------------------------------------------------+
|                        ORCHESTRATOR                           |
|  creates/executes jobs, resolves dependencies, retries,       |
|  approvals, pipelines, state transitions, event emission      |
+-------------------------------|-------------------------------+
                                v
+----------------------+  +----------------+  +----------------+
|        AGENTS        |  |    JOB SYSTEM  |  |   EVENT BUS    |
| Research · Script ·  |  | id/status/retry|  | (in-process or |
| Director · Visual ·  |  | persist state  |  |  simple)       |
| Voice · Assembly ·   |  |                |  |                |
| QA · Publisher       |  +----------------+  +----------------+
+----------------------+
            |
            v
+---------------------------------------------------------------+
|                         MODEL GATEWAY                          |
|  task -> model routing -> provider adapter -> OmniRoute/FreeLLM|
+---------------------------------------------------------------+
            |
            v
+---------------------------------------------------------------+
|              MODELS / PROVIDERS (OmniRoute, FreeLLM)          |
+---------------------------------------------------------------+
```

## 4. Component responsibilities

### 4.1 Control Center (frontend)
- Web UI. Dashboard of pipeline/lifecycle state.
- Per-agent card: status, mode, last job, duration, errors, model, est. cost, tokens.
- Job detail view (full I/O, logs, retries, trace).
- Pipeline view with start/pause/stop/resume/retry/approve/reject.
- Human-in-the-loop surfaces (approve/reject/edit/favorite).

### 4.2 API / Backend
- Thin HTTP/JSON API consumed by the Control Center.
- Auth + authorization for who may view/act/approve.
- Reads/writes the store; submits commands to the Orchestrator.

### 4.3 Orchestrator
- Single source of truth for job lifecycle and pipeline progression.
- Creates jobs, enforces dependencies, runs agents, handles retries/errors,
  enforces approval gates, emits events.
- Stateless between commands: every transition is reloaded from the store, so
  a crash can resume (idempotent state machine).
- Mode-aware: AUTOMATIC drains through gates, SEMI-AUTOMATIC halts for
  approval, MANUAL stays `READY` until an explicit `runJob`. Pipeline
  definitions (steps, modes, gates) are loaded from the persisted `pipeline`
  table (`pipelineStore`) — pipelines-as-data, configurable from the UI.

### 4.4 Agents
- Specialized units, each with a clear single responsibility.
- Receive a typed input, produce a typed, versionable output.
- DO NOT call each other or know models. They call the Model Gateway.
- Each agent is executable in MANUAL / SEMI-AUTOMATIC / AUTOMATIC mode.

### 4.5 Job System
- Every executable unit is a Job with identity, status, input, output, parent,
  dependencies, timestamps, retries, logs, model, provider, tokens, cost, error.
- All state transitions centralized (single state-machine module).

### 4.6 Model Gateway
- The ONLY place agents/providers meet.
- An agent asks conceptually ("generate a creative script"); the Gateway routes
  by task to a model, calls the provider via an adapter, returns normalized
  output + usage + cost.
- Provider adapters isolate OmniRoute / FreeLLM / any future provider.

### 4.7 Event Bus
- Decoupled side effects (notifications, dashboard refresh, analytics hooks).
- MVP: in-process pub/sub. External broker (RabbitMQ/Kafka) only if/when
  multiple services or heavy fan-out demands it.

## 5. Data flow (happy path)

```
Research --ideas--> [APPROVAL" APPROVE ] --> Script --script--> Director
Director --prod plan--> Visual --assets--> / Voice --audio--> /
Assembly --video--> QA --verdict--> [APPROVAL] --> Publisher (optional)
```

Each arrow is one or more Jobs created by the Orchestrator. The result of each
step is persisted and versioned before the next step reads it.

## 6. Agent architecture

- Agent = thin shell: reads Job input, invokes Model Gateway (one or several
  calls), post-processes into a strict schema, returns Job output + usage.
- Agent never holds provider keys, never picks providers, never mutates sibling
  state directly — the Orchestrator does.
- Prompts/system-design are data (per-agent, versioned), so behavior can be
  tuned without code changes.

## 7. Job architecture

- One state machine module defines all allowed transitions (see DECISIONS.md).
- Jobs are persisted; retries are explicit; every transition is a log line.
- A Job references: agent, input, output (versioned), parent, dependencies,
  timestamps, attempt count, token usage, cost, error, model, provider.

## 8. Model Gateway (design)

- Interface: `execute(task, payload, opts) -> {output, usage, cost, model, provider}`.
- Routing rules (task -> tier) defined as DATA (config), not code.
- Tiers (example): cheap / free / standard / quality / vision / reasoning.
- Provider resolution: OmniRoute (default) or FreeLLM (alias / failover).
- Normalization: all providers return the same output shape.
- Usage + cost accounting happens here (single choke point).

### 8.1 Image channel (Visual Agent)

- Image generation is a SEPARATE gateway channel from text: OmniRoute exposes an
  OpenAI-compatible Images API (`POST /v1/images/generations`) returning inline
  base64 (`data[0].b64_json`), not `content[].text`. Implemented as
  `gateway/image.ts` (`callOmniRouteImage`).
- Default model `nvidia/black-forest-labs/flux.2-klein-4b` (~2s/image, reliable on
  the test rig; `flux.1-schnell`/`dev` can stall). Vertical `768x1344` for Shorts.
- The Visual Agent builds one character/style-consistent prompt per scene from the
  ProductionPlan, calls the image channel, and writes the binary to
  `backend/assets/{contentId}/`. Only the JSON `assets` manifest (scene -> file,
  mime, bytes) is persisted as the artifact — the DB stays JSON-only; binaries live
  on disk (gitignored) and are served at `GET /api/assets/{contentId}/{file}`
  (path-traversal guarded).

### 8.2 Audio channel (Voice Agent)

- TTS is a THIRD gateway channel: OmniRoute exposes an OpenAI-compatible Audio
  Speech API (`POST /v1/audio/speech`, body `{model, input, voice, format}`)
  returning a raw audio body (`audio/wav` / `audio/mpeg`). Implemented as
  `gateway/audio.ts` (`callOmniRouteSpeech`).
- Default model `nvidia/fastpitch`, default voice `Magpie-Multilingual.EN-US.Aria`,
  default format `wav` (universal browser playback).
- The Voice Agent generates one narration clip per scene from the
  ProductionPlan's `narration` text, writes binaries to
  `backend/assets/{contentId}/audio/`, persists a JSON `voice` manifest
  (scene -> file/mime/durationSeconds/text) as the artifact, and serves files at
  `GET /api/assets/{contentId}/audio/{file}` (same traversal-guarded route).
- Offline dev mode `OMNIROUTE_TTS_STUB=1` returns a locally synthesized playable
  WAV (sine "voice") so the pipeline/file-write/serving path can be exercised
  when the TTS upstream is down; it is NOT live TTS.

## 9. Orchestration

- Pipeline definition = ordered list of agent steps + optional approval gates,
  persisted as JSON in the `pipeline` table and editable via the API/UI.
- Orchestrator walks the pipeline, materializing Jobs, respecting modes
  (AUTOMATIC passes gates; SEMI-AUTOMATIC stops for approval; MANUAL waits for
  explicit trigger via `runJob`).
- Pause/stop/resume/retry are commands that translate to state transitions.
- Idempotent: re-running from a persisted state produces no duplicate work.

## 10. Frontend / Backend

- Backend: Node + TypeScript (single service: API + Orchestrator in-process,
  or split if it grows). MVP keeps one process for simplicity.
- Frontend: Vite + React + Tailwind v4 (confirmed); "AI ops center" aesthetic,
  dark, dense, status-first. Vite dev server proxies `/api` -> backend :8787.
- Storage: SQLite via Node's built-in `node:sqlite` (MVP, single file,
  transactions, WAL). No ORM; thin repository layer.

## 11. Storage

- SQLite database `factory.db`.
- JSON columns for versioned artifacts (script, prod plan) + dedicated tables
  for Jobs/Agents/Content/Assets/Approvals/Executions/Costs.
- File store (local `assets/` dir) for generated media in later phases.
- Migrations via a simple versioned SQL runner.

## 12. Versioning

- Script, ProductionPlan, Asset in earlier phases already versionable:
  `(content_id, version)` unique; never deleted.
- Re-run of an agent creates a NEW version; the old one is retained and
  referenced, enabling rollback after QA failure (Director revises -> v2).

### 12.1 Director revision loop (rollback path)

- When the latest QA verdict is `rejected`, the content becomes `revisable`
  (only if a `production_plan` exists).
- `POST /api/content/:id/revise/director` re-runs the Director step with an
  input override: `{ script, revision: { issues, previousPlan } }` — the QA
  issues are injected into the Director prompt so the revised plan addresses
  them. The guard rejects the call if the latest QA is not `rejected`.
- The revision is drained as a normal pipeline job: Director -> plan gate ->
  QA v2. QA runs against the new plan version, so the loop can iterate (v2,
  v3, ...) until QA approves. The UI surfaces the latest verdict + a
  "Revise plan" action when `revisable`.
