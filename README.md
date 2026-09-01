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
| `ROADMAP.md` | Phase 0..11 plan (Phase 1 Foundation done; Phase 2 Control Center done) |

## Stack (MVP)

- Node + TypeScript (backend, one service: API + Orchestrator + Model Gateway)
- SQLite via Node's built-in `node:sqlite` (no DB server, no native deps)
- Model Gateway = thin adapter over the local **OmniRoute** gateway
  (`http://127.0.0.1:20128`), task-based routing, cost accounting
- Frontend Control Center: Vite + React + Tailwind v4 (Dashboard / Agents /
  Content / Approvals)

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
Research -> [APPROVE ideas] -> Script -> [APPROVE] -> Director -> [APPROVE] -> QA
```

Each creative step halts for human approval (SEMI-AUTOMATIC); QA runs
AUTOMATIC. Jobs, approvals, artifacts and cost are persisted and recoverable.

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
