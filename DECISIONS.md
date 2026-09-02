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

## D-14 — Assembly = reproducible composition DATA (no muxer in MVP; no-ffmpeg)

- **Decision**: There is no ffmpeg in this environment (Phase 0 audit), so the
  Video Assembly Agent (Phase 7) produces a **reproducible composition**: a JSON
  `FinalVideoManifest` (Decision D-12/D-13 pattern — DB stays JSON-only, binaries
  on disk) that is an exact timeline (per-scene cue windows summing to the plan
  total, layer references to visual/voice/clip files), plus a `subtitles.vtt`
  track and poster; the Control Center renders it in-browser. A real muxed MP4
  (export) is explicitly deferred to a future render backend (Remotion/ffmpeg).
- **Alternatives**: shelling out to ffmpeg to concat clips (not installed; would
  block the phase on a non-MVP tool), or storing a rendered MP4 blob
  (non-reproducible, not JSON-servable).
- **Reason**: "final video (reproducible)" per PRODUCT.md is satisfied as
  composition-data + per-scene clips (GIF/MP4/WebM) + caption + poster; every
  artifact is deterministic given the same plan+assets+voice inputs, so the
  output is verifiable bit-for-bit (unit-tested).
- **Trade-offs**: no single downloadable .mp4 in the MVP; the player composes
  clips/images/audio; export is a follow-up. The scene->file index stays
  queryable and the whole pipeline/file-write/serve/UI path is exercisable.
- **Status**: IMPLEMENTED (Phase 7, `AICF-008`) — `gateway/video.ts`, `assembly`
  agent, `video` artifact, `GET /api/assets/{contentId}/assembly/{file}`, UI
  preview player. E2E-verified with stub clips (fresh DB, full brain-first
  pipeline -> assembly -> QA): 4 CLI-like scenes, 30s normalized timeline, 4
  animated-GIF clips (GIF89a, ~216KB), `subtitles.vtt` (text/vtt), poster served.
- **Reversibility**: high.

## D-15 — Video = fourth gateway channel (OpenAI-style /v1/videos/generations); honest stub default

- **Decision**: Video clip generation uses OmniRoute's OpenAI-compatible video
  channel (`POST /v1/videos/generations`, `{model, prompt, n, size}` →
  `data[0].b64_json`/`url`), defaulting to the `veo-free/veo` model (VEO 3.1,
  verified in the live video-model catalog). Same pattern as D-13: the channel
  **defaults to `OMNIROUTE_VIDEO_STUB` = on**, producing a deterministic,
  browser-playable animated GIF per scene (pure-Node GIF89a encoder with a
  non-compressing LZW stream), and calls the real gateway only when the operator
  opts in with `OMNIROUTE_VIDEO_STUB=0`.
- **Alternatives**: forcing video through image/text channels (impossible —
  different response shape), or always-live (live veo/seedance generations are
  queued and slow — probes timed out, see Status).
- **Reason**: identical honesty to D-13 — pipeline wiring, file writes, serving,
  and the UI player must stay E2E-verifiable without burning minutes per clip on
  a flaky upstream. Live MP4/WebM output is **UNPROVEN** until the upstream
  proves stable.
- **Trade-offs**: an extra channel + a local stub generator; stub clips are
  motion-band GIFs, not neural video (acceptable placeholder for the phase
  goal — a reproducible, downloadable-and-playable clip layer).
- **Status**: IMPLEMENTED (Phase 7, `AICF-008`) — `gateway/video.ts`,
  `buildStubClip`/`gifLzwEncode`, assembly wiring. Pipeline E2E-verified with
  stub GIFs. **Live probes (2026-09-01):** `veo-free/veo` did not return within
  240s; `veo-free/seedance`, `veoaifree-web/veo`, `veoaifree-web/seedance` each
  did not return within 150s — all four video models in the live catalog
  (`GET /v1/models` and `GET /v1/videos/generations`) hang, same class as the
  TTS NIM. The live path therefore has a hard 120s timeout that fails the job
  cleanly (retryable) instead of hanging the pipeline; live generation stays
  gated behind `OMNIROUTE_VIDEO_STUB=0` until the upstream answers.
- **Reversibility**: high.

---

## D-16 — QA vision = fifth gateway channel (Anthropic-style /v1/messages image blocks); honest stub default

- **Decision**: Visual/coherence/appropriateness QA runs through a new vision
  gateway channel (`POST /v1/messages`, `content:[{type:'image',
  source:{type:'base64', ...}}]` — Anthropic message format, the shape the
  upstream router accepts for image input, model `auto/vision`), reading the
  real still-images from the content asset dir. **Defaults to `OMNIROUTE_QA_STUB`
  = on**: with the stub, the QA Agent runs only deterministic checks (duration,
  resolution, vertical 9:16, audio presence, subtitles, clip files, timeline
  continuity, plan-internal structure/coherence/metadata) and the verdict is
  marked technical-only. With `OMNIROUTE_QA_STUB=0` the same agent adds a live
  plan review (`quality.review`) and a live vision review of the stills, gated
  on the gateway being up.
- **Alternatives**: forcing vision QA through the text-only channels (cannot see
  the pixels — the whole point), or always-live (the gateway is currently down,
  see Status — the phase would be unhittable).
- **Reason**: identical honesty to D-15/D-13 — pipeline wiring, file reads,
  verdict persistence, and the UI checklist must stay E2E-verifiable without a
  live upstream. The stub preserves the exact output contract (issues +
  checklist), so switching to a live model is purely a config flip.
- **Trade-offs**: a second message-shaped channel + `auto/vision` model tier;
  stub mode leaves the model-only checklist rows (`visuals_clean`, `coherence_ok`,
  `appropriateness_ok`) and the plan/vision review scope marked as unchecked
  (`null`), which the UI renders as "—". QaIssue gains `location`,
  `suggestedFix`, `autoFixable` so a rejected verdict can feed future revise
  loops (Phase 9/10).
- **Status**: IMPLEMENTED (Phase 8, `AICF-009`) — `gateway/vision.ts`,
  `agents/qa.ts` (stub + live wiring), Orchestrator feeds `video`/`assets`/
  `voice`/plan. Pipeline E2E-verified with the stub over a real assembled video
  (`approved`, score 1.0). **Live vision UNPROVEN (2026-09-01):** OmniRoute
  :20128 is DOWN (TCP probe failed, `ECONNREFUSED`; the model catalog with
  `capabilities.vision` models such as `claude-opus-4-8-xhigh` was captured
  before the outage). The live path fails the job cleanly (retryable) instead
  of hanging; it stays gated behind `OMNIROUTE_QA_STUB=0`.
- **Reversibility**: high.

---

## D-17 — Publication is logical/reflected (a `publish_package` artifact); scheduling is metadata-only

- **Decision**: Phase 9's Publisher makes publishing **logical, not real**. With
  no ffmpeg, hosting, or platform account (see D-14 — the "video" is composition
  DATA), the publisher does **not upload anywhere**. Instead it derives rich
  publish metadata from the ProductionPlan — `title` (≤100), `description`
  (≤500: hook + scene count + duration), `hashtags` (≤3, dedup, `['story']`
  fallback), web-accessibility `accessibilityLabel`, and `thumbnailUri` (the
  assembly poster via `/api/assets/{contentId}/poster.png`) — into a single
  `publish_package` artifact declaring `status: PUBLISHED|SCHEDULED`, `target`
  (`LocalExport` default), `scheduledAt`, `publishedAt`, `version`.
- **Scheduling is a field, not a worker.** `ContentStatus` gains `SCHEDULED`
  (after `PUBLISHED` in `CONTENT_ORDER`); a `scheduledAt` (ISO) can be set via
  `PUT /api/content/:id/schedule`, is picked up by `buildInput('publisher')`
  from content `meta`, and is mirrored back to `meta.publishStatus` +
  `scheduledAt`. There is deliberately **no timer/runner that executes
  scheduled publication** — reflecting the "no real upload" boundary.
- **Alternatives**: real API upload (impossible — no platform/hosting, D-14), or
  a scheduler/worker that "publishes" later (over-engineering; nothing executes
  a logical publish in MVP).
- **Reason**: keeps publish an optional, disableable 8th pipeline step with an
  honest contract, E2E-verifiable without external infrastructure.
- **Trade-offs**: `status`/`scheduledAt` are logical intent; a future Phase
  would swap the resolver for a real upload. The `publication` approval gate
  (like the other gates) advances content optimistically then holds the job at
  WAITING_APPROVAL until approved.
- **Status**: IMPLEMENTED (Phase 9, `AICF-010`). Publisher is deterministic (no
  gateway). E2E-verified through the real orchestrator: immediate → content
  `PUBLISHED` (`publishedAt` set, `meta.publishStatus=PUBLISHED`); scheduled →
  content `SCHEDULED` (`scheduledAt` set).
- **Reversibility**: high.

---

## D-18 — Analytics = deterministic internal KPIs (no gateway, no pipeline step)

- **Decision**: the Phase 10 Analytics Agent aggregates **operational** signals
  the system already records — per-agent cost/usage/runs (from `job` +
  `execution`), QA verdicts (from `qa` artifacts: score, pass/reject, issue
  categories), publish status (from `publish_package` artifacts), content-status
  distribution, and mean end-to-end pipeline duration. It is a **pure,
  deterministic function** (`computeAnalytics(input)` in
  `backend/src/agents/analytics.ts`): the server owns the SQL reads and passes
  raw aggregated rows in; the agent never touches the DB or the gateway.
- **Alternatives**: (a) an LLM-written narrative report over the numbers —
  rejected because there is no external engagement data (D-17 makes publishing
  logical), so a "performance analysis" by a model would be invented signal, not
  signal; (b) a dashboard-only quotient view — half; the agent shape is kept so
  it can feed the Phase 11 Learning Agent as a first-class callable.
- **Reason**: internal signals ARE the only real "performance" here; a
  deterministic aggregator is honest, free, offline-testable, and idempotent.
  Feeds Learning (Phase 11) without coupling to a live model.
- **Trade-offs**: analytics is **not** a per-content pipeline step (it
  aggregates across ALL contents), so it has no job, no artifact, no approval —
  it appears in the agent registry (mode AUTOMATIC) and is served live by
  `GET /api/analytics`. `stageFor`/`defaultArtifactKind` return `ANALYZED` /
  `undefined` for it (unreachable paths, documented).
- **Status**: IMPLEMENTED (Phase 10, `AICF-011`). 8 hermetic unit tests +
  E2E over the real HTTP server: 10 seeded jobs → correct totals/cost/QA/publish/
  pipeline KPIs.
- **Reversibility**: high.

---

## D-19 — Learning v1 = deterministic (no LLM/embeddings; internal signals only)

- **Decision**: the Phase 11 Learning Agent starts as a **pure, deterministic
  function** (`computeLearning(input)` in `backend/src/agents/learning.ts`) that
  reuses `computeAnalytics` for the KPI signal and derives three outputs:
  **lessons** (patterns over cost/QA/throughput/publish), **ideas** (up to 4
  deterministic variations of QA-approved `production_plan` artifacts,
  validated against the pipeline's `ideaSchema`), and **recommendations**
  (tier re-routing, QA-category fixes, pipeline parallelization, gate checks).
  The server owns the SQL reads; `GET /api/learning` persists the set
  atomically in a `learning` table (replace semantics).
- **Context**: OmniRoute exposes embedding models (bge-m3 / mistral-embed /
  nv-embedqa), but the backend has **no embedding client yet**, and a
  semantic-memory layer was the risky part of the phase. A callable offline
  learner that only trusts the internal record (D-17/D-18) is the honest first
  step — no invented "performance insight", fully hermetic-testable.
- **Alternatives**: (a) embedding-based semantic memory now — rejected: no
  client exists, adds a live dependency and non-determinism before the mechanics
  are proven; (b) LLM-written lessons — rejected per D-18 reasoning (invented
  signal). Embeddings stay the documented upgrade path (`D-19a` if adopted).
- **Shape consequences**: like Analytics, Learning is **not** a pipeline step —
  `stageFor` → `ANALYZED`, `defaultArtifactKind` → `undefined`,
  `defaultApprovalKind` → `publication` (unreachable), registry mode AUTOMATIC.
  It is served live and has no job/artifact/approval per content.
- **Status**: IMPLEMENTED (Phase 11, `AICF-012`). 7 hermetic unit tests;
  suite green (10 files, 85 tests). E2E via real HTTP server on a fresh DB.
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
