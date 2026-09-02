# DevRunbook — AI-CONTENT-FACTORY

Generated 2026-09-01 (Phase 7). Source of truth for local build/test/run/deploy.
Read this before ANY build/test/run/deploy.

## What this project is

Monorepo "AI Content Factory" — controlled multi-agent short-form vertical
video (YouTube Shorts / Reels). Brain-first: orchestration proven before
rendering. Backend = one Node/TS service (API + Orchestrator + Model Gateway),
frontend = Vite + React + Tailwind v4 Control Center. All model calls route
through a local **OmniRoute** gateway (`http://127.0.0.1:20128`).

## Stack & Prerequisites

- **Node.js ≥ 20** (verified on Node 26). npm scripts use `npm.cmd` on Windows
  PowerShell (the `npm.ps1` shim is blocked by ExecutionPolicy Restricted).
- No Docker, no Java, **no ffmpeg** — final video is composition DATA
  (Decision D-14), not a muxed MP4. Nothing else to install.
- SQLite via Node's built-in `node:sqlite` — no DB server, no native deps.
- **OmniRoute must be running** on `http://127.0.0.1:20128` (API key
  `sk-omniroute-local`). Most of the pipeline works without it via stubs (see
  Troubleshooting).
- No VPN or special network setup required.

## Directory layout

```
backend/   Node+TS: orchestrator, agents, gateway channels, REST API (:8787), SQLite DB
frontend/  Vite + React + Tailwind v4 Control Center (:5173, proxies /api -> :8787)
backend/assets/{contentId}/   generated media (images/audio/clips/assembly) — gitignored
backend/data/                 SQLite dev DBs (factory.db, faseN-test.db) — gitignored
```

## Setup (first run)

```bash
# backend
cd backend
cp .env.example .env        # adjust OMNIROUTE_URL / FACTORY_DB if needed
npm install

# frontend
cd ../frontend
npm install
```

## Build

```bash
cd backend
npm run build        # tsc emit -> dist/

cd ../frontend
npm run build        # vite build -> dist/
```

- Typecheck (no emit): `npm run typecheck` in both packages.

## Test

```bash
cd backend
npm test             # vitest run — 10 files, 85 tests (after Phase 11)
npm test             # (run via `npm.cmd` on Windows PowerShell)
```

- Tests run against an **in-memory** SQLite DB (pinned in `vitest.config.ts`
  `test.env`); they never touch `backend/data/`. The env fix matters: an early
  setup-file hack was defeated by ESM hoisting and silently ran tests against
  the dev `factory.db`.
- Frontend has no test suite (typecheck + build only).

## Run (local dev)

```bash
# terminal 1 — backend (API on http://127.0.0.1:8787)
cd backend
npm run dev          # tsx src/index.ts

# terminal 2 — frontend (Control Center on http://127.0.0.1:5173)
cd frontend
npm run dev
```

## Health checks

- Backend: `GET http://127.0.0.1:8787/api/dashboard` -> 200 JSON with job
  counts. Also `GET /api/pipelines` shows the active 8-step pipeline
  (…Assembly -> QA -> Publisher), and `GET /api/analytics` returns the
  internal KPI set (cost/tokens per agent, QA pass rate, publish + content
  status, mean pipeline duration) — analytic is cross-content, not a pipeline
  step.
- Frontend: open `http://127.0.0.1:5173` — header shows "API online" when the
  backend is reachable.
- OmniRoute: `GET http://127.0.0.1:20128/v1/models` (200).
- On Windows PowerShell, `GET` probes need `-UseBasicParsing` (or
  `Invoke-RestMethod -UseBasicParsing` is fine).

## Useful commands / flows

- `npm run cli` in backend — CLI driver (pre-UI; rarely used post-Phase 2).
- API pipeline flow: `POST /api/content` -> `POST /api/pipeline/{id}/start` ->
  `POST /api/jobs/run` repeatedly; creative steps (research/script/director)
  halt at approval gates -> `POST /api/approvals/{id}/decide`.
- `PUT /api/pipelines/{id}/steps/{agent}` — per-step mode/gate config.

## Git

- **Strategy: trunk-based on `main`.** Single branch, no `develop`/`release`.
  Feature/phase commits land directly on `main` (see `git log` — AICF-00x
  commits). PR target = `main`. Remote: `origin` ->
  `https://github.com/kossto82-ops/AI-CONTENT-FACTORY`.
- **Commit message convention (Rule 16):** `TICKET: description` — e.g.
  `AICF-008: AICF-008-video-assembly - Video Assembly Agent (...)`.
- Keep `backend/data/`, `backend/assets/`, `Skills/` and `.env` out of commits
  (`.gitignore` covers data/assets/env; add `Skills/` explicitly if it starts
  showing in `git status`).

## CI/CD

- **No CI/CD documented** — the `jenkins` MCP is not connected/available in the
  dev tooling for this repo, so no build/deploy jobs are recorded.
  Re-run the dev-runbook flow with the `jenkins` MCP enabled to document jobs.

## Environment flags (stub/real toggle — CRITICAL)

| Flag | Default | Effect |
|------|---------|--------|
| `OMNIROUTE_TTS_STUB=1` | live | Use deterministic local WAV instead of live TTS. **REQUIRED for E2E**: the NVIDIA TTS NIM (`nvidia/fastpitch`) upstream is DOWN. |
| `OMNIROUTE_VIDEO_STUB=1` | stub | Use deterministic animated-GIF clips. **Live veo/seedance is UNPROVEN** (all 4 models time out; see Troubleshooting). Set `=0` to try live. |
| `OMNIROUTE_QA_STUB=1` | stub | QA Agent runs deterministic checks only (technical + plan-consistency); model/vision rows show as un-checked (`null`). **Live vision UNPROVEN** — OmniRoute :20128 down; set `=0` to try live plan review + vision review. |
| _(Publisher)_ | determinist | Phase 9 Publisher needs **no gateway and no flag** — it derives a `publish_package` (metadata) locally. Publication is logical (`LocalExport`), no upload. Scheduling = a `scheduledAt` field, no runner. |
| _(Analytics)_ | determinist | Phase 10 Analytics needs **no gateway and no flag** — `GET /api/analytics` aggregates internal KPIs deterministically (`computeAnalytics`, pure function). Not a pipeline step. |
| _(Learning)_ | determinist | Phase 11 Learning needs **no gateway and no flag** — `GET /api/learning` derives lessons/ideas/recommendations deterministically (`computeLearning`, pure; D-19). Not a pipeline step; embeddings upgrade deferred. |
| `OMNIROUTE_URL` | `http://127.0.0.1:20128` | Gateway base. |
| `FACTORY_DB` | `./data/factory.db` | SQLite path (e.g. `./data/fase7-test.db` for a fresh E2E DB). |

To run a full E2E deterministically: set `FACTORY_DB=./data/faseN-test.db`,
`OMNIROUTE_TTS_STUB=1` (leave video on stub), start backend, run the API flow
above. Reset the port first if a previous dev server still listens on :8787.

## Troubleshooting

| Symptom | Cause / Fix |
|---------|-------------|
| `npm.ps1` not recognized / blocked | PowerShell ExecutionPolicy Restricted → use `npm.cmd`. |
| Dashboard shows "API offline" | Backend not running; start `npm run dev` in `backend/`. CORS is open (`*`). |
| Voice job `OmniRoute audio error: 404` | TTS NIM down → set `OMNIROUTE_TTS_STUB=1`. |
| Video/assembly clips are gray GIF bands | Stub mode (expected placeholder). Live modes time out — `veo-free/veo` >240s, other 3 models >150s each (2026-09-01). The live path fails cleanly after 120s, retryable. |
| QA verdict shows `—` on Visual/Coherence/Appropriate rows | `OMNIROUTE_QA_STUB=1` (default): model-driven checks are skipped and left un-checked (`null`) — expected; deterministic rows are green. Set `=0` for live model review. |
| Tests hit stale pipeline steps | Tests use in-memory DB (fixed); check `backend/data/*.db` for stale `pipeline_brain` — reconciled on load (missing steps auto-injected). |
| Port 8787 busy after a crash | `Get-NetTCPConnection -LocalPort 8787 -State Listen` → kill owning PID. |
| DB lock / WAL files linger | SQLite WAL — stop the server before deleting `*.db*` files. |