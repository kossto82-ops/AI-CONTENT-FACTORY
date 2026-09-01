# ROADMAP — Incremental Delivery Plan

## Philosophy

Each phase ends with a **verified, working increment**. "Brain-first": prove orchestration before production. Each phase is independently valuable.

## Phase 0 — Discovery (DONE)
Audit environment, design architecture, study open-source alternatives.
- ✅ Node 26, Python 3.14, Git, OmniRoute live
- ✅ Architecture docs: ARCHITECTURE.md, PRODUCT.md, DECISIONS.md
- ✅ This audit complete

## Phase 1 — Foundation (DONE, AICF-001)
- ✅ Monorepo scaffold: backend (Node+TS), frontend
- ✅ SQLite schema + migrations
- ✅ Model Gateway: OmniRoute adapter + task routing + cost accounting
- ✅ Job system: state machine, persistence, retries
- ✅ Orchestrator: create/run jobs, dependencies, approval gates
- ✅ CLI to drive it
- ✅ E2E proven via CLI (cost: €0.0025)

## Phase 2 — Control Center (DONE)
- ✅ Backend HTTP API (node:http + CORS)
- ✅ Frontend: Vite + React + Tailwind v4
- ✅ Tabbed UI: Dashboard / Agents / Content / Approvals
- ✅ Live polling, create idea, start pipeline, approve/reject
- ✅ E2E proven: UI → API → Orchestrator → Gateway → QA

## Phase 3 — Research + Script Agents (NEXT)

### Goals
- Research Agent discovers 5-10 scored content ideas
- Script Agent produces structured scripts with scenes
- Manual/Semi-automatic modes + approval gates wired E2E
- Enhanced prompts for children's content

### Work Items
1. Enhance Research Agent prompts (children's content, trends, age-appropriate)
2. Enhance Script Agent prompts (structure, scenes, narration, CTA)
3. Wire approval gates for ideas and scripts
4. Test E2E: topic → ideas → approve → script → approve
5. Verify cost tracking per agent

### Deliverables
- Enhanced `src/agents/research.ts` with richer prompts
- Enhanced `src/agents/script.ts` with scene generation
- Updated pipeline definition with approval gates
- E2E test results with cost breakdown

### Success Criteria
- Research Agent produces 5+ ideas with scores
- Script Agent produces 4-6 scene script
- Approval gate halts pipeline, approval resumes it
- Dashboard shows per-job cost

## Phase 4 — Director Agent

### Goals
- Director Agent converts scripts to production plans
- Versioned plans with rollback on QA rejection
- QA Agent enhanced with richer scoring criteria

### Work Items
1. Enhance Director Agent prompts (shot-by-shot, visual style, camera)
2. Enhance QA Agent scoring (5+ criteria, severity, suggestions)
3. Wire approval gate for production plans
4. Implement artifact versioning (v1, v2 on QA rejection + Director revision)
5. Test E2E: script → plan → QA → approve/reject/revise

### Deliverables
- Enhanced Director Agent
- Enhanced QA Agent
- Artifact versioning in SQLite
- E2E test with QA rejection + revision flow

### Success Criteria
- Director produces shot-by-shot plan per scene
- QA scores on 5+ criteria
- QA rejection → Director revises → QA re-reviews (loop)
- Version history preserved in artifacts

## Phase 5 — Visual Agent + Asset Library

### Goals
- Visual Agent generates/selects images for each scene
- Asset Library with embedding-based reuse (match-then-generate)
- Stock footage fetching (Pexels)
- Character consistency via prompt engineering

### Prerequisites
- FFmpeg installed on PATH
- Pexels API key (free)
- OmniRoute supporting image generation (FLUX)

### Work Items
1. Install FFmpeg + verify on PATH
2. Implement Asset Library (SQLite + embeddings + cosine search)
3. Implement stock image fetching (Pexels API)
4. Implement Visual Agent (image prompt → OmniRoute FLUX → asset)
5. Implement match-then-generate pattern
6. Wire approval gate for assets
7. Test E2E: plan → visuals → approve

### Architecture Notes
- Visual Agent calls Model Gateway with `image.generation` task
- Asset Library stores embeddings for semantic search
- Reuse threshold: cosine similarity > 0.40
- Recency window: exclude clips used in last 8 videos
- Parallel scene generation via `Promise.allSettled`

### Deliverables
- Asset Library service
- Visual Agent
- Stock fetcher
- E2E test: 5-scene video with images

### Success Criteria
- 5 scenes get images (generated or stock)
- Asset Library stores + retrieves clips
- Second run reuses assets from first run
- Dashboard shows asset library + usage

## Phase 6 — Voice Agent

### Goals
- Voice Agent generates narration (TTS)
- Word-level timestamps for subtitles
- Multiple voice options
- Free path via Edge TTS

### Work Items
1. Implement Edge TTS integration (Python subprocess)
2. Implement word-level timestamp extraction (faster-whisper or Whisper API)
3. Implement Voice Agent (script narration → TTS → timestamps)
4. Voice selection (per-content configuration)
5. Audio duration tracking (feeds into Assembly timing)
6. Test E2E: script → voiceover + timestamps

### Architecture Notes
- Edge TTS via `edge-tts` Python subprocess (free)
- Alternative: OpenAI TTS via OmniRoute (paid, better quality)
- faster-whisper for word timestamps (local, free)
- Alternative: OpenAI Whisper API via OmniRoute (paid)

### Deliverables
- Voice Agent
- TTS integration (Edge TTS)
- Timestamp extraction
- E2E test: script → narration audio + word timings

### Success Criteria
- Narration generated for each scene
- Word-level timestamps within 50ms accuracy
- Audio duration matches expected scene duration
- Free path works (Edge TTS + faster-whisper)

## Phase 7 — Assembly Agent

### Goals
- Assembly Agent composes scenes into final video
- Ken Burns animation on still images
- Subtitle burn-in (ASS format)
- Audio mixing (narration + music)
- Watermark/branding overlay

### Prerequisites
- FFmpeg installed and verified
- Phase 5 (Visual Agent) complete
- Phase 6 (Voice Agent) complete

### Work Items
1. Implement FFmpeg wrapper (child_process)
2. Implement Ken Burns presets (6 directions, from AI Shorts Gen)
3. Implement subtitle generation (ASS karaoke format)
4. Implement audio mixing (narration + optional music)
5. Implement Assembly Agent (scenes → FFmpeg → MP4)
6. Implement 1080×1920 vertical output
7. Test E2E: scenes + voice → final MP4

### Architecture Notes
- Assembly Agent is a **service** (deterministic), NOT an agent (no LLM)
- FFmpeg calls via child_process with structured output parsing
- Ken Burns: `zoompan` filter with cycling presets
- Subtitles: `ass` filter with custom fonts
- Audio: `amix` with narration + music, optional `sidechaincompress` ducking
- Output: libx264 CRF 18 + AAC 192k

### Deliverables
- FFmpeg wrapper module
- Assembly service
- Ken Burns presets
- Subtitle generator
- E2E test: full pipeline topic → MP4

### Success Criteria
- 30-60 second vertical video produced
- Ken Burns animation visible on each scene
- Subtitles aligned with narration
- Audio mixed correctly
- Output is 1080×1920 H.264 MP4

## Phase 8 — QA Agent (Vision)

### Goals
- QA Agent reviews final video with vision model
- Automated quality checks (duration, resolution, audio levels)
- Visual coherence check (scene continuity)
- Content safety check (children's content)

### Work Items
1. Implement FFprobe analysis (duration, resolution, codecs, loudness)
2. Implement frame extraction for vision review
3. Enhance QA Agent with vision model calls via OmniRoute
4. Implement automated quality checks (deterministic, no LLM)
5. Implement LLM-based visual review (vision model)
6. Wire QA verdict to content lifecycle
7. Test E2E: video → QA → verdict

### Deliverables
- Enhanced QA Agent (vision + deterministic checks)
- FFprobe integration
- Frame extraction
- E2E test: video → QA approval

### Success Criteria
- QA Agent identifies bad audio, wrong resolution, visual errors
- QA passes good videos, rejects bad ones
- Score reflects actual quality
- Dashboard shows QA review details

## Phase 9 — Publisher Agent

### Goals
- Publisher Agent formats metadata for platforms
- YouTube upload via API (optional)
- Per-platform copy (YouTube, TikTok, X)
- Thumbnail generation

### Work Items
1. Implement metadata formatting (title, description, hashtags, tags)
2. Implement thumbnail generation (Sharp/canvas)
3. Implement YouTube Data API integration (optional)
4. Implement per-platform copy variants
5. Wire approval gate for publication
6. Test E2E: video + metadata → ready to publish

### Deliverables
- Publisher Agent
- Thumbnail generator
- Metadata formatter
- YouTube integration (optional)
- E2E test: video → publish-ready package

### Success Criteria
- YouTube title + description + hashtags generated
- Thumbnail generated at 1280×720
- Per-platform copy (YouTube, TikTok, X)
- Publication record persisted

## Phase 10 — Analytics Agent

### Goals
- Track video performance (YouTube Analytics API)
- Cost-per-video rollup
- Performance dashboards
- Feed data to Learning Agent

### Work Items
1. Implement YouTube Analytics API integration
2. Implement cost rollup per content
3. Implement analytics dashboard (React)
4. Implement trend tracking (views, engagement, revenue)
5. Feed Learning Agent with performance data

## Phase 11 — Learning Agent

### Goals
- Learn from analytics to improve future content
- Semantic memory via embeddings
- Trend detection
- Idea generation from performance data
- Strategy optimization

### Work Items
1. Implement semantic memory (embeddings of successful content)
2. Implement trend detection (web search + analytics)
3. Implement idea generation from performance patterns
4. Implement A/B testing framework
5. Implement strategy recommendations

---

## Timeline Estimate

| Phase | Scope | Estimated Effort |
|-------|-------|:----------------:|
| Phase 3 | Research + Script | 1-2 sessions |
| Phase 4 | Director + QA enhancement | 1-2 sessions |
| Phase 5 | Visual + Asset Library | 2-3 sessions |
| Phase 6 | Voice | 1-2 sessions |
| Phase 7 | Assembly | 2-3 sessions |
| Phase 8 | QA (Vision) | 1-2 sessions |
| Phase 9 | Publisher | 1-2 sessions |
| Phase 10 | Analytics | 2-3 sessions |
| Phase 11 | Learning | 3+ sessions |
| **Total** | **Full platform** | **14-22 sessions** |

Each session = one focused work period (2-4 hours).

## Dependency Graph

```
Phase 3 (Research+Script)
  ↓
Phase 4 (Director+QA)
  ↓
Phase 5 (Visual+Assets) ← FFmpeg install prerequisite
  ↓
Phase 6 (Voice) ← can run parallel with Phase 5
  ↓
Phase 7 (Assembly) ← requires Phase 5 + Phase 6
  ↓
Phase 8 (QA Vision) ← requires Phase 7
  ↓
Phase 9 (Publisher) ← requires Phase 8
  ↓
Phase 10 (Analytics) ← requires Phase 9
  ↓
Phase 11 (Learning) ← requires Phase 10
```

**Fastest path to first video:** Phase 3 → 4 → 5 → 6 → 7 (5 phases, ~8-12 sessions)
