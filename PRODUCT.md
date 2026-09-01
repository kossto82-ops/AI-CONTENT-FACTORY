# AI Content Factory — Product

## 1. Vision

A controlled "Content Factory": a production platform that uses specialized
agents to research, write, plan, produce, review, and publish short-form
vertical video. The user operates it like an AI ops control room — they watch
status, approve at gates, and fix what fails — rather than launching
autonomous agents into the dark.

## 2. Users

| User | Need |
|------|------|
| Content operator (primary) | Run pipelines, approve/reject/edit outputs, inspect cost/status |
| Creative reviewer | Approve scripts / production plans / QA verdicts before publish |
| Admin | Configure agents, modes, pipelines, providers, cost limits |

MVP single-operator; multi-user is a later concern (but auth is designed in).

## 3. Execution modes

Every agent (per-agent and overrideable per-pipeline):

- **MANUAL** — user explicitly runs the agent (`RUN RESEARCH AGENT`).
- **SEMI-AUTOMATIC** — agent does its work, then waits for human approval before
  the next step proceeds.
- **AUTOMATIC** — Orchestrator advances the pipeline without human input, except
  at gates configured to require approval, or on errors.

## 4. Agents

| Agent | Responsibility | Output |
|-------|----------------|--------|
| Research / Trend | discover ideas, analyze trends/formats/themes, study existing content, produce proposals | Idea[] (title, concept, target_age, format, hook, reason, score) |
| Story / Script | turn an idea into creative output | Script v{N} (concept, hook, structure, narration, dialogue, scenes, ending, CTA) |
| Director | convert script into a production contract | ProductionPlan (Scene[]: duration, characters, location, action, camera, emotion, narration) |
| Visual | generate/select images + clips, character/scene consistency | Asset[] (versioned) |
| Voice | narration + character voices + audio | VoiceTrack(s) |
| Video Assembly | compose scenes/images/clips/voice/music/subtitles/effects | Final video (reproducible) |
| QA | auto review duration, resolution, vertical format, audio, subtitles, visual errors, coherence, continuity, appropriateness, metadata | verdict {status, score, issues[]} |
| Publisher | title, description, hashtags, metadata, thumbnail; publish/schedule; optional+disableable | Publication record |

## 5. Pipelines

MVP pipeline (brain-first, no video yet):

```
Research -> Script -> Director -> QA
```

Future pipeline extends to:

```
Research -> Script -> Director -> Visual -> Voice -> Assembly -> QA -> Publish
```

Per-pipeline settings: mode per step, approval gates, retry policy, publishing
enabled/disabled.

## 6. Human-in-the-loop

At any decision point the user can **approve / reject / edit / favorite**:

- Ideas (approve the 10, then `RUN WRITER`)
- Scripts
- Production plans
- Assets
- Videos
- Publication

Rejecting can route output back (e.g., QA fails -> Director revises -> v2).

## 7. Lifecycle

```
IDEA -> RESEARCHED -> APPROVED -> SCRIPTED -> DIRECTED -> PRODUCING
  -> ASSEMBLED -> QA -> APPROVED_FOR_PUBLISH -> PUBLISHED -> ANALYZED
```

Rollback allowed when needed; prior versions are never destroyed.

## 8. Control Center design

- **Dashboard**: counts/status of ideas, scripts, jobs, videos, errors; active
  agents; pending vs completed jobs; items awaiting approval.
- **Agents**: per-agent card — status (IDLE/READY/RUNNING/WAITING_APPROVAL/
  ERROR/DISABLED), mode, last job, duration, errors, model, est. cost, tokens.
- **Jobs**: full detail (id, agent, input, output, status, timestamps, retries,
  logs, model, provider, tokens, cost, error).
- **Pipelines**: visual flow with per-step status + controls
  (start/pause/stop/resume/retry/approve/reject).
