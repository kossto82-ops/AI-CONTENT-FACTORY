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

## D-11 — QA rejection rolls the Director back (revise loop)

- **Decision**: On a `rejected` QA verdict, the content stays revisable and the
  operator can re-run the Director with the QA issues as context, producing a
  new plan version that QA re-evaluates. Revising is an explicit, gated action,
  never an automatic redo.
- **Alternatives**: auto-retry the plan without a human gate (undisciplined,
  cost-drift) vs. dead-ending on rejection (no rollback path).
- **Reason**: closes the Phase 4 gap — a rejected plan previously stranded the
  content in `QA` status with no way forward. Reusing the normal job drain keeps
  the director -> plan gate -> QA v2 chain and per-version retention.
- **Trade-offs**: an extra endpoint + input override in `touchStep`; QA may
  reject repeatedly (real model variability), so iteration cost is visible.
- **Status**: IMPLEMENTED (Phase 4, `AICF-004`) — `POST
  /api/content/:id/revise/director` re-runs the Director with
  `{ script, revision: { issues, previousPlan } }`; content list exposes
  `latestQa` + `revisable`; the UI shows the verdict banner + "Revise plan".
  E2E-verified (rejected plan -> revision -> production_plan v2 -> QA v2; guard
  returns 400 when the latest QA is approved).
- **Reversibility**: high (a revision just adds another job/artifact version).

## D-12 — Images are a separate gateway channel; binaries live on disk

- **Decision**: Image generation uses a dedicated OmniRoute channel
  (`POST /v1/images/generations`, OpenAI Images shape, inline `b64_json`) rather
  than the text channel. Generated binaries are written to
  `backend/assets/{contentId}/` (gitignored); only a JSON `assets` manifest
  (scene -> file/mime/bytes) is persisted as the artifact and served via a
  path-guarded static route.
- **Alternatives**: forcing images through the text gateway (impossible — different
  response shape), or storing base64 in the artifact payload (bloats the DB, not
  JSON-servable).
- **Reason**: the DB stays JSON-only and diffable; binaries are cheap on disk and
  replaceable; the manifest keeps the scene->file index queryable. Cost is
  per-image (flat ≈€0.002), tracked on the visual job.
- **Trade-offs**: an extra channel/decoder + disk storage + a static route; files
  are machine-local (fine for MVP, packaging/deploy concern later).
- **Status**: IMPLEMENTED (Phase 5, `AICF-006`) — `gateway/image.ts`, `visual`
  agent, `assets` artifact, `GET /api/assets/{contentId}/{file}`. E2E-verified: a
  full pipeline produced 4 real JPEGs (FF D8 FF magic, 194-230KB), served over the
  UI proxy; traversal blocked.
- **Reversibility**: high.

## D-13 — Voice = third gateway channel (OpenAI-style /v1/audio/speech); honest stub for offline E2E

- **Decision**: TTS uses OmniRoute's OpenAI-compatible audio channel
  (`POST /v1/audio/speech`, `{model, input, voice, format}` → raw audio body),
  not the text channel. The Voice Agent writes per-scene narration WAVs to
  `backend/assets/{contentId}/audio/` and persists a JSON `voice` manifest;
  served at `GET /api/assets/{contentId}/audio/{file}` (same guarded route).
- **Alternatives**: forcing speech through text/chat channels (impossible —
  response is binary audio). Multi-character voices deferred (narration-first
  MVP).
- **Reason**: same pattern as D-12 (JSON-only DB, disk-hosted binaries), and it
  keeps "provider-swappable" trivially true (Decision D-25 adapter).
- **Trade-offs**: a third channel + disk storage + a static subdir; files are
  machine-local. **Known env blocker**: the NVIDIA TTS NIM backing
  `nvidia/fastpitch` is down (no port :9000, no Docker to host it), so live TTS
  synthesis is **UNPROVEN**; `OMNIROUTE_TTS_STUB=1` synthesizes a playable local
  WAV to exercise the full pipeline/file/serve/UI path in E2E. The call contract
  itself is verified against OmniRoute docs + probes.
- **Status**: IMPLEMENTED (Phase 6, `AICF-007`) — `gateway/audio.ts`, `voice`
  agent, `voice` artifact, frontend `<audio>` players. Pipeline E2E-verified with
  stub WAV (valid RIFF/WAVE 22050Hz 16-bit; served `audio/wav`); **live neural
  TTS pending the NVIDIA NIM upstream**.
- **Reversibility**: high.

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
