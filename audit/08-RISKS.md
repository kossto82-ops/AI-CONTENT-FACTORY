# RISKS — Risks and Critical Decisions

## 1. Critical Decisions

### D-1: Language — Keep TypeScript (not Python)

**Decision:** Stay with TypeScript for all backend code.
**Impact:** HIGH | **Reversibility:** LOW

**For:**
- All Phase 1-2 code is TypeScript, working and tested
- Stack consistency (frontend + backend = one language)
- Type safety via Zod schemas for agent contracts
- OmniRoute integration is HTTP-based (no Python SDK advantage)

**Against:**
- Python has richer AI/ML ecosystem (but we route through OmniRoute HTTP)
- Video Factory, OpenMontage, Multi-AI VF, AI Shorts Gen are all Python
- faster-whisper is Python (subprocess dependency)

**Verdict:** KEEP TypeScript. Python subprocess for edge-tts and faster-whisper is acceptable.

### D-2: FFmpeg — Install and Use Subprocess

**Decision:** Install FFmpeg on Windows PATH and call via child_process.
**Impact:** HIGH | **Reversibility:** HIGH

**For:**
- Universal, battle-tested video engine
- All 4 repos use FFmpeg
- Ken Burns, subtitle burn-in, audio mixing all native FFmpeg
- Free, open source

**Against:**
- FFmpeg not currently installed
- Windows PATH setup can be finicky
- Subprocess management adds complexity

**Mitigation:** Phase 5 includes a prerequisite check (like Multi-AI VF's `check-prereqs.ps1`).

### D-3: OmniRoute as Single Gateway

**Decision:** All AI calls route through OmniRoute; no direct provider SDK calls.
**Impact:** HIGH | **Reversibility:** MEDIUM

**For:**
- Provider independence (swap models without code changes)
- Task-based routing (agents name capabilities, not models)
- Cost accounting at a single choke point
- Already working and verified

**Against:**
- Single point of failure (OmniRoute must be running)
- Some providers (Edge TTS, Pexels) aren't OmniRoute-routable
- OmniRoute may not support all needed modalities

**Mitigation:** Adapter pattern allows adding direct providers as fallbacks. Edge TTS + Pexels are always direct calls (not LLM-dependent).

### D-4: Python Subprocess vs. Native Node Libraries

**Decision:** Use Python subprocess for Edge TTS and faster-whisper; native Node for everything else.
**Impact:** MEDIUM | **Reversibility:** HIGH

**Options:**
1. Python subprocess (recommended) — proven, free, already have Python
2. Node wrapper libraries (e.g., `edge-tts` npm) — may not exist or be maintained
3. OmniRoute for TTS — adds cost

**Verdict:** Python subprocess is the pragmatic choice. The dependency is minimal (just `pip install edge-tts faster-whisper`) and Python 3.14 is already installed.

## 2. Technical Risks

### R-1: FFmpeg Not Installed
**Probability:** HIGH (confirmed: NOT installed)
**Impact:** MEDIUM (blocks Phase 7 Assembly)
**Mitigation:** Phase 5 includes installation step. Document in DevRunbook. Verify in startup health check.

### R-2: OmniRoute Downtime
**Probability:** LOW (local service, always available per rules)
**Impact:** HIGH (blocks all AI calls)
**Mitigation:** 
- Adapter pattern allows direct provider fallback
- Job retry on transient errors
- Health check at pipeline start

### R-3: No GPU for Local Inference
**Probability:** MEDIUM (depends on user's hardware)
**Impact:** LOW (all-free path uses OmniRoute cloud)
**Mitigation:** Default to cloud-based models via OmniRoute. Local GPU is optional enhancement.

### R-4: Agent Output Quality
**Probability:** MEDIUM (LLM output varies)
**Impact:** MEDIUM (bad script → bad video)
**Mitigation:**
- Review gate engine (adapted from Video Factory)
- Human-in-the-loop approval at every creative step
- QA Agent scores and rejects low-quality output
- Retry with feedback loop

### R-5: Cost Runaway
**Probability:** LOW (OmniRoute + free models)
**Impact:** MEDIUM (unexpected API bills)
**Mitigation:**
- Per-call cost tracking (already implemented)
- Task routing prefers cheap/free tiers by default
- Future: configurable cost caps per pipeline
- Budget mode from OpenMontage concept (observe → warn → cap)

### R-6: Audio Processing Complexity
**Probability:** MEDIUM (FFmpeg filters are tricky)
**Impact:** MEDIUM (bad audio = bad video)
**Mitigation:**
- Start with simple narration-only (no music mixing)
- Add music in Phase 7, not Phase 6
- Use battle-tested FFmpeg filter chains from audited repos

### R-7: Subtitle Timing Accuracy
**Probability:** MEDIUM (Whisper timestamps aren't perfect)
**Impact:** LOW (cosmetic issue)
**Mitigation:**
- faster-whisper with VAD filter for better segmentation
- Post-processing alignment with original script (AI Shorts Generator pattern)
- Human review via Control Center

### R-8: Embedding Quality for Asset Library
**Probability:** MEDIUM (text-embedding-3-small may not capture visual similarity)
**Impact:** LOW (worst case: more cache misses, more generation)
**Mitigation:**
- Start with text-based embeddings (prompt → search)
- Add CLIP embeddings later for visual similarity
- Manual curation via dashboard

## 3. Organizational Risks

### R-9: Scope Creep
**Probability:** HIGH (ambitious vision)
**Impact:** HIGH (never ships)
**Mitigation:**
- Brain-first approach: Phase 3-4 are text-only
- MVP proves orchestration before video
- Each phase is independently valuable
- 15 agents listed in vision → start with 4, add only when needed

### R-10: Premature Optimization
**Probability:** MEDIUM
**Impact:** MEDIUM (overengineered before proven)
**Mitigation:**
- Follow existing decisions in DECISIONS.md
- "No new infra unless it earns its place"
- SQLite until it hurts, then Postgres
- In-process events until multi-service

### R-11: Open Source License Contamination
**Probability:** LOW (we're careful)
**Impact:** HIGH (if it happens)
**Mitigation:**
- Never import code from AGPL repos (OpenMontage)
- Study patterns, implement in our stack
- MIT repos (Video Factory, Multi-AI VF, AI Shorts Gen) are safe for reference
- Always check licenses before adapting code patterns

## 4. Open Questions

| Question | Decision Needed | Impact |
|----------|----------------|--------|
| FFmpeg installation method? | winget vs manual download | Phase 5 setup |
| Edge TTS vs OpenAI TTS default? | Free vs premium default | Phase 6 cost |
| faster-whisper via Python subprocess? | Local vs API | Phase 6 dependency |
| Asset library embeddings model? | text-embedding-3-small vs CLIP | Phase 5 quality |
| Ken Burns presets count? | 4-6 presets (from AI Shorts Gen) | Phase 7 variety |
| Music handling: user files only? | Simplest approach for MVP | Phase 7 scope |
| Remotion needed at all? | Defer decision to Phase 7 | Phase 7 complexity |
| YouTube API for publishing? | Yes (Phase 9) vs manual | Phase 9 scope |

## 5. Risk Matrix

| Risk | Probability | Impact | Score | Priority |
|------|:-----------:|:------:|:-----:|:--------:|
| R-9 Scope creep | HIGH | HIGH | **9** | **CRITICAL** |
| R-1 OmniRoute downtime | LOW | HIGH | **4** | MEDIUM |
- R-4 Agent output quality | MEDIUM | MEDIUM | **4** | MEDIUM |
| R-10 Premature optimization | MEDIUM | MEDIUM | **4** | MEDIUM |
| R-11 License contamination | LOW | HIGH | **4** | MEDIUM |
| R-6 Audio complexity | MEDIUM | MEDIUM | **4** | MEDIUM |
| R-3 No GPU | MEDIUM | LOW | **2** | LOW |
| R-5 Cost runaway | LOW | MEDIUM | **2** | LOW |
| R-2 FFmpeg not installed | HIGH | MEDIUM | **3** | MEDIUM |
| R-7 Subtitle timing | MEDIUM | LOW | **2** | LOW |
| R-8 Embedding quality | MEDIUM | LOW | **2** | LOW |
