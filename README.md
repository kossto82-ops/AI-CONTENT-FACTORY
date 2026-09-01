# AI Content Factory

Controlled, multi-agent platform for producing short-form vertical video
(YouTube Shorts / Reels). Built "brain-first": orchestration works before any
video rendering.

## Docs

| Doc | Purpose |
|-----|---------|
| `ARCHITECTURE.md` | Components, layers, data flow, model gateway, orchestration |
| `PRODUCT.md` | Vision, users, agents, pipelines, HITL, lifecycle |
| `DECISIONS.md` | Technical decisions + trade-offs; what we deliberately do NOT need |
| `ROADMAP.md` | Phase 0..11 plan (Phases 1-3 done; Phase 4: Director revision loop; Phase 5: Visual Agent) |

## Stack (MVP)

- Node + TypeScript (backend, one service: API + Orchestrator + Model Gateway)
- SQLite via Node's built-in `node:sqlite` (no DB server, no native deps)
- Model Gateway = thin adapter over the local **OmniRoute** gateway
  (`http://127.0.0.1:20128`), task-based routing, cost accounting
- Frontend Control Center: Vite + React + Tailwind v4 (Dashboard / Pipeline /
  Agents / Content / Approvals)

## Run

```bash
# backend (API on :8787) — terminal 1
cd backend
cp .env.example .env    # adjust OMNIROUTE_URL / FACTORY_DB
npm install
npm run dev             # or: npm run cli -- help

# frontend (Control Center on :5173) — terminal 2
cd frontend
npm install
npm run dev             # proxies /api -> http://127.0.0.1:8787
```

OmniRoute must be reachable. Default tasks route to `auto/*` combos.

## Brain-first pipeline

```
Research -> [APPROVE ideas] -> Script -> [APPROVE] -> Director -> [APPROVE] -> Visual -> Voice -> QA
```

Each creative step halts for human approval (SEMI-AUTOMATIC); Visual, Voice and
QA run AUTOMATIC. Jobs, approvals, artifacts and cost are persisted and
recoverable.

## Visual Agent (Phase 5)

After the plan is approved, the **Visual Agent** generates one vertical
(`768x1344`) still per scene using FLUX (`flux.2-klein-4b`) through OmniRoute's
OpenAI-compatible Images API. Images are saved to `backend/assets/{contentId}/`
(gitignored), a JSON `assets` manifest is persisted as an artifact, and files are
served at `GET /api/assets/{contentId}/{file}`. The Content tab renders scene
thumbnails.

## Voice Agent (Phase 6)

After Visual, the **Voice Agent** synthesizes one narration clip per scene from
the ProductionPlan (`narration` text) via OmniRoute's OpenAI-compatible
`POST /v1/audio/speech` (model `nvidia/fastpitch`, voice
`Magpie-Multilingual.EN-US.Aria`, WAV). Files live under
`backend/assets/{contentId}/audio/` (gitignored), a JSON `voice` manifest is
persisted as an artifact, and clips are served at
`GET /api/assets/{contentId}/audio/{file}` with playback controls in the Content
tab.

> **Live TTS status:** the NVIDIA TTS NIM upstream is currently unavailable, so
> neural TTS synthesis is UNPROVEN. Set `OMNIROUTE_TTS_STUB=1` to run the
> pipeline with a locally synthesized (sine) WAV and verify the full
> file/write/serve/UI path. The `nvidia/fastpitch` → `POST /v1/audio/speech`
> contract is verified against OmniRoute's docs.

## Execution modes (per step)

Each pipeline step can be set to **AUTOMATIC** / **SEMI_AUTOMATIC** / **MANUAL**
plus an approval-gate toggle from the **Pipeline** tab. Config persists in the
`pipeline` table; MANUAL steps stay `READY` until you run them explicitly (▶ Run
button on the Dashboard). `PUT /api/pipelines/:id/steps/:agent` changes mode/gate;
`POST /api/jobs/:id/run` runs a READY job explicitly.

## QA rejection → revise loop (Phase 4)

When the latest QA verdict is `rejected`, the content becomes **revisable** (if a
plan exists). `POST /api/content/:id/revise/director` re-runs the Director with
the QA issues (`{ script, revision: { issues, previousPlan } }`), producing
`production_plan` v2+ → plan gate → QA v2. The Content tab shows the verdict +
a **Revise plan** action. The guard returns `400` if the latest QA is approved.

## Tests / build

```bash
cd backend
npm test          # unit tests (vitest)
npm run typecheck # tsc --noEmit
npm run build     # tsc emit

cd ../frontend
npm run typecheck # tsc --noEmit
npm run build     # vite build
```
