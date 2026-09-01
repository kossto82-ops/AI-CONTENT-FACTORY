# AI Content Factory — Roadmap

Incremental; each phase ends with a verified, working increment. "Brain-first":
we prove orchestration before production/rendering.

## Phase 0 — Discovery (DONE)
Audit environment (Node 26, Python 3.14, Git, OmniRoute live on :20128, no
Docker/Java/ffmpeg/DB). Docs: ARCHITECTURE.md, PRODUCT.md, DECISIONS.md.

## Phase 1 — Foundation
- Monorepo scaffold: `backend` (Node+TS), `frontend`, shared types.
- Store: SQLite schema + migrations (Content, Job, Agent, Approval, Execution,
  Cost, Pipeline, Model/Provider registry).
- Model Gateway: OmniRoute adapter + task routing + cost/usage accounting.
- Job system: state machine, persistence, retries, logs.
- Orchestrator: create/run jobs, dependencies, approval gates, resume.
- Minimal CLI to drive it (before UI).

## Phase 2 — Control Center
- Backend HTTP API + auth gate.
- Frontend: Dashboard, Agents, Jobs, Pipelines views; start/pause/stop/resume/
  retry/approve/reject controls.

## Phase 3 — Research + Script
- Research Agent (idea discovery, trend/format analysis, structured proposals).
- Script Agent (script v{N}).
- Manual/Semi modes + approval gates wired end-to-end.

## Phase 4 — Director
- Director Agent: script -> ProductionPlan (Scene[] contract).
- Versioned plans; rollback path on QA rejection.

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
