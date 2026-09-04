# OpenMontage Architectural Audit & Combined Comparison

Status: AUDIT (2026-09-04). Investigative review of **both** `AI-CONTENT-FACTORY`
(our prototype) and `OpenMontage` (the reference architecture), produced before
any re-architecture work. This document is the record of Phases 3 + 4: the
area-by-area comparison table, the component KEEP/IMPROVE/REPLACE/REMOVE
classification, and the explicit list of the top 10 architectural weaknesses of
the current prototype.

Companion docs:
- `docs/TARGET_ARCHITECTURE.md` — the redesigned production architecture.
- `docs/MIGRATION_PLAN.md` — the staged, incremental migration path.

---

## 1. What each system is

**AI-CONTENT-FACTORY (ours).** A Node + TypeScript monorepo. Backend = one
service (API + Orchestrator + Agents + Model Gateway) backed by SQLite
(`node:sqlite`); frontend = a Vite + React + Tailwind v4 Control Center. The
Orchestrator drives a **code-defined** pipeline of typed agents
(`research → script → director → visual → voice → assembly → render → qa →
publisher`), each an `AgentRunner` in `backend/src/agents/registry.ts` that
calls a Model Gateway which routes a conceptual *task* to an OmniRoute combo
(`backend/src/gateway/router.ts`). The design is **"brain-first"** (orchestration
correct before rendering) and **deterministic/recoverable** (persisted jobs,
state-machine transitions, human approval gates).

**OpenMontage (reference).** A Python + React/Remotion system that is
**instruction-driven and agent-first**. The "orchestrator" is the LLM agent
itself, which reads declarative pipeline manifests (`pipeline_defs/*.yaml`) and
Markdown director skills (`skills/pipelines/.../*.md`), and calls a library of
**self-describing tools** for concrete capabilities. Python is deliberately
reduced to "tools + checkpoints / persistence" — *no* orchestration or creative
logic lives in code. Media is produced through a Remotion template runtime
(`remotion-composer/`) and provider selectors (`tools/*/xxx_selector.py`).

---

## 2. Area-by-area comparison

| Area | Current Factory | OpenMontage | Better Approach |
|------|-----------------|-------------|-----------------|
| Pipeline architecture | Code-defined `DEFAULT_PIPELINE` + persisted `pipelineStore`, interpreted by a stateful `Orchestrator` | Declarative YAML manifests per format; the agent reads them; stages carry `produces`, `human_approval_default`, budgets, hard limits | Manifest-driven pipeline **schema-validated**, with per-format definitions (educational, storybook, sing-along, quiz) AND hard execution limits (revisions/send-backs/wall-time) |
| Agent architecture | Thin typed `AgentRunner` shells; orchestrator drives deterministically | Stateless **stage directors** wrapped by a stateful **Executive Producer** (cumulative state: budget, style anchors, revision counts); wrap-not-replace; rejection → SEND_BACK to a prior stage | Keep our typed orchestrator for deterministic control, ADOPT the EP-wrap-director pattern + SEND_BACK with per-stage-pair limits to fix pacing/continuity across stages |
| Skills | `Skills/*/SKILL.md` — static content conventions per agent (content-research, script, director, visual, voice, assembly, qa, publisher) | **3-layer knowledge**: Layer 1 tool registry, Layer 2 project conventions + stage-director skills, Layer 3 `.agents/skills/` vendor knowledge; `agent_skills[]` links tool→vendor skill; mandated read-order | Adopt the 3-layer model: Layer 2 = our channel/format + child-safety conventions; Layer 3 = provider/vendor knowledge. Link via the tool contract |
| Tools | None (capabilities are baked into each agent + gateway `router.ts`); agents call gateway directly | **Uniform self-describing `ToolContract`** (`BaseTool`): name, capability, provider, tier, runtime (local/local_gpu/api/hybrid), determinism, cost estimate, fallback, `agent_skills`, idempotency; registry auto-discovers | Introduce a **ToolContract + registry**; media generation (image/video/voice/music/compose/analyze) become deterministic tools the agents orchestrate |
| Provider abstraction | Model Gateway routes *text* tasks to OmniRoute combos; image/audio/video/vision are separate hardcoded channels (`gateway/image.ts`, `audio.ts`, `video.ts`, `vision.ts`); provider string is hardcoded per agent | **Selector → provider** two-tier routing: `tts_selector`/`image_selector`/`video_selector` auto-discover providers by capability; weighted scoring (task_fit/quality/cost/latency); `PREFERRED_PROVIDER_GAP` anti-thrash; no silent downgrade | Request a **CAPABILITY**, auto-discover providers via a registry, rank by score — all media *and* text capabilities; keep our gateway as one (remote) adapter, add local (Ollama/Piper/Wan) adapters |
| Model routing | Static task→tier→OmniRoute-combo table (`router.ts`) | Tool-scored provider selection + policy (user pref > availability > discovery); budget-aware | Data-driven capability→provider routing with scoring and budget awareness instead of a binary combo map |
| Artifacts | JSON `artifact` rows (idea/script/production_plan/assets/voice/video/video_render/qa/publish_package); **binaries on disk with a thin manifest**; no rich per-asset metadata | Each artifact JSON-Schema validated with **full provenance** (`asset_manifest`: id/type/path/source_tool/scene_id/prompt/seed/model/cost_usd/duration/resolution/format/quality_score) + append-only `decision_log` | Enrich every media artifact with **provenance** (provider, model, prompt, seed, cost, dims, format, validation state); add an append-only decision log |
| Schemas | Zod schemas in `agents/contracts.ts` (idea, script, plan, QA, publish) | JSON Schema for **everything**: artifacts, checkpoints, pipeline manifests, playbooks, tool contracts; `additionalProperties:false` | Keep Zod, extend to a comprehensive stage/artifact contract set (Idea, Script, CharacterBible, WorldBible, ScenePlan, ProductionPlan, AssetManifest, VoiceManifest, Timeline, QAReport, FinalVideoManifest) |
| Checkpoints | Job rows in SQLite; resume = re-drain `RUNNING`/`READY` jobs; approval gates are persisted approval rows | **Checkpoint per stage** on disk (`projects/<id>/checkpoint_<stage>.json`), status `in_progress/completed/awaiting_human/failed`; superseded auto-archived; `human_approved` enforced by the writer; **fail-fast** on invalid | Keep our job store; ADOPT: a content-level checkpoint summarising "what is done / spent / next", an enforced `human_approved` invariant, and archive of prior run states for rollback |
| State management | Centralized state machine (`orchestrator/state.ts`: job + content transition tables) | `EP_STATE` living in the agent (budget/artifacts/style anchors); disk checkpoints | Keep the enforced, centralized transition table (stronger than OpenMontage); feed an `EP_STATE`-like cumulative production context (budget/anchors/limits) into the creative planner |
| Cost tracking | Per-execution token/request/cost in the Gateway; per-job + roll-up; flat estimate functions | Estimate → Reserve → Reconcile ledger (`EntryStatus`), per-run `total_usd` cap, `single_action_approval_usd`, `require_approval_for_new_paid_tool`, budget reconciled into checkpoint | ADOPT Estimate→Reserve→Reconcile + a hard per-content budget cap and an auto-approval threshold — critical at high-volume short-form output |
| Video generation | `gateway/video.ts` defaults to a **stub animated GIF**; live veo/seedance gated behind `OMNIROUTE_VIDEO_STUB=0` (all models time out) | Provider selectors with real video-gen tools, `MOTION_REQUIRED_OPERATIONS` + no silent still-downgrade | Keep honest capability state; ADOPT the **VideoGenerationProvider interface** (t2v, i2v, first-frame, duration/resolution/seed/negative-prompt/model, VRAM, cost, local/cloud) so Wan 2.1, Veo, Kling are interchangeable providers — not code branches |
| Image generation | `gateway/image.ts`: one OmniRoute FLUX model, `768x1344`, written to disk + manifest | `image_selector` across many providers with scored routing | Provider-agnostic image capability with provenance + style anchors for **character consistency** |
| Voice | `gateway/audio.ts`: one model/voice; live TTS UNPROVEN (defaults to sine stub) | `tts_selector` across providers, scored, with voice_bible-ish selection | Voice capability with a **Voice Bible** (per-character/consistent voice), provider-scored selection, Piper local fallback |
| Music / SFX | Not generated — `layers.music`/`sfx` hardcoded to `'none'` in the assembly manifest | `music_gen` + `music_library` tools | Music/SFX become real capabilities (`generate_music`, with royalty/child-safe defaults) — a genuine gap today |
| Composition | Assembly produces a **composition manifest** (`FinalVideoManifest`) + later an ffmpeg `render` step (`final.mp4`); in-browser preview composer | **Remotion runtime** with theme-system (`THEMES`), scene-type→component dispatch, vertical 9:16 compositions, **word-level caption burn** | Adopt Remotion as the composition template engine with a **series theme / style bible** and typed scene components; keep ffmpeg render as one (lowest-cost) runtime |
| QA | `qa.ts` deterministic technical + plan checks; live plan/vision passes gated/UNPROVEN; checklist + issues; revision → Director | Reviewer meta-skill (CHAI critique, max 2 rounds), EP cross-stage probes (ffprobe the actual output), narration-duration feedback loop, anti-loop numeric limits | ADOPT: `probe the output, not metadata` (ffprobe the MP4), the narration-duration feedback loop, and hard anti-loop limits; add **child-safety / age-appropriateness as a first-class QA pass** |
| Human approval | typed approval entities + gates between steps; mode-aware (AUTO/SEMI/MANUAL) | `awaiting_human` checkpoint + **end-your-turn**; `human_approved=True` enforced by the writer; approval recorded in `decision_log`; per-gate (never re-judged) | Keep our gate system (already strong); enforce "approved required to advance" at the **writer layer** and record every approval in a decision log |
| Error recovery | Centralized retries (`max_retries`), FAILED→READY→RUNNING, resume on startup; revise loop on QA reject | Anti-loop limits, SEND_BACK to a prior stage, superseded-checkpoint archive | Keep our retry machinery; ADOPT targeted SEND_BACK (re-run one earlier stage, not the producer or everything) + budget/limit guards against infinite loops |
| Extensibility | Add an agent type → registry + state maps; add a computed value | Add a manifest + director skill (no code); add a provider = new tool file (auto-discovered) | **Declarative pipeline manifests** so adding a format/pipeline is config; a tool registry so adding a provider is a new tool file |
| Local models | Not modeled — OmniRoute only | Tools carry `runtime` (local/local_gpu/hybrid); piper_tts/local diffusion/Wan classify cleanly | `runtime` on every tool → **local-first capability resolution** (Ollama LLM, local diffusion image, Wan video, Piper TTS) without touching the creative pipeline |
| Cloud models | OmniRoute combos + separate channels | Provider tools with API keys, `runtime=api`, cost estimates | Same capability-request contract for cloud; cost + runtime vary by provider |

---

## 3. Component classification

> KEEP = genuinely valuable, preserve with a reason. IMPROVE = right idea, weak
> execution. REPLACE = wrong/dead approach. REMOVE = dead/fake/overbuilt.
> ADOPT = take the better concept from OpenMontage. COMBINE = merge both ideas.
> N/A = not applicable to our purpose.

| Component | Classification | Rationale |
|-----------|----------------|-----------|
| Brain-first orchestration (persisted jobs, state machine, gates) | **KEEP** | Core strength; deterministic, recoverable, observable. OpenMontage is weaker here. |
| Centralized `state.ts` transition tables | **KEEP** | Enforced single-source-of-truth; better than OpenMontage's status field. |
| Typed agent contracts (Zod) | **IMPROVE** | Good; expand to the full stage/artifact set + provenance. |
| Pipelines as persisted data | **IMPROVE** | Good idea, but the payload is a bare step list with no schema, no budgets, no `produces`, no per-stage limits. Upgrade to schema-validated manifests. |
| Model Gateway (task→combo routing) | **IMPROVE** | Right abstraction, wrong granularity: binary combo map + hardcoded channel providers. Add capability + score routing (selector pattern). |
| Image channel (`gateway/image.ts`) | **IMPROVE** | Works live, but hardcodes one model/provider; no provenance/seed. |
| Voice channel (`gateway/audio.ts`) | **REPLACE** | Defaults to a fake sine stub; no provider scoring; no voice bible; live UNPROVEN. Move to a capability+selector with a Voice Bible. |
| Video channel (`gateway/video.ts`) | **REPLACE** | Stub GIF default + all live models timeout. The `VideoGenerationProvider` interface is the correct replacement. |
| Vision channel (`qa.ts`/`vision.ts`) | **KEEP (honesty)** | Correctly gated/UNPROVEN; keep the honest contract, wire real providers via a registry. |
| Assembly = composition manifest | **COMBINE** | Keep the reproducible manifest, but it must *feed* a Remotion composer, not be the endpoint. |
| Render (ffmpeg `final.mp4`) | **KEEP** | Real muxed MP4 is now produced; make it one of several composition runtimes (Remotion first). |
| QA deterministic checks | **KEEP** | Solid. Add probe-the-output + narration-duration loop + child-safety pass. |
| QA plan/vision live passes | **IMPROVE** | Correct gating; needs provider registry (currently pre-hardwired to OmniRoute). |
| Publisher (`publish_package`) | **IMPROVE** | Logical-only is honest for MVP; wire a real YouTube upload capability later behind a `publish` tool. |
| Analytics / Learning | **KEEP** | Deterministic, hermetic, honest; fine as-is (well-scoped). |
| Human approval gates | **KEEP** | First-class; enforce at writer layer + record in decision log. |
| SQLite store / repository | **KEEP** | Zero-ops, transactional; appropriate for a control-plane store. |
| Frontend Control Center | **KEEP** | Needed; add channels, series/theme, filmstrip + decisions rail later. |
| `Skills/*/SKILL.md` | **IMPROVE** | Static per-agent conventions. Reorganise into the 3-layer model (vendor knowledge files added). |
| Tool registry (none today) | **ADOPT FROM OPENMONTAGE** | The single highest-leverage gap: uniform self-describing tools for every capability. |
| Selector → provider with scoring | **ADOPT FROM OPENMONTAGE** | Capability not provider; scored, budget-aware routing. |
| Declarative pipeline manifests | **ADOPT FROM OPENMONTAGE** | Per-format manifests with stage schema, budgets, limits, `human_approval_default`. |
| Checkpoint with `human_approved` invariant | **ADOPT (pattern)** | Enforce approval-at-the-writer, archive superseded runs. |
| Estimate → Reserve → Reconcile cost ledger | **ADOPT** | Needs our high-volume short-form output to control spend. |
| EP wraps stateless directors + SEND_BACK | **ADOPT** | Cross-stage continuity/pacing fixes with hard anti-loop limits. |
| 3-layer knowledge (tool ↔ skills ↔ vendor) | **ADOPT** | Decouples "what we can do" from "how to use it well". |
| Character/World/Style/Voice Bibles | **ADOPT + KEEP seed idea** | Our `channelConfig` holds a weak `characterDescription`; a real **CharacterBible/WorldBible/VoiceBible** persisted across episodes is essential for children's series continuity. |
| Remotion composition + themes | **ADOPT** | Template-based consistent output + word-level captions + vertical 9:16. |
| MediaProfiles (YOUTUBE_SHORTS 1080x1920) | **ADOPT** | Centralize platform canvas/fps/codec/caption constraints. |
| Local model runtime classification | **ADOPT** | Every tool declares `runtime`; local-first (Ollama/Piper/Wan/local diffusion) becomes config, not redesign. |
| Decision log (append-only audit) | **ADOPT** | Keyed by (category, subject); full "why did we pick this" provenance. |
| Music / SFX generation | **ADOPT (new capability)** | A real gap today; add `generate_music`/`generate_sfx` tools with child-safe defaults. |
| RabbitMQ / external broker | **N/A** | Single-process MVP; in-process event bus is correct for now (D-06). |
| HyperFrames / GSAP render runtime | **N/A** | OpenMontage-specific second runtime; not needed for our scope (Remotion + ffmpeg suffice). |
| 13 OpenMontage pipelines / 90 vendor skills / 30+ providers | **N/A** | We adopt *patterns*, not the catalogue. We keep only what serves children's short-form. |

---

## 4. What the current prototype genuinely gets right (KEEP reasons)

1. **Deterministic, recoverable orchestration.** Centralized transition tables
   (`state.ts`), persisted jobs, automatic resume — this is genuinely stronger
   than OpenMontage's "status field" approach. Preserve.
2. **Human approval as a first-class typed entity** with mode-aware
   (AUTO/SEMI/MANUAL) draining. Preserve and harden.
3. **Honesty about capability state.** Every "UNPROVEN"/"stub" is documented
   and gated (`OMNIROUTE_*_STUB`), and the system fails cleanly instead of
   faking success. This is a real strength — keep it as a hard rule.
4. **JSON-only DB + disk binaries with manifests.** Clean, diffable, cheap.
   Preserve; enrich with provenance.
5. **QA revision loop** (Direct plan → QA v2/v3). The right idea; extend with
   targeted SEND_BACK and anti-loop limits.
6. **Cost accounting at a single choke point** (the Gateway). Correct placement;
   upgrade to Estimate→Reserve→Reconcile.
7. **Brain-first, testable, hermetic agents.** 112 tests, all offline. Preserve.
8. **Separation of backend/frontend + SQLite.** Appropriate, boring, maintainable.

---

## 5. THE TOP 10 ARCHITECTURAL WEAKNESSES (Phase 4)

Ranked by impact on the mission (reliable, provider-independent, local-first,
resumable, child-safe children's short-form production).

### W1 — No tool/capability registry (capabilities are buried in code)
Every generation capability is a hardcoded call inside an agent (visual →
`callOmniRouteImage`, voice → `callOmniRouteSpeech`, etc.). There is no
self-describing "tool" that says *what* a capability is, *where* it runs
(local/cloud), *what it costs*, *what its fallback is*, or *which vendor skill
applies*. This single absence causes most of the other weaknesses:
- provider independence is nominal (each agent hardcodes a provider string),
- local-first is impossible without rewriting agents,
- capability discovery/health/cost surfaces don't exist.

### W2 — "Provider abstraction" is a fixed channel map, not capability resolution
`router.ts` maps task→OmniRoute combo, and image/audio/video/vision channels
each hardcode a provider (e.g. `IMAGE_MODEL`, `VIDEO_MODEL`). Requesting
"VIDEO_GENERATION" cannot be fulfilled by Wan, Veo, or Kling interchangeably —
the pipeline literally names `veo-free/veo`. No capability→provider scoring, no
`runtime` (local/cloud) classification, no fallback chain.

### W3 — Local-first is not modeled at all
Nothing in the architecture can express "this capability can run locally for
free (Piper TTS, Ollama LLM, Wan 2.1 video, local diffusion)" vs "this needs an
API key and costs money." Enabling local models would be a redesign of every
media agent, exactly what the mission forbids. OpenMontage's `ToolRuntime`
enum (local / local_gpu / api / hybrid) is the missing primitive.

### W4 — Fake/stub media is the *default* and is structurally indistinguishable from real output
The pipeline *defaults* to stub/UNPROVEN paths for voice (sine WAV), video
(animated GIF bands), and QA (technical-only) because the live upstreams time
out. This is honest in spirit (it's gated + documented), but the **architecture
does not carry a real status flag on the produced asset** — a GIF clip and a
real MP4 share the same manifest shape, and the "final video" claim has
repeatedly been ambiguous (manifest vs MP4). Phase 13/14 require a hard
PLANNED/GENERATED/VALIDATED/COMPOSED/RENDERED/PUBLISHED status on every media
artifact and honest capability reporting.

### W5 — No real composition engine; assembly is endpoints, not a pipeline into render
The Assembly Agent emits a composition *manifest* and the browser renders it;
the later ffmpeg `render` step was bolted on. There is no clean, reusable
**timeline → Remotion → MP4** path, no template/scene-type system, no series
theme, no word-level caption burn, and music/SFX are hardcoded to `'none'`.
Production cannot yet reliably produce a real final MP4 with multiple tracks.

### W6 — No content-continuity primitives (Character/World/Style/Voice Bibles)
The only continuity concept is a `channelConfig.visualStyle.characterDescription`
string. For children's series, character appearance, colors, clothing, voice,
world, and story state must persist as **typed, versioned, reusable bibles**
referenced by scenes — not re-invented per episode. This is a first-class
requirement the architecture simply does not have.

### W7 — Cost control is tracking, not governance
Cost is *accounted* per call and rolled up, but there is no budget **limit**
(cap per content/run), no **reserve** before a spend, no **approval threshold**
for expensive actions, and no guard against a QA/perfectionism loop burning
budget. OpenMontage's Estimate→Reserve→Reconcile lifecycle + `total_usd` +
`single_action_approval_usd` + anti-loop limits are the fix, and they are
especially important at high output volume.

### W8 — No anti-loop / bounded-revision governance
QA rejection → Director revise can loop with no cap on iterations, no
per-stage max, no wall-time bound, and no "proceed with warnings." Combined
with W7 this is an unbounded spend/loop risk. OpenMontage's execution limits
(`max_revisions_per_stage=3`, `max_send_backs=3`, `max_wall_time_minutes`)
are the missing guardrails.

### W9 — QA validates metadata, not the produced artifact
`runMediaQa` checks the manifest's declared fields (mime is `image/gif`, bytes
> 0) — it does **not** `ffprobe` the actual MP4 to confirm duration, resolution,
codec, or audio channels. A rendered file that is 2s too long, silent, or the
wrong codec passes "continuity" checks that only read JSON. OpenMontage's
"probe the output, never trust metadata" is a hard rule the factory lacks.

### W10 — Orchestration/creative logic is split between "fixed code pipeline" and per-agent prompts without a legible contract
The pipeline is a hardcoded ordered step list; there is no schema-validated
manifest describing stages, `produces`, budgets, per-stage approval defaults, or
limits. Adding a new content *format* (storybook vs sing-along vs quiz) means
code changes, not a new manifest. The composition of the pipeline — when, why,
how far — is not reviewable/editable data. OpenMontage's per-format YAML
manifests + stage directors are the legible, editable alternative.

---

## 6. Honest capability state of the current prototype (as of 2026-09-04)

| Capability | Verified? | Notes |
|------------|-----------|-------|
| Orchestration / jobs / gates / resume | **REAL-DATA-PROVEN** | 112 tests + E2E via real HTTP; deterministic |
| Image generation (FLUX via OmniRoute) | **REAL-DATA-PROVEN** | Live on `flux.2-klein-4b`; manifest + disk |
| Real MP4 render (ffmpeg) | **PROVEN (when ffmpeg present)** | `render` step muxes `final.mp4`; gated on `FFMPEG_PATH` |
| Voice / TTS | **UNPROVEN** (defaults to sine stub) | Live NIM downstream times out |
| Video clips (veo/seedance) | **UNPROVEN** | Defaults to animated-GIF stub; all live models time out |
| QA vision / plan model passes | **UNPROVEN** | Defaults to deterministic technical-only |
| Music / SFX | **NOT IMPLEMENTED** | `layers` hardcoded to `none` |
| YouTube publish | **NOT IMPLEMENTED** (logical package only) | Honest MVP boundary |

Rule carried forward: **a capability that is not directly proven is reported as
UNPROVEN, never celebrated as working.** This honesty is preserved in the target
architecture.

---

## 7. What the target architecture adopts vs. rejects (summary)

**Adopt from OpenMontage (patterns, not code or catalogue):**
- `ToolContract` + auto-discovered registry (capability-first).
- Selector → provider routing with scoring, `runtime` (local/cloud), fallback.
- Declarative, schema-validated pipeline manifests per format.
- Estimate → Reserve → Reconcile cost lifecycle + hard budget cap + approval
  threshold + anti-loop limits.
- EP-wraps-directors with SEND_BACK and cross-stage probes.
- "Probe the output, not the metadata" QA (ffprobe the MP4).
- 3-layer knowledge (registry / project conventions+child-safety / vendor).
- Remotion template composition + series themes + word captions + MediaProfiles.
- Checkpoint-level `human_approved` invariant + decision log.
- Character/World/Style/Voice Bibles persistence.

**Reject / not adopt:**
- The full OpenMontage catalogue (13 pipelines, 90 vendor skills, 30+ providers,
  HyperFrames/GSAP runtime, Backlot board as-is) — we keep only what serves
  children's short-form.
- Agent-as-orchestrator. We keep our **deterministic typed orchestrator** (it is
  stronger, more testable, and centralizes state), and layer the EP/SEND_BACK /
  manifest concepts onto it rather than discarding it.
- Losing our hard honesty rule about stubs/UNPROVEN, and our SQLite job store.

**The resulting principle (paraphrase of the mission):**
> We audited both architectures, identified what was fundamentally weak
> (capabilities buried in code, fixed channel map, no local-first, stub-by-
> default media, no continuity bibles, no spend governance, no output probing),
> retained the valuable parts of our system (deterministic orchestrator, typed
> gates, honest capability state, JSON/disc store, QA revision, SQLite),
> adopted the strongest architectural concepts from OpenMontage (self-describing
> tool registry, capability selectors, declarative manifests, cost
> lifecycle, EP-wraps-directors with SEND_BACK, output probing, Remotion
> composition, bibles), and rebuild the weak areas around explicit contracts,
> capabilities, artifacts, checkpoints and real production execution.
