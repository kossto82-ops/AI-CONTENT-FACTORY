# AI Content Factory — Migration Plan

Status: PLAN (2026-09-04). The incremental, no-giant-rewrite path from the
current prototype to the target architecture in
`docs/TARGET_ARCHITECTURE.md`. Each phase ends with tests + typecheck + build +
working functionality + doc update (Phase 17 rule).

Baseline of truth (verified 2026-09-04): backend 13 test files / 112 tests pass,
backend + frontend typecheck green, on `main`, clean tree.

How to read each phase: `affected` (files edited), `created` / `removed`
(files), `deps`, `risks`, `acceptance`.

---

## PHASE 1 — Foundation: capability contracts + registry skeleton

Introduce the keystone primitive first, but **non-invasively**: a
`Capability`/`ToolContract` type and an in-memory registry. No agent behavior
changes yet — this is a parallel structure we migrate onto.

- `created`
  - `backend/src/capabilities/contract.ts` — `Capability`, `ToolContract`,
    `ToolRuntime`, `ToolTier`, `ToolResult`, `SelectorRoute`.
  - `backend/src/capabilities/registry.ts` — `register`, `getByCapability`,
    `capabilityCatalog`, `providerMenu`, `resolve(capability, {runtime?, budget?})`.
  - `backend/src/capabilities/scoring.ts` — score (task-fit/quality/cost/latency)
    + `PREFERRED_PROVIDER_GAP`.
  - `backend/src/contracts/mediaProfiles.ts` — `YOUTUBE_SHORTS` (1080×1920 9:16)
    and friends (adopted from OpenMontage).
  - `backend/test/registry.test.ts`.
- `affected`: `package.json` (no new runtime deps; zod already present).
- `deps`: none external.
- `risks`: low (new code, unused yet). Guard: registry must not be load-bearing
  for existing flows.
- `acceptance`: registry tests green; `capabilityCatalog()` returns empty/seed
  tools; full suite still 112 green; typecheck + build green.

## PHASE 2 — Pipeline engine: declarative manifests

Replace the bare `PipelineStep[]` with schema-validated `PipelineManifest`
(keeping the existing persisted `pipelineStore` backward-compatible by migrating
the default pipeline into a manifest on first load).

- `affected`: `pipeline.ts`, `pipelineStore.ts`, `orchestrator/orchestrator.ts`
  (reads manifest stages), `contracts.ts` (agent stage schema aliases),
  `agents/registry.ts` (unchanged interface).
- `created`:
  - `contracts/pipelineManifest.ts` — zod schema (stages, produces, budgets,
    limits, humanApprovalDefault).
  - `schemas/`-style validation + `pipelineManifest.test.ts`.
- `removed`: the hardcoded step-list-only definition (replaced by manifest data).
- `deps`: none.
- `risks`: medium — orchestrator depends on the step shape. Mitigate: the
  manifest-to-`DEFAULT_PIPELINE` bridge keeps the existing `PipelineDefinition`
  interface for the Control Center until Phase 8.
- `acceptance`: `GET /api/pipelines` returns the manifest-backed pipeline;
  existing pipeline+orchestrator tests upgraded + green; full suite green.

## PHASE 3 — Artifact system: provenance + lifecycle

Add provenance + lifecycle status to artifacts, and an append-only decision log.

- `affected`: `db/repository.ts` (artifact fields + `decision_log` table),
  `orchestrator/orchestrator.ts` (`persistArtifact` writes provenance), agents'
  outputs where they declare model/seed/cost.
- `created`: `contracts/artifact.ts`, `contracts/decisionLog.ts`, migration v4
  (artifact `lifecycle`, `provider`, `model`, `seed`, `costUsd`, `validation`;
  `decision_log` table), `test/artifact.test.ts`.
- `deps`: none.
- `risks`: medium — migration + existing artifact tests. Mitigate: additive
  columns, default lifecycle `GENERATED`.
- `acceptance`: an agent run now persists a `lifecycle` + provenance; decisions
  append to the log; full suite green.

## PHASE 4 — Provider system: adapters behind the registry

Move the media channels behind capability tools so the pipeline requests a
capability, not a provider. Keep the OmniRoute adapters but expose them as
`ToolContract` implementations; add local stubs declared as honest
`runtime: local`, `availability` (stub vs proven), and a Wan-shaped
`VideoGenerationProvider` interface.

- `affected`: `gateway/*` (image, audio, video, vision) wrapped as tools;
  `agents/visual.ts`, `voice.ts`, `qa.ts` call `registry.resolve()` instead of a
  hardcoded channel (behavior preserved via the OmniRoute tool first).
- `created`: `capabilities/tools/image.ts`, `video.ts` (VideoGenerationProvider),
  `voice.ts`, `vision.ts`, `music.ts` (stub: honest `NOT_IMPLEMENTED`),
  `sfx.ts` (stub), `test/provider.test.ts`.
- `removed`: direct `callOmniRoute*` imports from agents (now via registry).
- `deps`: none external.
- `risks`: high — this touches the live media path. Mitigate: keep the current
  OmniRoute adapter as the default resolved tool; run real image E2E first.
- `acceptance`: agents resolve capabilities through the registry; default
  resolves to the OmniRoute tool (image still REAL-DATA-PROVEN); video/voice
  still honestly UNPROVEN via stub tools marked `degraded`; errors surface
  `providerMenu()`; full suite green.

## PHASE 5 — Real media generation: composition via Remotion + probe QA

The biggest functional leap: introduce Remotion composition.

- `affected`: `agents/assembly.ts` (emit a Remotion-typed `Timeline`),
  `agents/render.ts` (dispatch to Remotion runtime first, ffmpeg fallback),
  `agents/qa.ts` (add `ffprobe`-style output probing on the real MP4), `config.ts`
  (Remotion/ffmpeg paths).
- `created`:
  - `remotion-composer/` (minimal: `Root.tsx` with a vertical Shorts composition,
    a small scene-type → component set for hooks/lesson/caption, one series
    theme, word caption burn).
  - `capabilities/tools/compose.ts`, `analyze.ts` (ffprobe wrapper).
  - `test/compose.test.ts`, `test/analyze.test.ts` (hermetic deps).
- `removed`: the "assembly manifest is the final video" framing; QA no longer
  trusts metadata alone.
- `deps`: `remotion`, `@remotion/cli`, `remotion/ffmpeg` (npm, dev); ffmpeg
  already available via `FFMPEG_PATH`.
- `risks`: high — Remotion install/render on Windows, ffprobe availability. Use
  dependency-injected runners (as render already does) so tests stay hermetic.
- `acceptance`: a full pipeline produces a `RENDERED` + `VALIDATED` real MP4;
  QA probes it (duration/resolution/audio); render paths unit-tested; full suite
  green.

## PHASE 6 — Character/world continuity: bibles

- `affected`: `contracts.ts` (add bibles), `agents/director.ts`,
  `agents/visual.ts`, `agents/voice.ts`, orchestrator `buildInput` (inject
  bibles), `db/repository.ts` (+`series` +`bible` artifact kind).
- `created`: `contracts/characterBible.ts`, `worldBible.ts`, `styleBible.ts`,
  `voiceBible.ts`; `agents/characterBible.ts` (planner) + optional scenePlan;
  `test/bible.test.ts`.
- `deps`: none.
- `risks`: medium — schema surface grows; keep bibles optional-first (default
  channel config still works).
- `acceptance`: a content can carry a persisted CharacterBible; Visual/Voice
  prompts/voice derive from it; continuity across two contents is observable
  (shared style/character refs); full suite green.

## PHASE 7 — QA system: structured passes + targeted SEND_BACK + anti-loop

- `affected`: `agents/qa.ts` (multi-pass structure; technical/audio/visual/
  continuity/creative/child-safety/production passes), `orchestrator` (SEND_BACK
  to a targeted earlier stage + enforcement of `maxRevisionsPerStage`,
  `maxSendBacks`, `maxWallTimeMinutes`), `director.ts` (revision via bibles +
  issues).
- `created`: `contracts/qaReport.ts`, `capabilities/tools/moderate.ts`
  (child-safety, honest `NOT_IMPLEMENTED` until a provider is wired),
  `test/qaPass.test.ts`.
- `removed`: the single flat QA verdict (replaced by multi-pass `QaReport`).
- `deps`: none external (moderation capability stays honest stub).
- `risks`: medium — revision routing logic; anti-loop must not break the existing
  director revise loop (port it onto SEND_BACK).
- `acceptance`: QA rejects with a `revision.targetStage`; orchestrator re-runs
  that stage only; loop caps enforced (stops after max); child-safety pass
  present but honestly UNPROVEN; full suite green.

## PHASE 8 — Production UI (Control Center)

Surface the new model without a rewrite: series/bibles, capability status
(provider menu), lifecycle status on assets, decision log, SEND_BACK controls.

- `affected`: `frontend/src/App.tsx`, `frontend/src/api.ts`; `server.ts` (new
  endpoints: series, bibles, capability menu, decision log, lifecycle).
- `created`: `frontend/src/ui.tsx` additions (filmstrip, provider-menu panel,
  decision rail); `test` (backend endpoints).
- `deps`: none (frontend build only).
- `risks`: low-medium.
- `acceptance`: operator sees per-content lifecycle + capability health; can
  re-run a targeted stage (SEND_BACK); backend + frontend build/typecheck green.

## PHASE 9 — YouTube publishing

Wire a real (oracles-gated) YouTube upload capability behind the `publish`
tool, replacing the logical-only package as the default path (still honest if no
credentials → `unavailable`).

- `affected`: `agents/publisher.ts`, `capabilities/tools/publish.ts`,
  `config.ts` (YouTube creds/env), `server.ts`.
- `created`: `capabilities/tools/youtubePublish.ts` (declares auth deps;
  `availability` reflects env), `test/publish.test.ts`.
- `deps`: youtube upload via API or CLI; env-gated.
- `risks`: medium — credentials; keep the logical `LocalExport` target as
  fallback so the pipeline never hard-blocks on absent creds.
- `acceptance`: with creds → real upload capability resolves; without → honest
  `unavailable` + logical fallback; pipeline still E2E-green.

## PHASE 10 — Cleanup (Phase 18)

- Remove: dead code, obsolete abstractions, duplicated systems, unused providers,
  fake implementations, unnecessary deps, temporary migration bridges.
- `affected`: grep for now-dead `gateway/*` direct calls, `pipelineStore` legacy
  bridge (once Control Center uses manifests directly), any leftover stubs that
  a real tool replaced.
- `acceptance`: `npm run typecheck` + `npm run build` + `npm test`
  (≥ current 112, ideally more); frontend build green; `git status` clean of
  temp files; project is **simpler**, not larger.

---

## Cross-phase risks & invariants

- **No giant rewrite.** Every phase is self-contained and ships green.
- **Honesty preserved throughout.** Any capability not proven stays `UNPROVEN` /
  `degraded` / `NOT_IMPLEMENTED`; never faked.
- **Determinism + HITL kept.** The orchestrator/state machine and approval gates
  remain the backbone (Phase 6/7 build on them).
- **Tests stay hermetic.** All media/compose/analyze go through injectable deps
  so CI needs no ffmpeg/Remotion/GPU.
- **Docs updated each phase** (ARCHITECTURE.md, PRODUCT.md, DECISIONS.md,
  DevRunbook.md) — this is part of the definition of done.
- **Backward compatibility of the store** — additive migrations only; existing
  dev DBs must keep loading (the pipeline reconciliation already exists and is
  extended, not replaced).

---

## Definition of "done" per phase (Phase 17)

After every major phase: `npm test` (backend), `npm run typecheck` (backend +
frontend), `npm run build` (backend + frontend), manual verification of the
affected flow, and documentation update. Only then the next phase begins.
