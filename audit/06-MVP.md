# MVP — Minimum Viable Product Definition

## 1. MVP Goal

Demonstrate the **complete orchestration lifecycle** without video production:

```
Research → Script → Director → QA
```

With full Control Center visibility and the ability to:
1. Create a Job
2. Execute an Agent
3. Save the result
4. Advance to the next step
5. Pause the pipeline
6. Resume the pipeline
7. Request human approval
8. Track model, tokens, and cost per call
9. Record errors and retry

## 2. What the MVP Proves

| Capability | Evidence |
|------------|----------|
| Orchestration works | Pipeline completes end-to-end via UI |
| Agents produce typed output | Zod-validated Script, ProductionPlan, QaVerdict |
| Jobs persist and resume | Kill server mid-pipeline, restart, resume from last COMPLETED job |
| Approval gates work | Script halts → user approves → pipeline continues |
| Cost tracking works | Dashboard shows per-job model + tokens + EUR cost |
| OmniRoute integration works | Model Gateway routes tasks through local OmniRoute |
| Control Center is functional | React UI shows dashboard, agents, content, approvals |
| Error handling works | Bad input → agent fails → retry → eventual success or clear error |

## 3. MVP Scope

### IN SCOPE

| Component | Status | Work Needed |
|-----------|--------|-------------|
| Backend API | DONE | None |
| Orchestrator + State Machine | DONE | None |
| Model Gateway (OmniRoute) | DONE | None |
| Job System | DONE | None |
| Event Bus | DONE | None |
| SQLite Store | DONE | None |
| Research Agent | EXISTS | Enhance prompts for content ideas |
| Script Agent | EXISTS | Enhance for richer scripts |
| Director Agent | EXISTS | Enhance for production plans |
| QA Agent | EXISTS | Enhance for better scoring |
| Control Center (React) | EXISTS | Polish UX, add pipeline visualization |
| CLI | EXISTS | Already functional |
| Pipeline Definitions | EXISTS | Already data-driven |

### OUT OF SCOPE (future phases)
- Visual Agent (image/video generation)
- Voice Agent (TTS)
- Assembly Agent (FFmpeg composition)
- Publisher Agent
- Asset Library
- Analytics
- Learning
- Character consistency
- Music integration

## 4. MVP User Stories

### Story 1: Run Brain-First Pipeline
```
Given I open the Control Center
When I click "Create Content" and enter a topic
Then a new content item is created with status IDEA
When I click "Start Pipeline"
Then Research Agent runs and produces 5 ideas
And the pipeline pauses for approval
When I select an idea and click "Approve"
Then Script Agent runs and produces a script
And the pipeline pauses for approval
When I review the script and click "Approve"
Then Director Agent runs and produces a production plan
And the pipeline pauses for approval
When I approve the plan
Then QA Agent runs and scores the plan
If score >= 0.7: content moves to APPROVED
If score < 0.7: content moves to REJECTED with issues
```

### Story 2: Pause and Resume
```
Given a pipeline is paused at Script approval
When I close the browser
And I reopen it the next day
Then the pipeline is still waiting at Script approval
When I approve the script
Then the pipeline continues from where it left off
```

### Story 3: Retry on Failure
```
Given Research Agent fails (OmniRoute timeout)
Then the job is marked FAILED
When I click "Retry"
Then the job is re-queued as READY
And the Research Agent tries again
After 3 failures: job stays FAILED with clear error message
```

### Story 4: View Cost per Content
```
Given a pipeline has completed Research + Script + Director + QA
When I open the Content detail view
Then I see per-job breakdown:
  Research  auto/cheap     1,234 tokens  €0.0012
  Script    auto/standard  2,345 tokens  €0.0023
  Director  auto/standard  1,100 tokens  €0.0011
  QA        auto/vision      890 tokens  €0.0009
  ──────────────────────────────────────────────
  TOTAL                                    €0.0055
```

### Story 5: Manual Mode
```
Given I set Research Agent to MANUAL mode
When I click "Start Pipeline"
Then the pipeline creates a Research job but does NOT execute it
When I click "Run Research Agent"
Then the job executes and produces output
```

## 5. MVP Technical Requirements

### Backend (already implemented, verify)
- [ ] All API endpoints functional
- [ ] Orchestrator drain() handles full lifecycle
- [ ] State machine transitions are correct
- [ ] Model Gateway routes through OmniRoute
- [ ] Cost tracking per execution
- [ ] Event bus emits all lifecycle events
- [ ] SQLite schema is complete

### Frontend (already implemented, verify)
- [ ] Dashboard shows correct counts
- [ ] Agent cards show status/mode/cost
- [ ] Content list with status badges
- [ ] Content detail with jobs + artifacts
- [ ] Approval list with approve/reject
- [ ] Pipeline start button
- [ ] Job retry button
- [ ] Create content form

### Agent Enhancement (Phase 3 work)
- [ ] Research Agent produces 5-10 scored ideas
- [ ] Script Agent produces structured script with scenes
- [ ] Director Agent produces shot-by-shot production plan
- [ ] QA Agent scores on 5+ criteria with issues

### Integration Testing
- [ ] E2E: Create → Start → Research → Approve → Script → Approve → Director → Approve → QA → Complete
- [ ] E2E: Fail → Retry → Success
- [ ] E2E: Pause → Kill server → Restart → Resume
- [ ] E2E: Manual mode → trigger → complete
- [ ] Cost: Verify EUR amounts appear in dashboard

## 6. MVP Success Criteria

| Criterion | How to Verify |
|-----------|---------------|
| Pipeline completes | `npm run cli -- dashboard` shows COMPLETED content |
| Approval works | Script halts, approve advances to Director |
| Resume works | Kill server, restart, pipeline continues |
| Cost tracked | Dashboard shows non-zero token counts and EUR costs |
| Error handled | Force OmniRoute down → retry works → clear error |
| OmniRoute used | Check `model_registry` in SQLite has OmniRoute entries |
| UI functional | All 4 tabs render, no console errors, actions work |

## 7. What We Deliberately Skip

| Skipped | Why |
|---------|-----|
| Video generation | Phase 5 concern, not brain-first |
| Audio generation | Phase 6 concern |
| FFmpeg integration | Phase 7 concern |
| Character consistency | Phase 10+ concern |
| Multiple pipelines | Single pipeline sufficient for MVP |
| Multi-user auth | Single operator for MVP |
| External message broker | In-process events sufficient |
| Docker/containerization | Local single-process |
| Analytics dashboard | Phase 10 concern |

## 8. Testing Strategy for MVP

### Unit Tests (vitest)
- State machine transitions
- Model Gateway routing logic
- Pipeline step resolution
- Agent contract validation (zod schemas)

### Integration Tests
- Agent → Model Gateway → OmniRoute (live or mocked)
- Orchestrator → Job → SQLite (real DB)
- API → Orchestrator → Agent → Gateway (full stack)

### E2E Test (manual or scripted)
```bash
# Terminal 1: Start backend
cd backend && npm run dev

# Terminal 2: Start frontend
cd frontend && npm run dev

# Terminal 3: Run CLI pipeline
npm run cli -- new-content "Space exploration for kids"
npm run cli -- start <content-id>
npm run cli -- run   # drain until approval needed
npm run cli -- approvals  # see pending
npm run cli -- approve <approval-id> "Great ideas, proceed"
npm run cli -- run   # drain again
# ... repeat until QA completes
npm run cli -- dashboard  # see results + cost
```
