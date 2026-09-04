# AI Content Factory — Target Architecture

Status: DESIGN (2026-09-04). The redesigned production architecture for the
re-architecture, produced after the audit in `docs/OPENMONTAGE_AUDIT.md`.
This replaces the prototype's weak areas with explicit contracts, capabilities,
artifacts, checkpoints and real production execution — adopting OpenMontage's
strongest *principles* without copying its catalogue.

Stages:
1. `docs/OPENMONTAGE_AUDIT.md` — the comparison + top-10 weaknesses (done).
2. This doc — the target design (done).
3. `docs/MIGRATION_PLAN.md` — the incremental path to get here.

---

## 1. Architectural goal & driving principles

We keep the current prototype's core strengths (deterministic, recoverable
orchestration; first-class human gates; honest capability reporting; SQLite job
store; JSON-only DB + disk binaries) and rebuild around OpenMontage's best
ideas — but adapted to children's short-form production and to our TypeScript
stack.

Non-negotiable design rules:

1. **Capability-first, provider-last.** Creative agents request a *capability*
   (`VIDEO_GENERATION`, `IMAGE_GENERATION`, `TTS`, `MUSIC_GENERATION`). A
   provider registry resolves which concrete tool/provider satisfies it. The
   pipeline never names a vendor model.
2. **Local-first.** Every capability can run locally (Ollama LLM, local diffusion,
   Wan 2.1 video, Piper TTS) as long as the provider declares `runtime: local`.
   Enabling a local provider is config, never a redesign.
3. **Every output is a first-class artifact** carrying full provenance (provider,
   model, prompt, seed, cost, dims, format, validation state) and an honest
   lifecycle status (PLANNED → GENERATED → VALIDATED → COMPOSED → RENDERED →
   PUBLISHED).
4. **Resumable & bounded.** Production resumes from the last valid checkpoint;
   hard guardrails (budget cap, max revisions, max send-backs, wall-time) stop
   loops.
5. **Probe the output, not the metadata.** QA inspects the real MP4 (ffprobe),
   real assets, real durations.
6. **Children's-series continuity is explicit:** Character / World / Style /
   Voice Bibles persist across episodes and are referenced by scenes.
7. **Honesty preserved:** any capability that is not directly proven is reported
   UNPROVEN; never faked.

---

## 2. Logical architecture

```
                   CONTENT FACTORY
                          |
                  Production Director (orchestrator + manifests)
                          |
         +----------------+-----------------+
         |                                  |
  Creative System                    Production System
  (plans, not pixels)                (executes capabilities)
         |                                  |
  Research / Idea                        Asset Pipeline
  Script                                 ImageGeneration(tool)
  CharacterBible / WorldBible /          VideoGeneration(tool)
    StyleBible / VoiceBible               Voice/TTS(tool)
  ScenePlan                             MusicGeneration(tool)
  ProductionPlan (beat/timeline)         SFX(tool)
         |              \                Composition (Remotion)
         |               \                      |
         v                v                     v
   HUMAN GATES            QA / Review (probe + child-safety + continuity)
   (idea/script/plan)              |
                                   v
                            Final Render (Remotion/ffmpeg)
                                   |
                                   v
                                Final MP4
                                   |
                                   v
                            Publish (YouTube tool)
```

Two orthogonal concerns now separated cleanly:
- **Creative System** produces *contracts* (script, bibles, scene plan, production
  plan, timeline) — text/data, gated by humans, cheap.
- **Production System** executes those contracts through *capability tools*,
  produces *artifacts*, and runs *QA* on the actual output.

---

## 3. Layered module layout (proposed `backend/src/`)

```
backend/src/
  contracts/        stage + artifact schemas (zod), media profiles
    idea.ts  script.ts  characterBible.ts  worldBible.ts  styleBible.ts
    voiceBible.ts  scenePlan.ts  productionPlan.ts  assetManifest.ts
    voiceManifest.ts  timeline.ts  qaReport.ts  finalVideoManifest.ts
    mediaProfiles.ts  capability.ts  lifecycle.ts
  capabilities/     self-describing tool contracts + registry
    contract.ts       BaseCapability/ToolContract
    registry.ts       discovery: getByCapability/capabilityCatalog/providerMenu
    image.ts video.ts voice.ts music.ts sfx.ts compose.ts analyze.ts publish.ts
  providers/        concrete adapters; each declares runtime/cost/fallback
    omniroute/        imageArts  videoVao  speech  vision
    local/            ollamaLlama  piperTts  wan21Video  localDiffusion
    scoring.ts        task-fit/quality/cost/latency score + PREFERRED_GAP
  planner/          creative system (formerly agents): produces contracts
    idea.ts script.ts director.ts characterBible.ts scenePlan.ts
  production/       production system: consumes contracts -> artifacts
    visual.ts voice.ts music.ts sfx.ts assembly.ts render.ts qa.ts publisher.ts
  orchestrator/     deterministic state machine (kept) + manifest engine + EP
    orchestrator.ts state.ts manifest.ts ep.ts checkpoint.ts
  store/            repository (kept) + artifact provenance + decisionLog
  server.ts cli.ts pipelineStore.ts config.ts
```

The distinction: **planner/ agents produce contracts** (creative, cheap, gated),
**production/ agents consume contracts and drive tools** (media, costed,
QA'd). This is the Creative/Production split from the mission.

---

## 4. ToolContract (capability registry) — the keystone

Every capability is a self-describing tool. We adopt OpenMontage's
`BaseTool`-style contract, in TypeScript:

```ts
interface ToolContract {
  name: string; id: string; version: string;
  capability: Capability;            // IMAGE_GENERATION | VIDEO_GENERATION | TTS | ...
  provider: string;                  // 'omniroute-flux' | 'wan21' | 'piper' | 'selector'
  tier: 'core'|'voice'|'enhance'|'generate'|'source'|'analyze'|'publish';
  runtime: 'local'|'local_gpu'|'api'|'hybrid';   // local-first primitive (W3)
  determinism: 'deterministic'|'seeded'|'stochastic';
  availability: 'available'|'unavailable'|'degraded';
  inputSchema: Schema; outputSchema: Schema; artifactSchema: Schema;
  dependencyKeys: string[];          // e.g. ['env:OMNIROUTE_API_KEY', 'binary:ffmpeg']
  resourceProfile: { vramMb: number; ramMb: number };   // for Wan/GPU
  estimateCost(inputs): number;      // USD/EUR
  estimateRuntime(inputs): number;
  fallback?: string; fallbackTools?: string[];
  agentSkills: string[];             // -> Layer 3 vendor skills
  supports: Record<string, unknown>; // e.g. firstFrame, duration, seed, negativePrompt
  idempotencyKey(inputs): string;
}
```

**Selectors** (e.g. `video_selector.capability = VIDEO_GENERATION`) auto-discover
providers from the registry, rank them via `scoring.ts`, and route — so Wan 2.1,
Veo, Kling, Hunyuan are interchangeable providers of one capability (W2 fixed).

**provider_menu() / capabilityCatalog()** = a runtime "here is what this install
can do, where it runs, what it costs, what's missing (with setup offers)" —
replaces hardcoded tool lists (W1 fixed).

### Concrete capability example — VideoGenerationProvider (Phase 9 / Wan-ready)

```ts
interface VideoGenerationProvider {
  capability: 'VIDEO_GENERATION';
  modes: ['text_to_video', 'image_to_video'];
  supportsFirstFrame: boolean; supportsSeed: boolean; supportsNegativePrompt: boolean;
  minDurationSec: number; maxDurationSec: number;
  resolutions: string[];           // e.g. ['768x1344','1080x1920']
  vramMb: number;                  // Wan 2.1 1.3B low; 14B high
  runtime: 'local_gpu' | 'api';
  estimateCost(inputs): number;    // for cloud; 0 for local
}
```

Wan 2.1 becomes ONE provider behind this interface — never the architecture.

---

## 5. Declarative pipeline manifests

Pipelines become schema-validated data (replacing the bare step list in
`pipelineStore`), one per content **format**:

```ts
interface PipelineManifest {
  id: string; name: string; version: string;
  category: 'educational'|'storybook'|'singalong'|'quiz'|'short';
  stability: 'production'|'beta'|'test';
  referenceChannels?: string[];         // ToyMonster Club, etc.
  orchestration: {
    mode: 'producer';                    // our deterministic orchestrator = EP
    budgetDefaultUsd: number;
    maxRevisionsPerStage: number;        // default 3
    maxSendBacks: number;                 // default 3
    maxWallTimeMinutes: number;           // anti-loop (W8)
  };
  stages: PipelineStage[];               // ordered
}

interface PipelineStage {
  name: StageName;                       // idea|script|characterBible|scenePlan|
                                         // assets|music|voice|assembly|render|qa|publish
  planner?: string;                       // creative agent producing a contract
  produces: string[];                     // canonical artifact kinds
  requiresRequiredArtifactsIn?: string[];
  humanApprovalDefault?: boolean;
  checkpointRequired: boolean;
  toolsAvailable: string[];               // capability ids
  reviewFocus: string[];
  successCriteria: string[];
}
```

Adding a new children's format = a new manifest + the stage-director skill rules;
no code change. The `producer` orchestration mode is our **deterministic
Orchestrator extended with an Executive-Producer layer** (cumulative budget,
style anchors, SEND_BACK, anti-loop enforcement).

---

## 6. Checkpoints + bounded resume

Keep the SQLite job store as the source of truth, and add a **content-level
checkpoint** summarizing state (the OpenMontage `awaiting_human`/`completed`
pattern adapted):

```ts
interface Checkpoint {
  version: '1.0';
  contentId: string;
  stage: StageName;
  status: 'in_progress'|'completed'|'awaiting_human'|'failed';
  humanApprovalRequired: boolean;
  humanApproved?: boolean;              // writer ENFORCES approved to pass a gate
  artifacts: Record<string, ArtifactRef>; // kind -> version/id
  costSnapshot: { spentUsd: number; reservedUsd: number; remainingUsd: number };
  error?: string;
  metadata: { partialProgress?: Record<string, unknown> }; // asset-level progress
}
```

Rules:
- On entering a stage, write `in_progress`; refresh `partialProgress` after each
  asset (powers a live filmstrip).
- A gated stage can only be `completed` with `humanApproved=true` — the writer
  raises a GATE VIOLATION otherwise (hard invariant, not convention).
- Superseded checkpoints are **auto-archived** for rollback (V1/V2 plan retention
  already exists — extend to all stages).
- Resume = from the last valid checkpoint; already-successful assets are reused
  (never regenerate the story/scene-plan/successful assets — Phase 7 checkpoint).

---

## 7. Artifacts with provenance + lifecycle status

Enrich every artifact (this fixes W4 — fake vs real output become
distinguishable):

```ts
interface MediaArtifact {
  id: string; kind: string;                    // 'assets'|'voice'|'video'|'final_video'
  contentId: string; sceneId?: string; version: number;
  lifecycle: 'PLANNED'|'GENERATED'|'VALIDATED'|'COMPOSED'|'RENDERED'|'PUBLISHED';
  provider: string; model: string;
  prompt?: string; seed?: number;
  dimensions?: string; format?: string; bytes?: number;
  costUsd: number; durationSec?: number;
  validation: { status: 'passed'|'failed'|'unchecked'; checkedAt?: string };
  sourceJobId: string;
}
```

The `lifecycle` field is what finally makes "a manifest is not a final video"
true: the FinalVideoManifest is `COMPOSED`, and the muxed `final.mp4` is
`RENDERED`, and only a `RENDERED`/`VALIDATED` artifact may be called a final
video. The Publisher refuses to publish anything not `RENDERED` + `VALIDATED`.

Also add an **append-only decision log** (OpenMontage pattern):
```ts
interface DecisionLogEntry { id; contentId; stage; category; subject; decision;
  optionsConsidered; rejectedBecause; at; }
```
Categories: `provider_selection`, `model_selection`, `runtime_selection`,
`fallback_decision`, `budget_tradeoff`, `voice_selection`, `approval_policy`.

---

## 8. Creative System — contracts & continuity Bibles

### 8.1 Stage contracts (schema-first)
Every creative stage produces one validated contract:
`Idea → ResearchBrief → Script → CharacterBible (+WorldBible+StyleBible+VoiceBible)
→ ScenePlan → ProductionPlan → Timeline`.

### 8.2 Content-continuity Bibles (children's series — W6 fixed)

```ts
interface CharacterBible {
  id: string; name: string; seriesId: string;
  appearance: { colors: string[]; clothing: string; hair: string; }[];
  visualReferences: string[];      // asset ids / seed anchors
  personality: string; targetAge: string;
  voice: { voiceId: string; provider: string; pitch: string; accent: string; }; // VoiceBible ref
  version: number;
}
interface WorldBible  { id; seriesId; locations: Record<string,string>; rules; mood; }
interface StyleBible  { id; seriesId; artStyle; palette: string[]; cameraLanguage; }
interface VoiceBible  { id; seriesId; perCharacter: Record<string,{voiceId;provider;accent;speed}>; }
```

These persist **across episodes** (a `series` table + `bible` artifacts), are
referenced by scenes (scene → `characterIds`),
and are injected into every creative agent's context so a scene *references* the
character rather than reinventing it. The Visual/Voice agents derive prompts and
voice selection directly from the bibles (character consistency + voice
consistency = the two biggest children's-content wins).

### 8.3 Scene planning
`ScenePlan` precedes `ProductionPlan`: scenes carry characterIds, location,
action, emotion, camera, and pacing targets (words/sec per age band). The
ProductionPlan (renamed `ProductionPlan`) becomes the executable timeline:
`scenes[]` each with `durationSeconds`, `narrationWords`, `assetSpec` (which
bible/character), beat mapping (Hook/Chaos/CTA per channel), and per-scene
motion requirements (must-move vs still-OK) to feed the video selector's
MOTION_REQUIRED rule.

---

## 9. Production System — capabilities + composition + QA

### 9.1 Asset pipeline
Planner contracts → capability tools:
- **Visual** → `IMAGE_GENERATION` tool(s), prompts built from StyleBible +
  CharacterBible references + seed; assets carry seed for re-generation of one
  scene without touching others.
- **Video** → `VIDEO_GENERATION` (Wan 2.1 local or Veo/Kling cloud via selector);
  a scene that must move is never silently downgraded to a still (adopt
  MOTION_REQUIRED guard).
- **Voice** → `TTS` selector; voice from VoiceBible; `generate_voice` writes
  per-scene clips; a narration-duration probe feeds back ScenePlan/ProductionPlan
  if over.
- **Music / SFX** → `MUSIC_GENERATION` and `SFX_GENERATION` tools (new; child-safe,
  royalty, duration-matched). No longer hardcoded `'none'`.

### 9.2 Composition (timeline → Remotion → MP4) — W5 fixed
Adopt Remotion as the primary composition engine:
- **MediaProfiles** centralize the canvas: `YOUTUBE_SHORTS (1080×1920, 9:16,
  30fps, H.264/AAC, ≤60s, srt/vtt)`.
- **Series THEMES** per brand (like OpenMontage's `THEMES`) enforce visual
  consistency from one config.
- A **scene-type → component dispatch** vocabulary for child scenes
  (`intro_hook`, `lesson_card`, `character_scene`, `singalong_overlay`,
  `quiz_card`, `outro_cta`), with **word-level caption burn** for read-along.
- `Timeline → Remotion render → ffmpeg mux → final.mp4`. Remotion is the
  runtime; ffmpeg is a fallback/local runtime behind the same `compose`
  capability.

### 9.3 QA (probe + child-safety + continuity) — W9 fixed
Structured QA producing a verdict with issues + severity + `revision_target`
(the stage/agent to re-run) + `autoFixable`:

```ts
interface QaReport {
  status: 'approved'|'rejected';
  score: number;
  passes: QaPass[];                      // per-dimension result
  issues: QaIssue[];                     // + location + suggestedFix + autoFixable
  revision: { targetStage: StageName; sendBackTo?: StageName };
}
```

Passes (each produces structured results, per Phase 11):
- **Technical QA** — `ffprobe` the real MP4: duration ±5% of timeline, resolution,
  codec, audio channels present. (Probe output, not metadata.)
- **Audio QA** — every scene has a real non-empty narration clip of measured
  duration; narration ≤ scene window (feedback loop).
- **Visual QA** — stills/clips present, valid MIME, non-empty; must-move scenes
  have motion.
- **Continuity QA** — timeline contiguous 0→total; character/style stable across
  scenes (probe via character references + optional vision model).
- **Creative QA** — happy with the edit (optional model pass).
- **Child-safety QA** — age-appropriateness, vocabulary level per age band,
  moderation of every generated asset; a moderation-provider failure means
  **pause, never silently proceed**.
- **Production QA** — budget within plan, no anti-loop limits breached.

A rejected pass sets `revision.sendBackTo` so the Orchestrator re-runs **a
targeted earlier stage** (SEND_BACK) — the Director for plan/continuity issues,
the Voice agent for narration-duration, etc. — never the whole production (W8).

### 9.4 Human-in-the-loop (Phase 12) — meaningful gates
- IDEA → optional approval (research).
- SCRIPT → approval (mandatory).
- PRODUCTION PLAN → approval (mandatory).
- ASSETS → automatic QA (no forced approval).
- ASSEMBLY/RENDER → automatic QA.
- FINAL VIDEO → optional approval before publish.
- PUBLISH → approval (mandatory), and only if `RENDERED`+`VALIDATED`.

Gates are enforced at the writer layer (`humanApproved` invariant); every
approval is appended to the decision log (`approval_policy`).

---

## 10. Cost governance (Estimate → Reserve → Reconcile) — W7 fixed

- Every tool `estimateCost(inputs)`.
- The Orchestrator **reserves** budget before a costly step; **reconciles** on
  completion (REFUND on failure).
- Per-content/run **hard cap** (`budgetDefaultUsd` from the manifest) + a
  `singleActionApprovalUsd` threshold (costly single action → human approval) +
  `requireApprovalForNewPaidTool`.
- Budget is part of the checkpoint `costSnapshot` and feeds the Producer/EP.

---

## 11. Local-first resolution matrix (Phase 8)

| Capability | Local provider | Cloud provider |
|------------|----------------|----------------|
| LLM (research/script/director) | Ollama / OpenAI-compatible endpoint | OmniRoute combos |
| Image | local diffusion (ComfyUI/SD/Flux local) | OmniRoute FLUX |
| Video | **Wan 2.1 1.3B** (local_gpu) | Veo / Kling / Hunyuan |
| Voice | **Piper** (local) | OmniRoute TTS / OpenAI TTS |
| Music | local generative music (optional) | Suno / ElevenLabs |
| Composition | Remotion + ffmpeg (local) | — |
| QA vision | local VLM | OmniRoute vision |

Each row is a **capability**; the adjacent cells are providers the registry can
resolve at runtime. Downgrading any cell = config, not a redesign (W3 fixed).

---

## 12. What is explicitly kept vs. replaced

**Kept (with reason):** deterministic typed Orchestrator + state machine
(stronger than OpenMontage); first-class approval gates; JSON-only DB + disk
binaries; QA revision loop; SQLite store; cost accounting choke point; honest
capability reporting; brain-first hermetic agents; monorepo + frontend split.

**Replaced:** code-embedded pipeline definitions → declarative manifests;
hardcoded channel providers → capability registry + selectors; voice sine-stub
→ TTS capability with Voice Bible; video stub-GIF → VideoGenerationProvider;
"assembly manifest as endpoint" → composition engine (Remotion) + real MP4;
metadata-only QA → probe-the-output QA; no continuity → Series Bibles;
accounting-only cost → Estimate/Reserve/Reconcile + caps; unbounded revision →
anti-loop limits.

**Removed:** no dead code survives if it has no purpose in the above. (See
MIGRATION_PLAN cleanup.)

---

## 13. Final deliverables invariant

The architecture must conceptually support, end-to-end:

```
IDEA → RESEARCH → SCRIPT → CHARACTER/WORLD/STYLE/VOICE BIBLE → SCENE PLAN →
PRODUCTION PLAN → ASSET GENERATION (Images·Video·Voice·Music·SFX) →
VALIDATION → ASSEMBLY → QA → REVISION(if needed) → FINAL RENDER → FINAL MP4 →
PUBLISH
```

And it must be: modular, provider-independent, local-first capable, resumable,
observable, testable, cost-aware, schema-driven, artifact-driven, extensible,
and **honest about capability availability**.
