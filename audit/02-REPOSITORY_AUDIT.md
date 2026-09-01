# REPOSITORY AUDIT — Detailed Analysis

## 1. Video Factory (NesDevr/video-factory)

**URL:** https://github.com/NesDevr/video-factory
**Stars:** 0 | **Forks:** 0 | **Commits:** 4 | **License:** MIT
**Language:** Python 3.11+ | **Stack:** Gemini (Vertex AI), Remotion, FFmpeg, Pydantic, httpx

### Architecture
Linear 9-stage pipeline orchestrated by a single `factory.py` script:

```
planning → script → [image_source || audio_source] → process → render_sections → assemble → thumbnail → final_review
```

Key design: stages run sequentially via a CLI (`factory.py --channel X --stage Y`), with `asyncio` concurrency for image/audio sourcing.

### Repository Structure
```
video-factory/
├── factory.py              # CLI entry + pipeline orchestrator (~500 LOC)
├── settings.py             # Pydantic settings (env-driven)
├── clients.py              # Google Vertex AI client (text, vision, image, TTS)
├── prompts.py              # 1,164 lines of prompt templates
├── core/
│   ├── scripter.py         # Script gen + review loop
│   ├── image_sourcer.py    # Multi-source image acquisition + review
│   ├── audio_sourcer.py    # TTS + STT word timestamps + music
│   ├── processor.py        # Smart crop, face detect, resize
│   ├── render_sections.py  # Remotion per-section rendering
│   ├── assembler.py        # FFmpeg concat + xfade + audio mix
│   ├── thumbnailer.py      # Thumbnail gen + review
│   ├── reviewer.py         # Universal review gate engine
│   ├── costs.py            # Cost tracking (per-run, per-stage)
│   └── utils.py            # Pydantic models, file I/O
├── config/channels/        # Per-channel JSON configs
├── config/pricing/         # Google AI pricing catalog
├── rendering/remotion/     # React/Remotion rendering engine
├── assets/overlays/        # Static assets
├── tools/                  # Log viewer, GCP cost reconciliation
└── workspace/              # Runtime output (per-run directories)
```

### Provider Abstraction
**Single provider: Google Vertex AI (Gemini).** No abstraction layer — direct SDK calls:
- `generate_text()` → Gemini Pro
- `generate_json()` → Gemini Pro (JSON mode)
- `review_with_vision()` → Gemini Flash
- `generate_image_gemini()` → Gemini image gen
- `generate_speech()` → Gemini TTS

**OmniRoute compatibility: LOW.** Would require replacing all `genai.Client` calls with Gateway calls. No adapter pattern exists.

### Checkpointing / State
- Workspace-based: each run creates `workspace/{channel}_{timestamp}_{uuid}/`
- `checkpoint.json` tracks completed stages, timings, review log, errors
- Resume via `--stage` flag (skips completed stages)
- All artifacts are JSON files in the workspace directory

### Review Gates (4 gates)
1. **Script review** — 10-criteria scoring, auto-regeneration with feedback loop (up to 3 attempts)
2. **Image review** — Vision-based per-image assessment (1 attempt, no auto-fix)
3. **Thumbnail review** — AI gen + vision check (2 attempts)
4. **Final review** — Frame extraction + full package review (1 attempt)

### Cost Tracking
- `CostTracker` with `ContextVar`-based stage/operation binding
- Per-call AI traces (model, tokens, cost, latency)
- Pricing catalog in `config/pricing/google_ai_pricing.json`
- Output: `reports/cost_estimate.json` + HTML report
- GCP billing reconciliation tool

### Strengths
- Complete production pipeline from topic to MP4
- Excellent review gate system with structured feedback
- Per-call cost tracking with real pricing data
- Fixture/caching system for zero-cost replays
- Remotion-based animated sections with Ken Burns
- Word-level timestamps for subtitles
- Robust error handling with graceful degradation

### Weaknesses
- **Google-only**: tightly coupled to Vertex AI (Gemini)
- **No agent abstraction**: stages are functions, not pluggable agents
- **No persistence**: workspace files only, no database
- **No web UI**: CLI only
- **Single-provider TTS**: Gemini TTS only
- **No clip library**: generates everything fresh each time
- **Young project**: 4 commits, 0 stars

### Reuse Potential: HIGH
- Review gate engine pattern (`core/reviewer.py`)
- Cost tracking pattern (`core/costs.py`)
- Checkpoint/workspace pattern
- FFmpeg assembly patterns (`core/assembler.py`)
- Prompt engineering patterns (`prompts.py`)
- Image sourcing multi-provider dispatch

---

## 2. OpenMontage (yunfei-DONNli/openmontage)

**URL:** https://github.com/yunfei-DONNli/openmontage
**Stars:** 0 (but was #1 trending) | **Forks:** 0 | **Commits:** 2 | **License:** AGPL-3.0
**Language:** Python 3.10+ | **Stack:** Multi-provider, Remotion, HyperFrames, FFmpeg, Piper TTS

### Architecture
**Agent-as-orchestrator pattern**: The AI coding assistant IS the orchestrator. Python provides only tools and persistence. Orchestration logic lives in YAML manifests + Markdown skills.

```
Agent reads pipeline manifest (YAML) → reads stage director skill (Markdown)
→ calls Python tools → self-reviews → checkpoints state → presents for human approval
```

### Repository Structure
```
openmontage/
├── tools/                  # 100+ Python tools (the agent's hands)
│   ├── video/             # 13 video gen tools
│   ├── audio/             # TTS + music + mixing
│   ├── graphics/          # 9 image gen tools
│   ├── enhancement/       # Upscale, bg remove, face enhance
│   ├── analysis/          # Transcription, scene detect
│   ├── avatar/            # Talking head, lip sync
│   └── subtitle/          # SRT/VTT generation
├── pipeline_defs/          # 14 YAML pipeline manifests
├── skills/                 # 700+ Markdown skill files
│   ├── pipelines/         # Per-pipeline stage directors
│   ├── creative/          # Creative techniques
│   ├── core/              # Core tool skills
│   └── meta/              # Reviewer, checkpoint protocol
├── schemas/                # 15 JSON Schemas
├── styles/                 # Visual style playbooks
├── backlot/                # Living storyboard (SSE-based)
├── remotion-composer/      # React/Remotion engine
├── ink-theater/            # Character animation (SVG/GSAP)
├── lib/                    # Config, checkpoints, pipeline loader
├── config.yaml             # Global config
└── tests/                  # Contract tests
```

### Pipeline System (14 pipelines)
Animated Explainer, Talking Head, Screen Demo, Clip Factory, Podcast Repurpose, Cinematic, Animation, Character Animation, Hybrid, Avatar Spokesperson, Localization & Dub, Documentary Montage, Framework Smoke

Standard flow: `research → proposal → script → scene_plan → assets → edit → compose`

### Provider Abstraction
**Most comprehensive of all 4 repos.** Tool registry with auto-discovery:
- **15 video gen providers** (Kling, Runway, Veo, MiniMax, HeyGen, WAN local, etc.)
- **11 image providers** (FLUX, Imagen, GPT Image, Recraft, local SD, stock)
- **5 TTS providers** (ElevenLabs, Google, Kling, OpenAI, Piper)
- **Music**: Suno, ElevenLabs
- **3 composition runtimes**: FFmpeg, Remotion, HyperFrames

Selector tools (`tts_selector`, `image_selector`, `video_selector`) auto-discover and rank providers across 7 dimensions.

### Checkpointing
- `projects/<project-id>/checkpoint_<stage>.json`
- History archived in `projects/<project-id>/history/`
- Status: `completed`, `failed`, `awaiting_human`, `in_progress`
- Approval gates are binding per manifest value

### Backlot Storyboard
Read-only local board watching `projects/` directory:
- SSE (Server-Sent Events) for live updates
- All state derives from pipeline artifacts on disk
- Replay capability for completed runs
- Visual approval gates with filmstrip contact sheet

### Quality Gates
- Reviewer protocol (meta skill, advisory, max 2 rounds)
- Visual contract gate (narration-visual binding)
- Pre-compose validation (blocks render on broken plans)
- Post-render self-review (ffprobe + frame extraction + audio analysis)
- Provider choices scored across 7 dimensions with audit trail

### Strengths
- **Richest tool ecosystem** (100+ tools, 15 video providers)
- **Innovative architecture** (agent-as-orchestrator)
- **Real-time storyboard** (Backlot)
- **Production-grade quality gates**
- **Free local path** (Piper TTS, Archive.org, Pexels, local GPU)
- **Excellent documentation** (700+ skill files)

### Weaknesses
- **AGPL-3.0 license** — network use = distribution, copyleft on all derivatives
- **Agent-as-orchestrator conflicts with our design** — we want deterministic orchestration
- **No persistence layer** — filesystem-only, no database
- **No REST API** — tools are Python functions, not HTTP endpoints
- **No job system** — no state machine, no retries, no job tracking
- **No cost tracking** — cost snapshot in checkpoints but no per-call accounting
- **No Windows-first design** — Makefile-based, some tools need GPU
- **2 commits** — very early, unstable

### Reuse Potential: MEDIUM (reference only due to AGPL)
- Quality gate philosophy
- Pipeline YAML manifest format ideas
- Provider selector pattern (7-dimension scoring)
- Style playbook concept
- Backlot storyboard concept (filesystem observation)

---

## 3. Multi-AI Video Factory (aibr442/multi-ai-video-factory)

**URL:** https://github.com/aibr442/multi-ai-video-factory
**Stars:** 0 | **Forks:** 0 | **Commits:** 1 | **License:** MIT
**Language:** Python 3.10 | **Stack:** FastAPI, Ollama, Groq, Mistral, AUTOMATIC1111, Edge TTS, FFmpeg

### Architecture
**Monolithic FastAPI app** — 6 source files, ~1,100 LOC total. Single-process, in-memory job registry.

```
Topic → Stage 1 LLM (draft) → Stage 2 LLM (script doctor) → Stage 3 LLM (final JSON)
       → Image prompts → SD API → Edge TTS → FFmpeg → Vertical MP4
```

### Repository Structure
```
multi-ai-video-factory/
├── src/
│   ├── app.py              # FastAPI server + FFmpeg + SD + job system (611 LOC)
│   ├── pipeline.py         # 4-stage LLM text pipeline (210 LOC)
│   ├── providers.py        # LLM provider abstraction (120 LOC)
│   ├── config.py           # Configuration (60 LOC)
│   ├── prompt_loader.py    # Template engine (18 LOC)
│   └── (missing files)     # Several src files not in repo
├── prompts/                # Prompt templates per category
│   ├── horror/, facts/, kids/, documentary/
│   └── each with ollama.txt, groq.txt, mistral.txt, image_prompts.txt
├── templates/index.html    # Single-page web UI
├── music/                  # User-provided music files
├── projects/               # Generated output (gitignored)
├── scripts/                # PowerShell helpers (setup, run, prereqs)
└── static/                 # CSS, JS for web UI
```

### LLM Routing
String-based provider dispatch: `"ollama:qwen2.5:14b"`, `"groq:llama-3.3-70b-versatile"`, `"mistral:mistral-small-latest"`

**Any stage can use any provider** — fully flexible per-stage selection in the UI.

Ollama models auto-discovered via `/api/tags`. Groq/Mistral models via env vars.

### Image Generation
Direct HTTP to AUTOMATIC1111 `/sdapi/v1/txt2img`:
- Configurable: width, height, steps, CFG, sampler (all from UI)
- Default: 512×768, 28 steps, Euler a
- 1200s timeout per image
- Per-scene regeneration

### TTS
Edge TTS via subprocess: free, outputs MP3 + VTT subtitles simultaneously.

### FFmpeg Rendering
- Ken Burns via sinusoidal pan/zoom (`sin(t*0.22)`, `cos(t*0.17)`)
- 1080×1920 vertical output
- Audio mix: voice + music (volume=0.12) via `amix`
- Subtitle burn via FFmpeg `subtitles` filter
- VTT→SRT conversion via FFmpeg

### Web UI
Single HTML file with 3-panel layout:
1. Left: Generate (topic, category, LLM routing, SD settings)
2. Center: Edit (title, script, prompts, voice/music/subtitle config)
3. Right: Prompt Pack Editor (live editing of prompt templates)

### Strengths
- **Windows-first** design with PowerShell scripts
- **Minimal dependencies** (6 Python files, no DB)
- **Ollama-native** — auto-discovery, zero-config local LLM
- **Free path**: Ollama + Edge TTS + FFmpeg = $0
- **Simple and hackable**: easy to understand and modify
- **Prompt template system**: mustache-style, editable in browser

### Weaknesses
- **No persistence** — in-memory jobs, lost on restart
- **No retry logic** — single failure kills the pipeline
- **No async I/O** — blocking HTTP calls in threads
- **No review gates** — no quality checks
- **No checkpointing** — no resume capability
- **No cost tracking** — no token/cost accounting
- **No agent abstraction** — stages are hardcoded functions
- **Monolithic app.py** — mixed concerns
- **No tests**
- **1 commit** — very early

### Reuse Potential: MEDIUM
- Windows setup patterns (PowerShell scripts)
- Ollama auto-discovery pattern
- Edge TTS integration
- FFmpeg Ken Burns animation
- Prompt template system
- LLM multi-provider routing concept

---

## 4. AI Shorts Generator (AbdullahNaveed/ai-shorts-generator)

**URL:** https://github.com/AbdullahNaveed/ai-shorts-generator
**Stars:** 2 | **Forks:** 0 | **Commits:** 1 | **License:** MIT
**Language:** Python 3.10+ | **Stack:** OpenAI, fal.ai, faster-whisper, FFmpeg, Flask, Pillow

### Architecture
6-stage sequential pipeline with a distinctive **clip library** for asset reuse:

```
Script → Visuals (match library → miss → generate) → Voiceover → Captions → Assemble → Output
```

### Repository Structure
```
ai-shorts-generator/
├── run.py                  # CLI orchestrator
├── pipeline/
│   ├── config.py           # Central config (145 LOC)
│   ├── models.py           # Pydantic schemas (Scene, Script)
│   ├── scriptgen.py        # OpenAI structured outputs (103 LOC)
│   ├── library.py          # SQLite clip catalog + embeddings (157 LOC)
│   ├── match.py            # Semantic matching (19 LOC)
│   ├── stock.py            # Pexels/Pixabay fetcher (111 LOC)
│   ├── images.py           # fal.ai Flux / local SDXL (64 LOC)
│   ├── animate.py          # fal.ai Wan i2v (24 LOC)
│   ├── voice.py            # OpenAI gpt-4o-mini-tts (56 LOC)
│   ├── captions.py         # faster-whisper → ASS karaoke (138 LOC)
│   ├── assemble.py         # FFmpeg assembly (245 LOC)
│   ├── produce.py          # Orchestrator (99 LOC)
│   ├── drafts.py           # JSON draft persistence (47 LOC)
│   ├── cards.py            # Watermark/outro (Pillow)
│   └── outro.py            # Branded outro builder
├── dashboard/
│   └── app.py              # Flask review UI (283 LOC)
├── library/
│   ├── index.db            # SQLite: clips + embeddings
│   ├── clips/              # MP4 files (5s each)
│   └── images/             # Poster frames
├── prompts/
│   ├── scriptgen_system.md # Scriptwriter personality
│   └── presets/            # Swappable writer presets
├── data/topics.txt         # Topic backlog
├── assets/                 # Fonts, logo, music
├── templates/              # HTML overlays (watermark, outro)
└── output/                 # Generated videos
```

### Clip Library (MOST DISTINCTIVE FEATURE)
SQLite-backed, embedding-powered clip reuse:
- **`library/index.db`**: clips table (id, description, embedding JSON, path, duration, times_used) + clip_usage history
- **Embeddings**: OpenAI `text-embedding-3-small`, stored as JSON float array
- **Cosine similarity**: pure Python (no vector DB), threshold 0.40
- **Recency window**: clips used in last 8 videos excluded
- **Usage penalty**: `times_used * 0.001` to diversify selection
- **match-then-generate**: if library hit → reuse, else → generate + catalog

### Script Generation
OpenAI structured outputs (`gpt-5-mini`) with Pydantic `Script` as `response_format`:
- 4-6 scenes per script, each with `image_prompt`, `narration`, `motion_prompt`, `hero` flag
- Per-platform social copy (YouTube, TikTok, X)
- Dedup: last 40 topics injected to prevent repetition
- Swappable writer personality via prompt presets

### Image Generation
Two backends:
| Backend | Model | Cost |
|---------|-------|------|
| `fal` | Flux dev | ~$0.025/image |
| `local` | SDXL-Turbo | Free (CUDA GPU) |

Images at 768×1344, cover-cropped to 1080×1920.

### TTS
OpenAI `gpt-4o-mini-tts` with streaming, configurable voice (`onyx` default), FFmpeg atempo (1.15x speed-up).

### Captions
`faster-whisper` for word-level timestamps → ASS karaoke format:
- Words turn amber as spoken
- Spelling correction via `difflib.SequenceMatcher` against original script
- 2-3 word chunks, max 15 chars

### Assembly (FFmpeg)
- Ken Burns from 6 cycling presets (`in`, `pan_right`, `out`, `pan_left`, `in`, `pan_up`)
- Or Wan 2.2 i2v animation (~$0.15/clip)
- Hard-cut concat → watermark → caption burn → outro → audio mix
- Audio: narration + music with `sidechaincompress` ducking + `loudnorm`
- libx264 CRF 18 + AAC 192k

### Dashboard (Flask)
- Video preview + per-platform captions
- Clip library browser with search
- Guided Create workflow (script → approve → produce)
- Music selector with remix capability
- Draft persistence (JSON files)

### Strengths
- **Clip library with semantic search** — best asset reuse of all 4 repos
- **Cost-conscious design** — library reuse, Ken Burns default, offline fallback
- **Word-level karaoke captions** — production-quality output
- **Flask dashboard** — review UI with approve/swap/remix
- **Dual image backends** — cloud (fal) or local (SDXL)
- **OpenAI structured outputs** — reliable JSON generation
- **Offline mode** — works without any API key (sample script + silent audio)

### Weaknesses
- **No provider abstraction** — direct SDK calls per service
- **No job persistence** — JSON drafts only
- **No review gates** — no quality checks
- **No checkpointing** — no resume capability
- **No retry logic**
- **No cost tracking** — no per-call accounting
- **Single-provider TTS** — OpenAI only
- **No video gen abstraction** — fal.ai only
- **1 commit** — early stage

### Reuse Potential: HIGH
- **Clip library architecture** (SQLite + embeddings + cosine search)
- **Caption generation** (faster-whisper → ASS karaoke)
- **Ken Burns animation presets**
- **Sidechaincompress audio ducking**
- **Stock footage fetching** (Pexels/Pixabay)
- **Prompt preset system**
- **Flask dashboard patterns** (adapt to React)
