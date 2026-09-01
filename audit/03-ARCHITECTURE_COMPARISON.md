# ARCHITECTURE COMPARISON — Technical Deep Dive

## 1. Agent Architecture Analysis

### What is an "agent" in each repo?

| Repo | Agent Concept | Orchestrator | Agent Calls Other Agents? | LLM Decides Next Step? | Structured Schemas |
|------|---------------|-------------|---------------------------|------------------------|--------------------|
| **Video Factory** | Pipeline stage (function) | `factory.py` CLI | No (sequential) | No (deterministic) | Pydantic models |
| **OpenMontage** | External AI assistant | Agent itself (no code) | No (reads manifests) | Yes (agent decides) | JSON Schemas + YAML |
| **Multi-AI Video Factory** | LLM stage in pipeline | `pipeline.py` | No (sequential) | No (deterministic) | JSON extraction |
| **AI Shorts Generator** | Pipeline function | `produce.py` | No (sequential) | No (deterministic) | Pydantic models |
| **Content Factory** | Typed unit with contracts | Orchestrator (code) | No (orchestrator drives) | No (deterministic) | Zod schemas |

**Key insight:** None of the 4 repos implement true multi-agent systems with inter-agent communication. They're all sequential pipelines with LLM calls at each step. Our Content Factory is the most architecturally mature in this regard — typed agents with contracts, driven by a stateful orchestrator.

### Agent Scoring (0-5)

| Dimension | Video Factory | OpenMontage | Multi-AI VF | AI Shorts Gen | Content Factory |
|-----------|:---:|:---:|:---:|:---:|:---:|
| Agent definition | 2 (functions) | 4 (instruction-driven) | 1 (inline) | 2 (functions) | 4 (typed contracts) |
| Input/output contracts | 4 (Pydantic) | 3 (schemas) | 1 (freeform) | 3 (Pydantic) | 5 (zod + validation) |
| State management | 3 (filesystem) | 3 (checkpoints) | 1 (in-memory) | 2 (JSON files) | 5 (SQLite + state machine) |
| Inter-agent communication | 2 (files) | 3 (project dir) | 1 (variables) | 2 (files) | 4 (orchestrator-mediated) |
| Pluggability | 2 (hardcoded) | 4 (skills/tools) | 1 (hardcoded) | 2 (hardcoded) | 4 (registry) |
| **Overall** | **2.6** | **3.4** | **1.0** | **2.2** | **4.4** |

## 2. Orchestration Analysis

### Pipeline Comparison

| Feature | Video Factory | OpenMontage | Multi-AI VF | AI Shorts Gen | Content Factory |
|---------|:---:|:---:|:---:|:---:|:---:|
| Pipeline as data | No (code) | Yes (YAML) | No (code) | No (code) | Yes (TS data) |
| Sequential stages | Yes | Yes | Yes | Yes | Yes |
| Parallel stages | Yes (asyncio) | No | No | No | No |
| Approval gates | No (auto-review only) | Yes (per-stage) | No | No | Yes (typed) |
| Pause/Resume | Yes (CLI --stage) | Yes (checkpoints) | No | No | Yes (state machine) |
| Cancel | No | No | Yes (cancel flag) | No | Yes (CANCELLED state) |
| Retry | Yes (review gates) | Advisory (2 rounds) | No | No | Yes (max_retries) |
| State machine | No (stages_completed list) | No (status field) | No | No | Yes (transition tables) |
| Pipeline definitions | Hardcoded in code | YAML manifests | Hardcoded | Hardcoded | Data (configurable) |
| Mode (manual/semi/auto) | No | Implicit (approval_default) | No | No | Yes (per-agent) |

### Orchestration Scoring (0-5)

| Dimension | Video Factory | OpenMontage | Multi-AI VF | AI Shorts Gen | Content Factory |
|-----------|:---:|:---:|:---:|:---:|:---:|
| Pipeline abstraction | 2 | 4 | 1 | 1 | 4 |
| State machine | 1 | 2 | 0 | 0 | 5 |
| Resume/recovery | 3 | 3 | 0 | 0 | 4 |
| Approval gates | 0 | 4 | 0 | 0 | 4 |
| Retry logic | 3 | 2 | 0 | 0 | 4 |
| Cancellation | 0 | 0 | 1 | 0 | 4 |
| Human-in-the-loop | 2 | 4 | 1 | 2 | 5 |
| **Overall** | **1.6** | **2.7** | **0.3** | **0.4** | **4.3** |

## 3. Job System Analysis

### Job Abstraction Comparison

| Repo | Job Entity? | Persistence | Retries | Dependencies | Cost Tracking | Traces |
|------|:-----------:|:-----------:|:-------:|:------------:|:-------------:|:------:|
| Video Factory | No (workspace files) | Filesystem | Review loops only | No (sequential) | Yes (CostTracker) | Yes (AI traces) |
| OpenMontage | No (checkpoint JSON) | Filesystem | Advisory | No | Partial (snapshots) | Decision log |
| Multi-AI VF | In-memory dict | RAM only | No | No | No | Job logs (strings) |
| AI Shorts Gen | No (draft JSON) | Filesystem | No | No | No | No |
| **Content Factory** | **Yes (SQLite)** | **SQLite** | **Yes (max_retries)** | **Yes (dependencies)** | **Yes (per-execution)** | **Yes (event log)** |

**Verdict:** Our job system is architecturally superior to all 4 repos. The only repo with comparable tracking is Video Factory, but it lacks a persistent job entity.

## 4. Video Production Analysis

### Production Capabilities

| Capability | Video Factory | OpenMontage | Multi-AI VF | AI Shorts Gen | Content Factory (planned) |
|------------|:---:|:---:|:---:|:---:|:---:|
| Script generation | Gemini | Agent (any LLM) | Ollama/Groq/Mistral | OpenAI | OmniRoute (any) |
| Image generation | Gemini (Vertex) | 11 providers | AUTOMATIC1111 | fal.ai (Flux) / local SDXL | OmniRoute (FLUX) |
| Video generation | Remotion (animate) | 15 providers | No | fal.ai (Wan 2.2) | OmniRoute (future) |
| TTS | Gemini TTS | 5 providers | Edge TTS | OpenAI TTS | OmniRoute (any) |
| Music | Pre-selected pool | Suno / ElevenLabs | User-selected files | User-selected files | TBD |
| Subtitles | Word timestamps (STT) | Built-in | VTT (Edge TTS) | ASS karaoke (Whisper) | TBD |
| Composition | Remotion + FFmpeg | Remotion + HyperFrames + FFmpeg | FFmpeg only | FFmpeg only | TBD |
| Aspect ratios | 16:9 (configurable) | 8 profiles | 9:16 only | 9:16 only | 9:16 (shorts) |
| Character consistency | No | Partial (reference) | Style prompts | Clip library | Planned |
| Thumbnail generation | Yes (Gemini + review) | No | No | No | Planned |
| Watermark/branding | Optional | No | No | Yes (logo + disclaimer) | TBD |

### Video Assembly Patterns

| Pattern | Video Factory | OpenMontage | Multi-AI VF | AI Shorts Gen |
|---------|:---:|:---:|:---:|:---:|
| Ken Burns | Yes (smart crop) | Yes (camera motion) | Yes (sinusoidal) | Yes (6 presets) |
| Transitions | xfade (configurable) | Crossfade | Hard cut | Hard cut |
| Audio mixing | Narration + music + SFX | Multi-track | Voice + music (amix) | Voice + music (sidechaincompress) |
| Subtitle burn | Word-level (STT) | Auto-generated | VTT via FFmpeg | ASS karaoke |
| GPU encoding | NVENC (NVIDIA) | Configurable | libx264 | libx264 |
| Rendering engine | Remotion (per-section) | Remotion + HyperFrames | FFmpeg only | FFmpeg only |

## 5. Model / Provider Abstraction

### Abstraction Quality

| Repo | Provider Layer | Multi-provider? | Task routing? | Cost accounting? | OmniRoute compatible? |
|------|:--------------:|:---------------:|:-------------:|:----------------:|:--------------------:|
| Video Factory | None (Google SDK) | No | No | Yes (Google only) | **No** (replace all calls) |
| OpenMontage | Tool Registry | Yes (30+ providers) | Yes (selectors) | Partial | **Medium** (tool interface exists) |
| Multi-AI VF | String dispatch | Yes (3 providers) | Per-stage UI | No | **Low** (different protocol) |
| AI Shorts Gen | Direct SDKs | Yes (4 providers) | No | No | **Low** (direct SDK calls) |
| **Content Factory** | **Model Gateway** | **Yes (OmniRoute)** | **Yes (task→tier)** | **Yes (per-call)** | **Native** |

**OmniRoute Compatibility Ranking:**
1. Content Factory (native) — 5/5
2. OpenMontage (adaptable tool interface) — 3/5
3. Video Factory (would need full rewrite) — 1/5
4. Multi-AI VF (different paradigm) — 1/5
5. AI Shorts Gen (direct SDK) — 1/5

## 6. Cost Control Comparison

| Repo | Token Tracking | Per-call Cost | Per-video Total | Cost Limits | Budget Alerts |
|------|:--------------:|:-------------:|:---------------:|:-----------:|:-------------:|
| Video Factory | Yes (per API call) | Yes (pricing catalog) | Yes (cost_estimate.json) | No | No |
| OpenMontage | Partial (snapshots) | No (provider scores) | Per-checkpoint | Budget mode (observe/warn/cap) | Yes |
| Multi-AI VF | No | No | No | No | No |
| AI Shorts Gen | No | No | Rough estimates in README | No | No |
| **Content Factory** | **Yes (per-execution)** | **Yes (Gateway)** | **Yes (rollup)** | **Planned** | **Planned** |

## 7. Control Center / UI Comparison

| Feature | Video Factory | OpenMontage | Multi-AI VF | AI Shorts Gen | Content Factory |
|---------|:---:|:---:|:---:|:---:|:---:|
| Dashboard | HTML report | Backlot (SSE) | Single-page HTML | Flask app | React + Tailwind |
| Job monitoring | Pipeline log | Filesystem watch | In-memory poll | Background thread | REST API + polling |
| Pipeline visualization | HTML report | Board (rail order) | No | No | Yes (planned) |
| Approval UI | CLI flag | Chat-based | No | Flask approve | React approve/reject |
| Agent status | AI trace report | Board stages | No | No | Per-agent card |
| Cost display | HTML cost report | Cost meter | No | No | Per-job cost |
| Execution history | Workspace dirs | History/ folder | No | No | SQLite + events |
| Tech stack | Static HTML | Python SSE server | Vanilla JS | Flask + Jinja | Vite + React + Tailwind |

**Verdict:** Our Control Center is the most architecturally mature (typed API, React SPA). Multi-AI VF and AI Shorts Gen have basic functional UIs. OpenMontage's Backlot is innovative but filesystem-coupled. Video Factory has no runtime UI.

## 8. Data Model Comparison

| Concept | Video Factory | OpenMontage | Multi-AI VF | AI Shorts Gen | Content Factory |
|---------|:---:|:---:|:---:|:---:|:---:|
| Project | Channel config + workspace | Project directory | pack.json | output/{slug}/ | Content entity |
| Idea | plan.json | Research stage output | Topic input | topics.txt | Content (IDEA) |
| Script | script.json (Pydantic) | Script artifact | stage3 output | Script (Pydantic) | Script artifact (versioned) |
| Scene | ScriptSection + VisualSlot | Scene plan artifact | Scene in JSON | Scene (Pydantic) | Scene (in Script) |
| Asset | images/, audio/, videos/ | assets/ manifest | images/, clips/ | library/ (SQLite) | Artifact (versioned) |
| Job | checkpoint.json | Checkpoint per stage | In-memory dict | Draft JSON | SQLite Job table |
| Execution | ai_trace_report.json | events.jsonl | No | No | SQLite Execution table |
| Agent | Stage function | Skill (Markdown) | LLM stage | Pipeline function | SQLite Agent table |
| Pipeline | Hardcoded stages | YAML manifest | Hardcoded | Sequential code | SQLite Pipeline table |
| Video | MP4 in workspace | renders/final.mp4 | final_video.mp4 | output/{slug}/final.mp4 | TBD |
| Publication | YouTube metadata JSON | Publish stage | No | Per-platform copy | TBD |

## 9. Technology Stack Comparison

| Component | Video Factory | OpenMontage | Multi-AI VF | AI Shorts Gen | Content Factory |
|-----------|:---:|:---:|:---:|:---:|:---:|
| Language | Python 3.11+ | Python 3.10+ | Python 3.10 | Python 3.10+ | **TypeScript** |
| Backend | Script/CLI | Agent (no backend) | FastAPI | Flask + CLI | **Node (node:http)** |
| Frontend | Static HTML report | Backlot (SSE) | Vanilla JS SPA | Flask/Jinja | **Vite + React** |
| Database | None (filesystem) | None (filesystem) | None (in-memory) | SQLite (library only) | **SQLite (node:sqlite)** |
| Queue | asyncio | None | threading | threading | **In-process events** |
| AI framework | google-genai SDK | Custom tool system | Raw HTTP | OpenAI SDK + fal_client | **OmniRoute adapter** |
| Video engine | Remotion + FFmpeg | Remotion + HyperFrames + FFmpeg | FFmpeg | FFmpeg | **TBD (FFmpeg + ?)** |
| TTS | Gemini TTS | 5 providers | Edge TTS | OpenAI TTS | **OmniRoute (any)** |
| Image gen | Gemini image | 11 providers | AUTOMATIC1111 | fal.ai / local SDXL | **OmniRoute (FLUX)** |
| Package mgr | pip | make + pip | pip | pip | **npm** |
| Test framework | None visible | pytest | None | None | **vitest** |

## 10. Windows / Local-First Compatibility

| Factor | Video Factory | OpenMontage | Multi-AI VF | AI Shorts Gen | Content Factory |
|--------|:---:|:---:|:---:|:---:|:---:|
| Windows support | Yes (noted in README) | Partial (npm issues) | **Native (PS1 scripts)** | Yes (start.bat) | **Native** |
| Docker required | No | No | No | No | No |
| Linux required | No | Partial | No | No | No |
| GPU required | Optional (NVENC) | Optional (local video) | Recommended (SD) | Optional (SDXL) | No |
| VRAM needed | N/A without GPU | 4-14GB for local gen | 6GB+ for SD | 6GB+ for SDXL | N/A |
| External services | Vertex AI (required) | Multiple (all optional) | All optional | OpenAI (required for full) | OmniRoute (local) |
| Local-first | No (GCP required) | Yes (free path exists) | **Yes (Ollama)** | Partial (OpenAI for script) | **Yes** |
| Free path | No | Yes (Piper + stock) | Yes (Ollama + A1111) | Partial (Edge TTS + stock) | **Yes (OmniRoute free tier)** |

## 11. Security Analysis

| Concern | Video Factory | OpenMontage | Multi-AI VF | AI Shorts Gen | Content Factory |
|---------|:---:|:---:|:---:|:---:|:---:|
| API keys storage | .env (gcloud ADC) | .env | .env | .env | .env |
| Auth | GCP IAM | None | None | None | Planned |
| Exposed endpoints | None (CLI only) | None (local) | FastAPI (localhost) | Flask (localhost) | CORS (localhost) |
| Secrets in code | No | No | No | No | No |
| Arbitrary code exec | No | No (tools run Python) | No | No | No |
| Generated content | Not validated | Quality gates | No validation | No validation | QA Agent |

**Common risk:** All repos use `.env` for secrets, which is appropriate for local-first tools. No repo has authentication — acceptable for local use.

## 12. Performance Characteristics

| Aspect | Video Factory | OpenMontage | Multi-AI VF | AI Shorts Gen |
|--------|:---:|:---:|:---:|:---:|
| Async I/O | Yes (asyncio) | Tool-level | No (threading) | No (threading) |
| Parallel execution | Yes (image/audio) | No | No | No |
| Concurrency control | Semaphore(6) | N/A | N/A | N/A |
| Caching | Fixture replay | N/A | N/A | Library (embeddings) |
| Asset reuse | Content-hash dedup | N/A | N/A | **Embedding-based reuse** |
| Rendering parallelism | Yes (Remotion sections) | N/A | No | No |

**Parallelization opportunities we can adopt:**
- Scene-level parallel visual generation (Video Factory pattern)
- Embedding-based asset reuse to skip generation (AI Shorts Generator pattern)
- Fixture/caching for zero-cost replays (Video Factory pattern)

## 13. Comparative Score Table (0-5)

| Area                    | Video Factory | OpenMontage | Multi-AI VF | AI Shorts Gen | Content Factory |
| ----------------------- | :-----------: | :---------: | :---------: | :-----------: | :-------------: |
| **Architecture**        | 3             | 4           | 1           | 2             | **5**           |
| *VF: solid pipeline but no agent abstraction. OM: innovative but agent-as-orchestrator. CAF: typed agents + state machine + gateway* |
| **Agents**              | 2             | 4           | 1           | 2             | **5**           |
| *VF: functions. OM: instruction-driven. CAF: typed contracts + registry + Zod validation* |
| **Orchestration**       | 2             | 3           | 1           | 1             | **5**           |
| *VF: CLI stage runner. OM: agent-driven. CAF: full state machine + approval gates + modes* |
| **Jobs**                | 2             | 2           | 1           | 1             | **5**           |
| *VF: checkpoint.json. OM: checkpoint JSON. CAF: full SQLite job entity with retries + traces* |
| **HITL**                | 2             | 4           | 1           | 2             | **5**           |
| *VF: --allow-review-failures. OM: per-stage gates. CAF: typed approval objects + approve/reject/edit* |
| **Video**               | **5**         | **5**       | 2           | 4             | 0 (planned)     |
| *VF: 9-stage full pipeline. OM: 100+ tools. CAF: not yet implemented* |
| **Assets**              | 2             | 3           | 1           | **5**         | 0 (planned)     |
| *VF: workspace files. OM: project workspace. ASG: SQLite + embeddings + cosine search* |
| **Provider abstraction** | 1            | **5**       | 2           | 2             | **4**           |
| *VF: Google-only. OM: 30+ providers with selectors. CAF: OmniRoute + task routing* |
| **OmniRoute compat**   | 1             | 3           | 1           | 1             | **5**           |
| *CAF: native. All others: would need significant refactoring* |
| **Control Center**      | 1             | 3           | 2           | 3             | **4**           |
| *VF: HTML report only. OM: Backlot (SSE). ASG: Flask. CAF: React + REST API* |
| **Observability**       | **4**         | 3           | 1           | 1             | **4**           |
| *VF: AI traces + cost report. CAF: event bus + execution table* |
| **Cost tracking**       | **4**         | 2           | 0           | 1             | **4**           |
| *VF: CostTracker + pricing catalog. CAF: per-execution in SQLite* |
| **Local-first**         | 2             | 3           | **5**       | 3             | **5**           |
| *Multi-AI VF: Ollama native. CAF: OmniRoute local. VF: GCP required* |
| **Windows**             | 3             | 2           | **5**       | 4             | **5**           |
| *Multi-AI VF: native PS1. CAF: native. OM: Makefile issues* |
| **Simplicity**          | 3             | 2           | **5**       | 4             | 3               |
| *Multi-AI VF: 6 files, 1100 LOC. Simplest by far* |
| **Extensibility**       | 2             | **5**       | 1           | 2             | 4               |
| *OM: 100+ tools, plugin-like architecture. CAF: typed registry* |
| **Documentation**       | 3             | **5**       | 3           | 3             | 3               |
| *OM: 700+ skill files, AGENT_GUIDE, CONTRIBUTING. Best docs* |
| **License**             | **5 (MIT)**   | 1 (AGPL)    | **5 (MIT)** | **5 (MIT)**   | N/A (ours)      |
| *OM's AGPL is a dealbreaker for code reuse* |

### Score Explanation for Key Areas

**Architecture (Video Factory = 3):** Solid 9-stage pipeline with review gates, but no agent abstraction — stages are hardcoded functions, not pluggable units. No database, no job system.

**Architecture (OpenMontage = 4):** Innovative agent-as-orchestrator with YAML manifests and 100+ tools. But no persistence layer, no REST API, no job system. Losing 1 point for being 2 commits old and architecturally incompatible with deterministic orchestration.

**Architecture (Content Factory = 5):** Typed agents with Zod contracts, SQLite state machine, OmniRoute gateway, approval gates, pipeline-as-data, event bus. The most complete *platform* architecture, even though production agents aren't built yet.

**Provider Abstraction (OpenMontage = 5):** 30+ providers across image/video/TTS/music, auto-discovery, 7-dimension scoring selectors. Best provider abstraction of any open-source project in this space.

**Provider Abstraction (Content Factory = 4):** OmniRoute-native with task-based routing. Losing 1 point because Edge TTS and Pexels aren't OmniRoute-routable (need direct adapters).

**Assets (AI Shorts Generator = 5):** SQLite + embeddings + cosine similarity + usage tracking + recency window + match-then-generate. The only repo with a real asset reuse system.

## 14. Final Decision

### OPTION D — Hybrid Architecture

**Decision:** Build on our existing foundation, adopt patterns and adapt code from open-source repos.

**Justification:**

1. **Our foundation is stronger.** No repo matches our orchestrator, job system, model gateway, or Control Center. Forking any repo would mean rewriting everything we've built for zero gain.

2. **The repos excel at production.** Video Factory's review gates, AI Shorts Generator's asset library, and OpenMontage's provider ecosystem are excellent *reference implementations* for the production phases we haven't built yet.

3. **Our stack is incompatible.** All 4 repos are Python; we're TypeScript. Importing Python code adds runtime complexity with no architectural benefit (our AI calls go through OmniRoute HTTP, not Python SDKs).

4. **License safety.** OpenMontage's AGPL makes it reference-only. The other 3 are MIT but their code is tightly coupled to their specific architectures.

5. **Cost optimization.** Our OmniRoute integration gives us provider independence that none of the repos have. Combined with free-path tools (Edge TTS, FFmpeg, stock footage), we achieve cost ≈ 0 while maintaining the ability to swap providers.

**What we take:**
- Video Factory → review gate engine pattern, cost tracking pattern, workspace/checkpoint pattern
- AI Shorts Generator → clip library architecture, Ken Burns presets, ASS karaoke captions
- OpenMontage → quality gate philosophy (blocking, not advisory), provider selector scoring concept
- Multi-AI VF → Windows PowerShell setup patterns, Ollama auto-discovery, simple prompt templates

**What we don't take:**
- Any Python code (we're TypeScript)
- Any AGPL code (OpenMontage)
- Remotion/HyperFrames (defer to Phase 7+ if needed)
- AUTOMATIC1111 (OmniRoute replaces it)
- Flask (we have React)
- In-memory state (we have SQLite)
