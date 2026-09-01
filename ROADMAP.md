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

## Phase 5 — Visual
- Visual Agent: image generation (FLUX via OmniRoute), asset selection,
  character/scene consistency, versioned assets. Video-gen ready (veo/seedance).
- Requires ffmpeg or image/gen tooling decision at this point.

## Phase 6 — Voice
- Voice Agent: narration + character voices (TTS via OmniRoute), audio,
  sync. Provider-swappable.

## Phase 7 — Assembly
- Video Assembly Agent: compose scenes/images/clips/voice/music/subtitles/
  effects -> final video. Reproducible.

## Phase 8 — QA
- QA Agent: automated review (duration, resolution, vertical, audio, subtitles,
  visual errors, coherence, continuity, appropriateness, metadata) -> verdict.
- Vision models via OmniRoute for visual QA.

## Phase 9 — Publisher
- Publisher Agent: title, description, hashtags, metadata, thumbnail;
  publish/schedule; optional + disableable.

## Phase 10 — Analytics
- Analytics Agent: performance analysis, feed Learning Agent.

## Phase 11 — Learning
- Learning Agent: learn from results -> generate new ideas.
- Semantic memory via embeddings (bge-m3 / mistral-embed).
