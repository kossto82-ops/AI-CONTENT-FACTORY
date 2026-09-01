# EXECUTIVE SUMMARY — AI Content Factory Architecture Audit

**Date:** 2026-09-01
**Auditor:** Architecture Analysis
**Scope:** 4 open-source video production repos vs. our Content Factory design

---

## TL;DR

After auditing Video Factory, OpenMontage, Multi-AI Video Factory, and AI Shorts Generator against our Content Factory architecture, **we recommend Option D: a hybrid architecture** that keeps our existing Node+TypeScript foundation and selectively adopts proven patterns and production-ready modules from OpenMontage and Video Factory.

**Our existing foundation is solid.** Phases 1-2 (Foundation + Control Center) are E2E-proven with working orchestration, job system, model gateway (OmniRoute), and React dashboard. The 4 audited repos are all Python-based and architecturally incompatible with our stack — forking any of them would mean rewriting everything we've built.

## Key Findings

| Finding | Detail |
|---------|--------|
| **Our orchestrator is more mature** | Our job state machine, approval gates, and pipeline-as-data are more robust than all 4 repos |
| **Our model gateway is unique** | None of the repos have anything like OmniRoute-based task routing with cost accounting |
| **We need video production code** | All 4 repos have FFmpeg/TTS/image-gen code we should adapt, not rewrite |
| **OpenMontage is the richest** | But AGPL-3.0 license makes it reference-only; its agent-as-orchestrator pattern conflicts with our deterministic design |
| **Video Factory has the best pipeline** | 9-stage pipeline with review gates, cost tracking, checkpointing — MIT license, adaptable patterns |
| **AI Shorts Generator has the best asset library** | SQLite + embedding-based clip reuse is exactly what we need — MIT license |
| **Multi-AI Video Factory is the simplest** | Windows-first, Ollama-native, minimal code — good reference for local LLM routing |

## What We Build vs. Reuse

| Build from scratch (our core) | Reuse/adapt from open source |
|-------------------------------|------------------------------|
| Orchestrator (already built) | FFmpeg video assembly patterns |
| Job system (already built) | TTS integration (Edge TTS, OpenAI TTS) |
| Model Gateway / OmniRoute (already built) | Image generation (fal.ai / SD) |
| Control Center UI (already built) | Subtitle/caption generation |
| Agent contracts + schemas (already built) | Asset library with embedding search |
| Pipeline definitions (already built) | Ken Burns / video animation |
| All agent logic (already built) | Review gate patterns (Video Factory) |

## Architecture Decision

**OPTION D — Hybrid architecture, building on our existing foundation.**

- Keep: Node+TypeScript, SQLite, Vite+React, OmniRoute
- Adopt conceptually: Video Factory's stage pipeline + review gates, AI Shorts Generator's clip library, OpenMontage's quality gate philosophy
- Adapt code: FFmpeg assembly, TTS, image gen, caption generation (from Python → TypeScript or spawn Python subprocess)
- Build: Visual Agent, Voice Agent, Assembly Agent, QA Agent (vision), Publisher Agent

## Cost Projection

- **Infrastructure:** $0 (local PC, SQLite, no Docker)
- **LLM:** $0.001-0.01/video via OmniRoute (routing to free/cheap models)
- **TTS:** $0 via Edge TTS (free) or ~$0.01 via OpenAI
- **Image gen:** $0.10-0.30/video via fal.ai Flux OR $0 via local SDXL
- **Total per video:** $0.00 (all-free) to $0.35 (with AI images)

## Risk Assessment

| Risk | Level | Mitigation |
|------|-------|------------|
| FFmpeg not installed | MEDIUM | Phase 5 prerequisite check, clear error messages |
| No GPU for local inference | LOW | All-free path via OmniRoute cloud routing |
| OmniRoute dependency | LOW | Adapter pattern allows direct provider fallback |
| AGPL contamination (OpenMontage) | N/A | We reference patterns, never import code |
| Scope creep | MEDIUM | Brain-first approach, MVP is text-only pipeline |

## Recommendation

**Start Phase 3 (Research + Script Agents) immediately** using our existing infrastructure. The first video production code (Phase 5-7) should reference Video Factory and AI Shorts Generator patterns but be implemented in TypeScript to maintain stack consistency.

The full audit (02-09) provides the evidence for every claim above.
