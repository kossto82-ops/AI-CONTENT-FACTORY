# AI Content Factory — Roadmap

Incremental; each phase ends with a verified, working increment. "Brain-first":
we prove orchestration before production/rendering.

## Phase 0 — Discovery (DONE)
Audit environment (Node 26, Python 3.14, Git, OmniRoute live on :20128, no
Docker/Java/ffmpeg/DB). Docs: ARCHITECTURE.md, PRODUCT.md, DECISIONS.md.

## Phase 1 — Foundation (DONE, `AICF-001`)
- Monorepo scaffold: `backend` (Node+TS), `frontend`, shared types.
- Store: SQLite schema + migrations (Content, Job, Agent, Approval, Execution,
  Cost, Pipeline, Model/Provider registry).
- Model Gateway: OmniRoute adapter + task routing + cost/usage accounting.
- Job system: state machine, persistence, retries, logs.
- Orchestrator: create/run jobs, dependencies, approval gates, resume.
- Minimal CLI to drive it (before UI).
- E2E proven via CLI against live gateway (`The Lost Star Mystery`, cost €0.0025).

## Phase 2 — Control Center (DONE)
- Backend HTTP API (`backend/src/server.ts`): `node:http` + CORS. Endpoints:
  `GET /api/dashboard`, `GET /api/agents`, `GET|POST /api/content`,
  `GET /api/content/:id`, `POST /api/pipeline/:id/start`, `POST /api/jobs/run`,
  `GET /api/jobs/:id`, `GET /api/approvals`,
  `POST /api/approvals/:id/decide`, `GET /api/pipelines`.
- Frontend: Vite + React + Tailwind v4 (`frontend/`), tabbed Control Center:
  Dashboard / Agents / Content / Approvals, live polling (~4s), create idea,
  start pipeline, run jobs, approve/reject. Dev proxy `/api` -> :8787.
- E2E proven: UI path (proxy -> API -> orchestrator -> gateway) ran
  Research -> gates(idea/script/plan) -> QA; QA approved (0.9); 4 jobs; €0.003.

## Phase 3 — Research + Script + Configurable Modes (DONE, `AICF-003`)
- Research Agent (idea discovery, trend/format analysis, structured proposals).
- Script Agent (script v{N}).
- Manual/Semi modes + approval gates wired end-to-end.
- **Configurable execution modes**: per-step `mode` (AUTOMATIC / SEMI_AUTOMATIC /
  MANUAL) + approval-gate toggle, persisted in the `pipeline` table
  (`pipelineStore`, Decision D-10 now implemented). Pipelines-as-data live, not
  just declared.
- New API: `GET /api/pipelines` (persisted + active), `PUT /api/pipelines/:id/
  steps/:agent` (mode/gate), `POST /api/jobs/:id/run` (explicit manual run,
  bypasses the MANUAL auto-skip guard).
- Control Center: new **Pipeline** tab with per-step mode select + gate toggle;
  a ▶ Run button on READY jobs.
- Orchestrator: `runJob` public API; `createNextStep` now resolves the next step
  by job owner agent instead of approval kind (fixes custom `approvalKind`).
- E2E via UI proxy (fresh test DB): script step set to MANUAL+no-gate -> after
  idea approval the script job stayed READY (manual does not auto-advance) -> ▶
  Run executed it explicitly -> `script v1` COMPLETED, pipeline halted (no
  director materialized). Cost ~€0.0016 for the manual script run.

## Phase 4 — Director (DONE, `AICF-004`)
- Director Agent: script -> ProductionPlan (Scene[] contract).
- Versioned plans; **rollback path on QA rejection**: `POST /api/content/:id/revise/director`
  re-runs the Director with the latest QA issues -> `production_plan` v2+ -> plan gate -> QA v2.
  UI surfaces the latest QA verdict + a "Revise plan" action when rejected.

## Phase 5 — Visual (DONE, `AICF-006`)
- Visual Agent: **image generation (FLUX via OmniRoute)** — a new image-only gateway
  channel (`POST /v1/images/generations`) returns inline base64 JPEGs.
- Consumes `production_plan`; generates **one vertical (768x1344) image per scene** with
  character/style-consistent prompts (`flux.2-klein-4b`, ~2s/image).
- Saves PNG/JPEG to `backend/assets/{contentId}/`, persists an `assets` JSON manifest
  (scene -> file), served at `GET /api/assets/{contentId}/{file}`; UI shows thumbnails.
- Video-gen ready (veo/seedance) for Phase 7. No vision QA here (deferred to Phase 8).

## Phase 6 — Voice (DONE, `AICF-007`; live TTS synthesis UNPROVEN)
- Voice Agent: per-scene narration audio from the ProductionPlan's `narration`
  text, via a new **audio-only gateway channel** (OmniRoute OpenAI-style
  `POST /v1/audio/speech`).
- Saves WAV to `backend/assets/{contentId}/audio/`, persists a `voice` JSON
  manifest (scene -> file/mime/duration), served at `GET
  /api/assets/{contentId}/audio/{file}`; UI plays each clip.
- Provider-swappable (adapter sits behind the Gateway, Decision D-25).
- **Caveat**: the backing NVIDIA TTS NIM (`nvidia/fastpitch`) upstream is
  currently DOWN (only OmniRoute :20128 listens; no NIM on :9000; no Docker to
  host one). The channel + full pipeline/file-write/serve/UI path is
  E2E-verified with a deterministic local WAV generator (`OMNIROUTE_TTS_STUB=1`),
  so pipeline wiring is proven; **live neural TTS stays UNPROVEN** until the NIM
  is available.

## Phase 7 — Assembly (DONE, `AICF-008`; live veo/seedance clips UNPROVEN)
- Video Assembly Agent (`assembly` step after Voice, before QA): consumes the
  ProductionPlan + `assets` + `voice` manifests and produces a **reproducible
  final video as composition data** — a `FinalVideoManifest` (exact scene
  timeline normalized to the plan total, per-scene clip/visual/voice layer
  references, resolution 768x1344 9:16) persisted as the `video` artifact,
  plus `subtitles.vtt` captions, a poster, and per-scene clips under
  `backend/assets/{contentId}/assembly/`.
- New gateway channel `POST /v1/videos/generations`
  (`gateway/video.ts`, model `veo-free/veo`). **Honest stub default** (D-15):
  `OMNIROUTE_VIDEO_STUB=1` generates a Deterministic animated GIF (pure-Node
  GIF89a + non-compressing LZW,
  scene-seeded motion band) so the whole pipeline/file-write/serve/UI path stays
  E2E-verifiable; real veo/seedance is gated behind `OMNIROUTE_VIDEO_STUB=0` and
  is **UNPROVEN** — probes of `veo-free/veo`(240s) and the other three live
  video models(150s each) all timed out; the live path now fails cleanly after
  a 120s timeout instead of hanging a job.
- Control Center: Final Video preview player on each content card (per-scene
  animated clip / image / video, caption marquee, scene dots, Play/Pause/Prev/
  Next, voice audio per scene, links to `subtitles.vtt` + poster); pipeline flow
  now shows Research → Script → Director → Visual → Voice → Assembly → QA.
- Pipeline store reconciliation: stored definitions are merged against the
  canonical DEFAULT_PIPELINE on load (missing steps injected, operator overrides
  preserved) — fixes dev DBs seeded before a step existed.
- E2E proven (fresh DB, stub channels): full brain-first pipeline → Assembly →
  QA; content `ASSEMBLED`; 4 scenes, 30s normalized timeline, 4 GIF clips
  (GIF89a, ~216KB) + `subtitles.vtt` + poster served with correct MIME.

## Phase 8 — QA (DONE, `AICF-009`; live vision model review UNPROVEN)
- QA Agent (`qa` step after Assembly, before publish): automated, deterministic
  review of duration, resolution, vertical 9:16, audio, subtitles, clip/visual
  errors, timeline continuity, plan-internal structure/coherence, metadata ->
  verdict (`approved` / `rejected`), score, categorized issues, and an 11-point
  checklist (`QaChecklist`, `null` = not checked).
- **New vision gateway channel** `POST /v1/messages`
  (`gateway/vision.ts`, Anthropic-style image blocks) routed to
  `auto/vision`; reads real still-images from the content asset dir. **Honest
  stub default** (D-16, same rule as D-15): `OMNIROUTE_QA_STUB=1` (default)
  runs only deterministic technical + plan-consistency checks; `=0` activates a
  **live plan review** (`quality.review`) plus **live vision review** of the
  stills, both gated on the gateway being up. **Live vision UNPROVEN** —
  OmniRoute :20128 is currently down, so the vision pass has not been validated
  round-trip; the pipeline runs fully with the stub.
- Orchestrator feeds `video` (FinalVideoManifest), `assets`, `voice`, plan +
  contentId to the QA step; verdict persisted as the `qa` artifact; plan/vision
  model passes are scored into the same verdict.
- Control Center: QA panel per content (verdict + score + summary + 11-point
  checklist grid with ✓/✕/—, top rejection issues with category/location).
- E2E proven (fresh DB, stub channels): full brain-first pipeline -> QA
  `approved` (1.0) over a real assembled video; both plan-consistency and
  deterministic media checks green.

## Phase 9 — Publisher
- Publisher Agent: title, description, hashtags, metadata, thumbnail;
  publish/schedule; optional + disableable.

## Phase 10 — Analytics
- Analytics Agent: performance analysis, feed Learning Agent.

## Phase 11 — Learning
- Learning Agent: learn from results -> generate new ideas.
- Semantic memory via embeddings (bge-m3 / mistral-embed).
