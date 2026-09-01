# REUSE MATRIX — What to Use, Adapt, Study, or Build

## 1. Component-Level Reuse Matrix

| Component | Video Factory | OpenMontage | Multi-AI VF | AI Shorts Gen | Decision |
|-----------|:---:|:---:|:---:|:---:|:---:|
| **Orchestrator** | Study (stage runner) | Study (manifest-driven) | Study (simple) | Study (sequential) | **BUILD** — ours is more mature |
| **Agent runtime** | Study (function-based) | Study (instruction-driven) | — | Study (function-based) | **BUILD** — ours has typed contracts |
| **Job system** | Study (checkpoint) | Study (checkpoint) | — | — | **BUILD** — ours has SQLite + state machine |
| **Pipeline** | Study (9-stage) | Study (14 YAML manifests) | Study (4-stage) | Study (6-stage) | **BUILD** — ours is data-driven |
| **Control Center** | Study (HTML report) | Study (Backlot) | Study (single-page) | Adapt (Flask→React) | **BUILD** — ours is React+REST |
| **Research Agent** | Study (Gemini planning) | Study (web research stage) | — | Study (topic backlog) | **BUILD** — ours has typed contract |
| **Script Agent** | Adapt (prompt patterns) | Study (skill-driven) | Adapt (multi-stage LLM) | Adapt (structured output) | **BUILD** + adapt prompt patterns |
| **Director Agent** | Study (visual slot system) | Study (scene_plan) | — | Study (Scene model) | **BUILD** — ours has typed contract |
| **Visual Agent** | Adapt (image_sourcer) | Adapt (tool registry) | Adapt (A1111) | Adapt (library + fal) | **ADAPT** — combine patterns |
| **Voice Agent** | Study (Gemini TTS) | Study (5 providers) | Adapt (Edge TTS) | Adapt (OpenAI TTS) | **ADAPT** — Edge TTS + OmniRoute |
| **Assembly Agent** | Adapt (FFmpeg assemble) | Study (3 engines) | Adapt (FFmpeg render) | Adapt (FFmpeg assembly) | **ADAPT** — FFmpeg patterns |
| **QA Agent** | Study (review gate engine) | Study (quality gates) | — | — | **BUILD** + study review patterns |
| **Asset Library** | Study (workspace artifacts) | Study (project workspace) | — | **Adopt** (clip library) | **ADAPT** — AI Shorts Gen pattern |
| **Publisher Agent** | Study (metadata) | Study (publish stage) | — | Adapt (per-platform copy) | **BUILD** |
| **Analytics** | Study (cost reports) | Study (cost meter) | — | — | **BUILD** |
| **Model Gateway** | — | Study (tool registry) | Study (provider routing) | — | **BUILD** — ours is OmniRoute-native |
| **Review Gates** | **Adopt** (reviewer.py) | Study (reviewer protocol) | — | — | **ADAPT** — VF patterns to TS |
| **Cost Tracking** | **Adopt** (costs.py) | Study (budget mode) | — | — | **ADAPT** — VF patterns to TS |
| **Checkpointing** | **Adopt** (workspace pattern) | Study (checkpoint protocol) | — | Study (draft JSON) | **ADAPT** — VF + our SQLite |
| **Prompt System** | **Adopt** (prompt templates) | Study (3-layer skills) | Study (per-category) | Study (presets) | **ADAPT** — VF templates + preset pattern |
| **FFmpeg Ken Burns** | Study | Study | Adapt (sinusoidal) | Adapt (6 presets) | **ADAPT** — combine presets |
| **Subtitle Gen** | Study (STT timestamps) | Study | Study (VTT) | **Adopt** (Whisper→ASS) | **ADAPT** — AI Shorts Gen karaoke |
| **TTS Integration** | Study (Gemini) | Study (5 providers) | Adapt (Edge TTS subprocess) | Adapt (OpenAI streaming) | **ADAPT** — Edge TTS (free) + OmniRoute |
| **Image Sourcing** | Adapt (multi-source) | Adapt (tool registry) | Adapt (A1111 HTTP) | Adapt (fal/local) | **ADAPT** — OmniRoute + stock |
| **Music Integration** | Study (pool selection) | Study (Suno/ElevenLabs) | Study (user files) | Study (sidechaincompress) | **ADAPT** — user files + sidechain |

## 2. Concept-Level Reuse

### From Video Factory — ADOPT
1. **Review gate engine** — universal `review_gate()` with configurable attempts, feedback loops, and structured scoring
2. **Cost tracking** — `CostTracker` with ContextVar-based stage binding, pricing catalog, per-run reports
3. **Workspace pattern** — timestamped output directories with checkpoint.json for resume
4. **Fixture/caching system** — deterministic replay for zero-cost development
5. **Visual slot system** — LLM defines visual slots with sourcing policies; pipeline sources accordingly
6. **Multi-source image dispatch** — Serper/Pexels/AI gen with fallback chains
7. **Prompt scaffold pattern** — `_prompt_scaffold(task, rules, examples, schema, input_block)` for structured prompts

### From OpenMontage — STUDY (reference only, AGPL prevents code reuse)
1. **Agent-as-orchestrator paradigm** — interesting but conflicts with our deterministic design
2. **YAML pipeline manifests** — declarative pipeline definitions with stages, tools, review criteria
3. **Three-layer knowledge architecture** — tools + skills + vendor knowledge
4. **Provider selector scoring** — 7-dimension provider ranking (task fit, quality, cost, latency, etc.)
5. **Backlot storyboard** — filesystem-derived live board with SSE updates
6. **Style playbooks** — YAML-defined visual language (typography, color, motion, audio)
7. **Quality gate philosophy** — blocking gates, not advisory; every creative decision logged
8. **Pre-compose validation** — blocks render when plan is broken

### From Multi-AI Video Factory — STUDY + ADAPT
1. **Windows PowerShell setup** — `setup.ps1`, `run-web.ps1`, `check-prereqs.ps1`
2. **Ollama auto-discovery** — `GET /api/tags` for dynamic model listing
3. **Multi-provider LLM routing** — string spec `"provider:model"` with per-stage selection
4. **Prompt template engine** — mustache-style `{{var}}` substitution
5. **Edge TTS integration** — free TTS via subprocess (MP3 + VTT in one call)

### From AI Shorts Generator — ADOPT + ADAPT
1. **Clip library architecture** — SQLite + embeddings + cosine similarity for asset reuse
2. **Match-then-generate pattern** — search library first, generate only on miss
3. **Ken Burns presets** — 6 cycling zoom/pan directions for visual variety
4. **ASS karaoke captions** — word-level coloring with spelling correction
5. **Sidechaincompress audio ducking** — music automatically ducks under narration
6. **Scriptwriter presets** — swappable personality via Markdown files
7. **Draft persistence** — JSON files for workflow state

## 3. What NOT to Reuse

| Item | From Repo | Why NOT |
|------|-----------|---------|
| OpenMontage code | OpenMontage | AGPL-3.0 copyleft — any derivative must be AGPL |
| Gemini-only client | Video Factory | Locks us to Google; our Gateway is provider-agnostic |
| AUTOMATIC1111 integration | Multi-AI VF | Requires separate A1111 server; OmniRoute handles image gen |
| Flask dashboard | AI Shorts Gen | We already have React; Flask → React migration = wasted effort |
| In-memory job dict | Multi-AI VF | No persistence, no recovery, not production-grade |
| Python pipeline code | All 4 repos | We're TypeScript; Python would add runtime complexity |
| Remotion rendering | Video Factory, OpenMontage | Requires Node.js + React rendering pipeline; defer to Phase 7 |
| HyperFrames | OpenMountage | Requires Node 22+; complex GSAP dependency; defer |
| Character animation (ink-theater) | OpenMontage | Overly complex for MVP; defer to Phase 11+ |
| Talking head / lip sync | OpenMontage | Requires GPU + specialized models; defer |

## 4. Priority Order for Adaptation

### Phase 3-4 (Immediate — brain-only)
1. Script prompt patterns from Video Factory (`prompts.py` scaffold pattern)
2. Multi-provider LLM routing concept from Multi-AI VF (adapt to our Gateway tiers)
3. Scriptwriter presets from AI Shorts Generator

### Phase 5 (Visual Agent)
4. Clip library architecture from AI Shorts Generator (SQLite + embeddings)
5. Match-then-generate pattern from AI Shorts Generator
6. Multi-source image dispatch from Video Factory
7. Stock footage fetching from AI Shorts Generator (Pexels/Pixabay)

### Phase 6 (Voice Agent)
8. Edge TTS integration from Multi-AI VF (free, subprocess-based)
9. Word-level timestamps from Video Factory (STT approach) or AI Shorts Generator (Whisper)
10. Sidechaincompress ducking from AI Shorts Generator

### Phase 7 (Assembly Agent)
11. FFmpeg assembly patterns from Video Factory (xfade, concat, audio mix)
12. Ken Burns presets from AI Shorts Generator
13. ASS karaoke captions from AI Shorts Generator
14. Subtitle styling patterns

### Phase 8 (QA Agent)
15. Review gate engine from Video Factory (adaptable, structured scoring)
16. Quality gate philosophy from OpenMontage (blocking, not advisory)
17. Cost tracking from Video Factory (CostTracker pattern)

### Phase 9+ (Publisher, Analytics)
18. Metadata generation patterns from Video Factory
19. Per-platform copy from AI Shorts Generator
20. Cost reporting from Video Factory
