# AI Content Factory — Technical Decisions

Each decision: decision, alternatives, reason, trade-offs. Nothing arbitrary.

---

## D-01 — Monorepo, one backend service

- **Decision**: Single Node/TypeScript backend (API + Orchestrator + Model
  Gateway in one process) for MVP.
- **Alternatives**: microservices-per-agent; separate orchestrator service.
- **Reason**: Agents share a tiny codebase and the store; the value is
  orchestration correctness, not process isolation. Simplicity + maintainability.
- **Trade-offs**: no independent scaling/hard failure isolation per agent; fine
  at MVP scale, and the job store already gives durability if we split later.
- **Reversibility**: low — easy to split the Orchestrator out later because
  jobs/states are already persisted externally.

## D-02 — Node + TypeScript (not Python, not Java)

- **Decision**: Backend in Node + TypeScript.
- **Alternatives**: Python 3.14 (great AI ecosystem), Java/Spring (heavy).
- **Reason**: Environment already has Node 26; TS gives type safety for the
  strict agent output schemas; one language across backend and frontend reduces
  context switching; FFmpeg orchestration (later) is fine from Node.
- **Trade-offs**: Python has stronger prebuilt AI libs; but our AI calls route
  through OmniRoute's HTTP API anyway, so we don't need Python's ecosystem.
- **Reversibility**: high.

## D-03 — SQLite for the store (MVP)

- **Decision**: SQLite via Node's built-in `node:sqlite` (`DatabaseSync`), no
  ORM, thin repository layer.
- **Alternatives**: PostgreSQL, MongoDB, MySQL, JSON-files, better-sqlite3.
- **Reason**: Nothing DB is installed; SQLite is a single file, transactional,
  WAL, zero-ops — perfect for a control-plane state store. Avoids installing a
  DB server ("nothing unnecessary"). `node:sqlite` is built into Node 22+ (we're
  on 26) → **zero native npm deps** and no install step.
- **Trade-offs**: single-writer (fine for orchestrator), less ideal for heavy
  concurrent analytics (later concern).
- **Reversibility**: medium-high — a thin repository layer makes swapping to
  Postgres contained.

## D-04 — Model Gateway as a live OmniRoute client + task routing

- **Decision**: The Model Gateway is a thin adapter over the already-running
  OmniRoute instance (`http://127.0.0.1:20128`, Anthropic-compatible). Task
  routing uses OmniRoute's task combos (`auto/best-*`, `auto/cheap`,
  `auto/free`, `auto/vision`, `auto/offline`, etc.).
- **Alternatives**: direct per-provider SDKs; custom router.
- **Reason**: OmniRoute IS already a model gateway + router. Reusing it delivers
  routing/cost/failover/free-tier essentially for free and directly honors
  "provider independence" and "change model without touching agent code".
- **Trade-offs**: depends on OmniRoute running; mitigations: failover adapter,
  config-driver routing, and the Gateway contract isolates us.
- **Reversibility**: high — a second adapter (FreeLLM or direct) can be added.

## D-05 — Agent/Provider decoupling via adapters

- **Decision**: Every external capability (LLM text, vision, voice, video,
  embeddings) sits behind a provider adapter; agents only call the Gateway's
  conceptual interface.
- **Alternatives**: agents calling providers directly.
- **Reason**: Section 25 / D-25 mandate: if OmniRoute or any provider/model/voice
  vendor disappears, swap the adapter, not the agent. Verifiable today in the
  environment (OmniRoute even lists multiple voice, video, vision, embedding
  providers we can route across).
- **Trade-offs**: a thin indirection layer; worth it for the stated goal.
- **Reversibility**: high (by design).

## D-06 — In-process event bus (MVP), no external broker

- **Decision**: Simple in-process pub/sub for events
  (content.created, job.started/completed/failed, approval.*, etc.).
- **Alternatives**: RabbitMQ / Kafka / NATS from day one.
- **Reason**: Section 16 warns against needless infra. MVP has one process; an
  external broker only adds value with multiple services or heavy async fan-out.
- **Trade-offs**: events lost on crash (acceptable; state is in the store, events
  are derived/notifications). Swap path: emit to a broker later behind the same
  interface.
- **Reversibility**: high.

## D-07 — Frontend Vite + React + Tailwind v4 (CONFIRMED)

- **Decision**: Vite + React 19 + Tailwind v4 (via `@tailwindcss/vite`), plain
  component primitives, "AI ops center" aesthetic, dark, dense, status-first.
  Dev server proxies `/api` -> backend :8787.
- **Alternatives**: Next.js (server-rendered), separate SPA, plain HTML.
- **Reason**: User confirmed Vite+React over Next.js. Fast Vite HMR, zero SSR
  complexity for an operator dashboard, and the API is already a separate
  service so there is no need for server rendering. Tailwind v4 is CSS-first
  (no config file needed).
- **Trade-offs**: frontend adds surface; but the Control Center is the product's
  core UX so it is not optional.
- **Reversibility**: medium (UI framework swap cost is contained behind the API).

## D-08 — Cost accounting at the Gateway (single choke point)

- **Decision**: All token/request/cost/model/provider accounting in the Model
  Gateway; persisted per Job and roll-up-able per Content.
- **Alternatives**: scattered per-agent accounting.
- **Reason**: Section 12/17 need "cost of a Short" and per-job usage. One
  choke point guarantees completeness.
- **Trade-offs**: Gateway must stay the only LLM caller (enforced).
- **Reversibility**: high.

## D-09 — Human-in-the-loop approval gates as first-class workflow objects

- **Decision**: Approval is a typed entity (target, outcome, actor, timestamp),
  checked by the Orchestrator between steps depending on mode.
- **Alternatives**: ad-hoc boolean flags scattered in agent code.
- **Reason**: Sections 7/8/21 center the product on controlled approval; central
  approval objects keep state transitions a single source of truth.
- **Trade-offs**: a small schema + logic cost now; prevents state drift later.
- **Reversibility**: medium.

## D-10 — Pipelines as data, not code

- **Decision**: Pipeline definitions (ordered steps, per-step mode, gates,
  retry policy) are stored data interpreted by the Orchestrator.
- **Alternatives**: hardcoded pipeline chains.
- **Reason**: Lets operators add/disable steps, change modes and gates without
  redeploying; aligns with "don't create agents by fashion" — only add steps
  with real responsibility.
- **Trade-offs**: requires a pipeline editor/schema and validation.
- **Status**: IMPLEMENTED (Phase 3, `AICF-003`) — `pipelineStore` persists the
  definition in the `pipeline` table; per-step `mode` + `requiresApproval`
  editable via `PUT /api/pipelines/:id/steps/:agent`; MANUAL steps run via
  `POST /api/jobs/:id/run`. E2E-verified (MANUAL script step stayed READY,
  explicit run completed it).
- **Reversibility**: medium.

---

## Environment findings feeding decisions

- Running: **OmniRoute** at `http://127.0.0.1:20128` — task combos + 400+ models
  incl. video (veo/seedance), image (FLUX), voice (fastpitch/tacotron2), ASR,
  embeddings, local ollama — a ready gateway/router. (Verified live.)
- **FreeLLM**: not found locally; user-confirmed "available" – flag for
  confirmation before building its adapter.
- Node 26 / Python 3.14 / Git present; npm works via `.cmd` (PS1 shim blocked by
  Restricted policy).
- NOT installed: Docker, Java, ffmpeg, SQL/NoSQL engine, sqlite3 CLI, pnpm.
- Browsers (Chrome/Edge) present → future E2E.

## Explicitly NOT needed (no overengineering)

- No external message broker for MVP
- No containerization for MVP (no Docker installed; single local process)
- No Kubernetes / cloud orchestration
- No separate database server (SQLite suffices)
- No Python microservice
- No SSR/SSO/IDP beyond a simple auth gate
- No separate analytics store yet
