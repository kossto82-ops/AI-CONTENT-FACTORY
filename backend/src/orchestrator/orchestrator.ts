import {
  approvalRepo,
  artifactRepo,
  channelRepo,
  contentRepo,
  executionRepo,
  jobRepo,
  persistEvent,
  type ApprovalRow,
  type ArtifactRow,
  type ContentRow,
  type JobRow,
} from '../db/repository.js';
import { eventBus } from '../events/bus.js';
import {
  type AgentMode,
  type ApprovalStatus,
  newId,
  nowIso,
} from '../domain/types.js';
import type { PipelineDefinition } from '../pipeline.js';
import { defaultAgentMode } from '../pipeline.js';
import { getRunner, type AgentType } from '../agents/registry.js';
import {
  DEFAULT_CHANNEL_CONFIG,
  type ChannelConfig,
} from '../agents/contracts.js';
import { advanceContent, transitionJob } from './state.js';

/** Resolve the effective channel config for a content (channel_id -> config, else default). */
export function channelConfigFor(content: ContentRow): ChannelConfig {
  if (content.channel_id) {
    const ch = channelRepo.get(content.channel_id);
    if (ch?.config) {
      try {
        return { ...DEFAULT_CHANNEL_CONFIG, ...JSON.parse(ch.config) } as ChannelConfig;
      } catch {
        // fall through to default on malformed config
      }
    }
  }
  return DEFAULT_CHANNEL_CONFIG;
}

/** Input builders feed each agent from prior artifacts/content state. */
function buildInput(agent: AgentType, content: Awaited<ReturnType<typeof contentRepo.get>>): unknown {
  if (!content) throw new Error('Content not found');
  const meta = safeJson(content.meta, {}) as { topic?: string; targetAge?: string };
  // Resolve the owning channel's config once; pass to every creative agent so
  // audience/format/structure/character are consistent down the pipeline.
  const channelConfig = channelConfigFor(content);

  switch (agent) {
    case 'research':
      return {
        topic: meta.topic ?? 'curiosity and friendship for young children',
        targetAge: channelConfig.audience.targetAge,
        count: 5,
        channelConfig,
      };
    case 'script': {
      const ideaArt = latestArtefact(content.id, 'idea');
      if (!ideaArt) throw new Error('No idea artifact selected for scripting');
      const ideas = safeJson(ideaArt.payload, { ideas: [] }) as { ideas: { score: number }[] };
      const chosen = pickBestIdea(ideas.ideas);
      return { idea: chosen, channelConfig };
    }
    case 'director': {
      const scriptArt = latestArtefact(content.id, 'script');
      if (!scriptArt) throw new Error('No script artifact for direction');
      return { script: safeJson(scriptArt.payload), channelConfig };
    }
    case 'qa': {
      const planArt = latestArtefact(content.id, 'production_plan');
      if (!planArt) throw new Error('No production plan for QA');
      const c = content;
      return {
        plan: safeJson(planArt.payload),
        scriptTitle: c.title,
        contentId: content.id,
        channelConfig,
        video: latestArtefact(content.id, 'video') ? safeJson(latestArtefact(content.id, 'video')!.payload) : null,
        assets: latestArtefact(content.id, 'assets') ? safeJson(latestArtefact(content.id, 'assets')!.payload) : null,
        voice: latestArtefact(content.id, 'voice') ? safeJson(latestArtefact(content.id, 'voice')!.payload) : null,
      };
    }
    case 'publisher': {
      const planArt = latestArtefact(content.id, 'production_plan');
      if (!planArt) throw new Error('No production plan for publisher');
      // An optional ISO date can be supplied per content (e.g. via meta) to
      // schedule rather than publish immediately.
      const scheduledAt = (safeJson(content.meta, {}) as { scheduledAt?: string }).scheduledAt ?? null;
      return {
        plan: safeJson(planArt.payload),
        contentId: content.id,
        channelConfig,
        scheduledAt,
      };
    }
    case 'visual': {
      const planArt = latestArtefact(content.id, 'production_plan');
      if (!planArt) throw new Error('No production plan for visual');
      return { plan: safeJson(planArt.payload), contentId: content.id, channelConfig };
    }
    case 'voice': {
      const planArt = latestArtefact(content.id, 'production_plan');
      if (!planArt) throw new Error('No production plan for voice');
      return { plan: safeJson(planArt.payload), contentId: content.id, channelConfig };
    }
    case 'assembly': {
      const planArt = latestArtefact(content.id, 'production_plan');
      if (!planArt) throw new Error('No production plan for assembly');
      const assetsArt = latestArtefact(content.id, 'assets');
      if (!assetsArt) throw new Error('No visual assets for assembly — run Visual first');
      const voiceArt = latestArtefact(content.id, 'voice');
      if (!voiceArt) throw new Error('No voice assets for assembly — run Voice first');
      const assets = safeJson(assetsArt.payload) as {
        scenes?: { sceneId: string; file: string; mime?: string }[];
      };
      const voice = safeJson(voiceArt.payload) as {
        scenes?: { sceneId: string; file: string; mime?: string; durationSeconds?: number }[];
      };
      return {
        plan: safeJson(planArt.payload),
        contentId: content.id,
        sceneImages: (assets.scenes ?? []).map((s) => ({
          sceneId: s.sceneId,
          file: s.file,
          mime: s.mime ?? 'image/png',
        })),
        sceneVoice: (voice.scenes ?? []).map((s) => ({
          sceneId: s.sceneId,
          file: s.file,
          mime: s.mime ?? 'audio/wav',
          durationSeconds: s.durationSeconds ?? 0,
        })),
      };
    }
  }
}

function pickBestIdea(ideas: { score?: number }[]): unknown {
  if (!ideas.length) throw new Error('Idea list is empty');
  const sorted = [...ideas].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return sorted[0];
}

function latestArtefact(contentId: string, kind: string): ArtifactRow | undefined {
  return artifactRepo.latest(contentId, kind);
}

function safeJson(s: string, fallback?: unknown): any {
  try {
    return JSON.parse(s);
  } catch {
    return fallback ?? {};
  }
}

export interface DecideApprovalOptions {
  approvalId: string;
  status: ApprovalStatus;
  decision?: string;
}

export class Orchestrator {
  /**
   * Create a fresh content object (IDEA) with optional meta (e.g. topic) and an
   * optional channel id. When a channel is set, its audience targetAge is used
   * as the RESEARCHED target age unless meta.targetAge overrides it.
   * Returns content id.
   */
  createContent(meta: Record<string, unknown> = {}, channelId?: string): string {
    const id = newId('content');
    const channel = channelId ? channelRepo.get(channelId) : undefined;
    const cfg = channelConfigFor({
      channel_id: channelId ?? null,
    } as ContentRow);
    const targetAge =
      (meta.targetAge as string | undefined) ??
      (channel ? cfg.audience.targetAge : null);
    contentRepo.insert({
      id,
      title: null,
      target_age: targetAge ?? null,
      format: null,
      hook: null,
      status: 'IDEA',
      current_version: 0,
      meta: JSON.stringify(meta),
      channel_id: channelId ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    eventBus.emit({
      type: 'content.created',
      entityId: id,
      entityType: 'content',
      payload: { ...meta, channelId: channelId ?? null },
      at: nowIso(),
    });
    return id;
  }

  /** Create the job for the first pipeline step (as READY). */
  startPipeline(contentId: string, pipeline: PipelineDefinition): string {
    const first = activeSteps(pipeline)[0];
    if (!first) throw new Error(`Pipeline ${pipeline.id} has no runnable steps`);
    const job = this.touchStep(contentId, pipeline, first, null);
    return job.id;
  }

  /**
   * Materialize a step as a Job. dependency = id of the step's upstream job,
   * or null for the first step.
   */
  private touchStep(
    contentId: string,
    pipeline: PipelineDefinition,
    step: PipelineDefinition['steps'][number],
    dependencyJobId: string | null,
    inputOverride?: unknown,
  ): JobRow {
    const content = contentRepo.get(contentId)!;
    const input = inputOverride ?? buildInput(step.agent, content);
    const job: JobRow = {
      id: newId('job'),
      content_id: contentId,
      pipeline_id: pipeline.id,
      type: step.agent,
      agent_id: step.agent,
      status: 'READY',
      input: JSON.stringify(input),
      output: null,
      parent_job: dependencyJobId,
      dependency: dependencyJobId,
      created_at: nowIso(),
      started_at: null,
      completed_at: null,
      attempt: 0,
      max_retries: 3,
      error: null,
      model: null,
      provider: null,
      tokens_in: 0,
      tokens_out: 0,
      cost_eur: 0,
      trace: '[]',
    };
    jobRepo.insert(job);
    eventBus.emit({
      type: 'job.created',
      entityId: job.id,
      entityType: 'job',
      payload: { contentId, type: step.agent, pipelineId: pipeline.id },
      at: nowIso(),
    });
    return job;
  }

  /**
   * Execute every RUNNABLE job once. Returns true if any progressed.
   * AUTO/SEMI pipelines drain here; MANUAL steps stay READY until explicitly run.
   */
  async drain(pipeline: PipelineDefinition): Promise<boolean> {
    let progressed = false;
    // Keep draining newly-ready jobs until a full pass makes no progress.
    let again = true;
    while (again) {
      again = false;
      for (const job of jobRepo.runnable()) {
        if (job.dependency && !this.dependencySatisfied(job)) continue;
        const ok = await this.runOne(job, pipeline);
        progressed = progressed || ok;
        if (ok) again = true; // a step completed/advanced; re-check for new runnable jobs
      }
    }
    return progressed;
  }

  /** Run a single READY job (or retry a FAILED one). */
  async runOne(job: JobRow, pipeline: PipelineDefinition, force = false): Promise<boolean> {
    if (job.status === 'READY' || job.status === 'FAILED') {
      const runner = getRunner(job.type as AgentType);
      const step = pipeline.steps.find((s) => s.agent === job.type);

      // MANUAL mode: don't auto-run; leave it READY (unless explicitly forced).
      const mode = this.effectiveMode((step?.agent ?? job.type) as AgentType, step?.mode);
      if (mode === 'MANUAL' && job.status === 'READY' && !force) return false;

      transitionJob(job, 'RUNNING');
      this.log(job, `RUNNING ${runner.name}`);

      const started = nowIso();
      try {
        const result = await runner.run(safeJson(job.input));
        job.output = JSON.stringify(result.data);
        job.model = result.model ?? job.model;
        job.provider = result.provider ?? job.provider;
        job.tokens_in += result.usage?.tokensIn ?? 0;
        job.tokens_out += result.usage?.tokensOut ?? 0;
        job.cost_eur += result.usage?.costEur ?? 0;
        executionRepo.insert({
          id: newId('exec'),
          job_id: job.id,
          agent_id: job.type,
          model: result.model ?? null,
          provider: result.provider ?? 'omniroute',
          tokens_in: result.usage?.tokensIn ?? 0,
          tokens_out: result.usage?.tokensOut ?? 0,
          cost_eur: result.usage?.costEur ?? 0,
          started_at: started,
          ended_at: nowIso(),
          error: null,
        });

        this.persistArtifact(job, result.data);
        this.deriveContent(job, result.data, pipeline);

        // Decide final status based on gates — NOT hardcoded to COMPLETED.
        await this.afterCompletion(job, pipeline, runner.name);
        return true;
      } catch (e) {
        job.error = e instanceof Error ? e.message : String(e);
        job.attempt += 1;
        jobRepo.updateAttempt(job.id, job.attempt);
        executionRepo.insert({
          id: newId('exec'),
          job_id: job.id,
          agent_id: job.type,
          model: null,
          provider: 'omniroute',
          tokens_in: 0,
          tokens_out: 0,
          cost_eur: 0,
          started_at: started,
          ended_at: nowIso(),
          error: job.error,
        });
        if (job.attempt < job.max_retries) {
          transitionJob(job, 'READY'); // retry
          this.log(job, `FAILED (attempt ${job.attempt}) — retrying: ${job.error}`);
        } else {
          transitionJob(job, 'FAILED');
          this.log(job, `FAILED after ${job.attempt} attempts: ${job.error}`);
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Explicitly run a single READY/FAILED job, bypassing the MANUAL guard.
   * Used by the Control Center to advance manual-mode steps one at a time.
   */
  async runJob(jobId: string, pipeline: PipelineDefinition): Promise<boolean> {
    const job = jobRepo.get(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    if (job.status !== 'READY' && job.status !== 'FAILED') {
      throw new Error(`Job ${jobId} is not runnable (status=${job.status})`);
    }
    return this.runOne(job, pipeline, true);
  }

  /**
   * Revision loop (rollback path on QA rejection): re-run the Director step
   * with the last QA issues so the plan is revised (production_plan v2+).
   * Requires an existing plan AND a latest QA verdict that is 'rejected'.
   * Returns the new director job id.
   */
  revisePlan(contentId: string, pipeline: PipelineDefinition): string {
    const content = contentRepo.get(contentId);
    if (!content) throw new Error('Content not found');

    const scriptArt = latestArtefact(contentId, 'script');
    if (!scriptArt) throw new Error('No script artifact for planning');
    const planArt = latestArtefact(contentId, 'production_plan');
    if (!planArt) throw new Error('No production plan to revise');
    const qaArt = latestArtefact(contentId, 'qa');
    if (!qaArt) throw new Error('No QA verdict — nothing to revise');
    const verdict = safeJson(qaArt.payload) as { status?: string; issues?: { severity: string; category: string; message: string }[] };
    if (verdict.status !== 'rejected') throw new Error('Latest QA verdict is not rejected — nothing to revise');

    const step = pipeline.steps.find((s) => s.agent === 'director');
    if (!step) throw new Error('Pipeline has no director step');

    const lastDone = jobRepo
      .listByContent(contentId)
      .filter((j) => j.status === 'COMPLETED')
      .pop();
    const input = {
      script: safeJson(scriptArt.payload),
      revision: {
        issues: verdict.issues ?? [],
        previousPlan: safeJson(planArt.payload),
      },
    };
    const job = this.touchStep(contentId, pipeline, step, lastDone?.id ?? null, input);
    this.log(job, `Revision requested — reviving Director with QA feedback`);
    return job.id;
  }

  /** Approve or reject a pending approval; resumes or halts the pipeline. */
  decideApproval(opts: DecideApprovalOptions, pipeline: PipelineDefinition): void {
    const approval = approvalRepo.get(opts.approvalId);
    if (!approval) throw new Error(`Approval not found: ${opts.approvalId}`);
    approvalRepo.setDecision(approval.id, opts.status, opts.decision ?? '');

    const job = approval.job_id ? jobRepo.get(approval.job_id) : undefined;

    eventBus.emit({
      type: opts.status === 'APPROVED' ? 'approval.approved' : 'approval.rejected',
      entityId: approval.id,
      entityType: 'approval',
      payload: { contentId: approval.content_id, kind: approval.kind, decision: opts.decision },
      at: nowIso(),
    });

    if (opts.status === 'APPROVED' && approval.content_id) {
      // Do NOT advance content here — content advancement happens when each
      // step completes (in afterCompletion / createNextStepIfAuto). Approval
      // just unblocks the pipeline.
      const afterAgent = job?.type ?? this.agentForApprovalKind(approval.kind);
      this.createNextStep(approval.content_id, pipeline, afterAgent);
    } else if (opts.status === 'REJECTED') {
      // Stop this branch; user may edit/restart. Content stays at current stage.
      if (job) {
        this.log(job, `REJECTED at approval — pipeline halted for content ${approval.content_id}`);
      }
    }
  }

  // ---------------- internals ----------------

  /** Map an approval kind to the agent whose artifact triggered it. */
  private agentForApprovalKind(kind: string): string {
    switch (kind) {
      case 'idea':
        return 'research';
      case 'script':
        return 'script';
      case 'plan':
        return 'director';
      case 'asset':
        return 'visual';
      case 'video':
        return 'assembly';
      default:
        return 'qa';
    }
  }

  private createNextStep(contentId: string, pipeline: PipelineDefinition, afterAgent: string): void {    const steps = activeSteps(pipeline);
    const currentIdx = steps.findIndex((s) => s.agent === afterAgent);
    const next = steps[currentIdx + 1];
    if (!next) {
      eventBus.emit({
        type: 'pipeline.finished',
        entityId: contentId,
        entityType: 'content',
        payload: {},
        at: nowIso(),
      });
      return;
    }
    const currentJob = lastCompletedJobFor(contentId);
    const priorJob = currentJob;
    const job = this.touchStep(contentId, pipeline, next, priorJob?.id ?? null);
  }

  /** Decide whether to gate + whether to auto-proceed after a job completes. */
  private async afterCompletion(
    job: JobRow,
    pipeline: PipelineDefinition,
    agentName: string,
  ): Promise<void> {
    const step = pipeline.steps.find((s) => s.agent === job.type);
    const mode = this.effectiveMode(job.type as AgentType, step?.mode);

    const needsGate = (step?.requiresApproval ?? false) || mode === 'SEMI_AUTOMATIC';

    // Advance content to this step's stage (regardless of gating).
    if (step && job.content_id) {
      advanceContent(job.content_id, stageFor(job.type as AgentType));
      // The Publisher flips to PUBLISHED (or SCHEDULED via meta).
      if (job.type === 'publisher' && job.output) {
        const pkg = safeJson(job.output) as { status?: string };
        const pushState = pkg.status === 'SCHEDULED' ? 'SCHEDULED' : 'PUBLISHED';
        const c = contentRepo.get(job.content_id);
        if (c) {
          const meta = safeJson(c.meta, {});
          meta.publishStatus = pushState;
          contentRepo.updateMeta(job.content_id, JSON.stringify(meta));
          advanceContent(job.content_id, pushState);
        }
      }
    }

    if (needsGate && job.content_id) {
      transitionJob(job, 'WAITING_APPROVAL');
      this.requestApproval(job, step?.approvalKind ?? defaultApprovalKind(job.type as AgentType));
      this.log(job, `Awaiting human approval (${agentName})`);
      return;
    }

    // No gate needed: transition to COMPLETED, then continue.
    transitionJob(job, 'COMPLETED');
    this.log(job, `COMPLETED (${agentName})`);

    // MANUAL: stop and wait for explicit RUN.
    if (mode === 'MANUAL') {
      this.log(job, `Step complete in MANUAL mode — waiting for explicit RUN.`);
      return;
    }

    // AUTOMATIC / SEMI-without-gate: continue to next step.
    this.createNextStepIfAuto(job, pipeline);
  }

  private createNextStepIfAuto(job: JobRow, pipeline: PipelineDefinition): void {
    if (!job.content_id) return;
    const steps = activeSteps(pipeline);
    const idx = steps.findIndex((s) => s.agent === job.type);
    const next = steps[idx + 1];

    if (!next) {
      // Last step completed without a gate -> pipeline finished.
      // Content is already at this step's stage (advanced in afterCompletion).
      // No further advancement needed — the stage IS the final stage.
      eventBus.emit({
        type: 'pipeline.finished',
        entityId: job.content_id,
        entityType: 'content',
        payload: {},
        at: nowIso(),
      });
      return;
    }
    if (next.mode === 'MANUAL') {
      // Next step is manual: materialize it READY but don't run.
      this.touchStep(job.content_id!, pipeline, next, job.id);
      this.log(job, `Next step (${next.agent}) materialized in MANUAL mode — run manually.`);
      return;
    }
    const nextJob = this.touchStep(job.content_id, pipeline, next, job.id);
    // It will be picked up by the next drain() pass.
  }

  private requestApproval(job: JobRow, kind: string): void {
    const app: ApprovalRow = {
      id: newId('approval'),
      content_id: job.content_id,
      job_id: job.id,
      kind: kind as ApprovalRow['kind'],
      status: 'PENDING',
      request_reason: `Approve ${kind} produced by ${job.type} agent`,
      decision: null,
      decided_at: null,
      created_at: nowIso(),
    };
    approvalRepo.insert(app);
    eventBus.emit({
      type: 'approval.requested',
      entityId: app.id,
      entityType: 'approval',
      payload: { kind, jobId: job.id, contentId: job.content_id },
      at: nowIso(),
    });
  }

  private findApproval(id: string): ApprovalRow | undefined {
    return approvalRepo.get(id);
  }

  private persistArtifact(job: JobRow, data: unknown): void {
    if (!job.content_id) return;
    const kind = defaultArtifactKind(job.type as AgentType);
    if (!kind) return;
    const version = artifactRepo.nextVersion(job.content_id, kind);
    artifactRepo.insert({
      id: newId('artifact'),
      content_id: job.content_id,
      kind,
      version,
      payload: JSON.stringify(data),
      source_job_id: job.id,
      created_at: nowIso(),
    });
  }

  private deriveContent(job: JobRow, data: any, pipeline: PipelineDefinition): void {
    if (!job.content_id) return;
    const c = contentRepo.get(job.content_id)!;
    const step = pipeline.steps.find((s) => s.agent === job.type);
    const kind = step?.approvalKind ?? defaultApprovalKind(job.type as AgentType);
    if (job.type === 'research') {
      const ideas = safeJson(JSON.stringify(data), { ideas: [] }).ideas ?? [];
      if (ideas[0]) {
        c.title = ideas[0].title ?? c.title;
        c.target_age = ideas[0].target_age ?? c.target_age;
        c.format = ideas[0].format ?? c.format;
        c.hook = ideas[0].hook ?? c.hook;
      }
      contentRepo.patch(c);
    } else if (job.type === 'script' && data) {
      c.title = data.title ?? c.title;
      contentRepo.patch(c);
    }
    // kind unused beyond gating metadata; keep for clarity
    void kind;
  }

  private dependencySatisfied(job: JobRow): boolean {
    if (!job.dependency) return true;
    const dep = jobRepo.get(job.dependency);
    return !!dep && dep.status === 'COMPLETED';
  }

  private effectiveMode(agent: AgentType, override?: AgentMode): AgentMode {
    return override ?? defaultAgentMode(agent);
  }

  private log(job: JobRow, message: string): void {
    const trace = safeJson(job.trace, []) as string[];
    trace.push(`${nowIso()} ${message}`);
    job.trace = JSON.stringify(trace.slice(-200));
    jobRepo.updateStatus(job);
    persistEvent({
      type: 'job.started' as any,
      entity_type: 'job',
      entity_id: job.id,
      payload: JSON.stringify({ message }),
      created_at: nowIso(),
    });
  }
}

/** Map agent type -> content stage label used for lifecycle advancement. */
function stageFor(agent: AgentType): import('../domain/types.js').ContentStatus {
  switch (agent) {
    case 'research':
      return 'RESEARCHED';
    case 'script':
      return 'SCRIPTED';
    case 'director':
      return 'DIRECTED';
    case 'visual':
      return 'PRODUCING';
    case 'voice':
      return 'PRODUCING';
    case 'assembly':
      return 'ASSEMBLED';
    case 'qa':
      return 'QA';
    case 'publisher':
      return 'APPROVED_FOR_PUBLISH';
    // Analytics is a cross-content aggregation (Decision D-18), not a
    // per-content pipeline step; the terminal ANALYZED state reflects that the
    // content has been analysed by the system.
    case 'analytics':
      return 'ANALYZED';
    // Learning is also a global cross-content aggregation (Decision D-19);
    // the terminal ANALYZED state keeps the enum closed.
    case 'learning':
      return 'ANALYZED';
  }
}

/** Map agent type -> artifact kind. */
function defaultArtifactKind(agent: AgentType): string | undefined {
  switch (agent) {
    case 'research':
      return 'idea';
    case 'script':
      return 'script';
    case 'director':
      return 'production_plan';
    case 'visual':
      return 'assets';
    case 'voice':
      return 'voice';
    case 'assembly':
      return 'video';
    case 'qa':
      return 'qa';
    case 'publisher':
      return 'publish_package';
    // No per-content artifact for the global Analytics Agent.
    case 'analytics':
      return undefined;
    // No per-content artifact for the global Learning Agent.
    case 'learning':
      return undefined;
  }
}

/** Map agent type -> default approval kind. */
function defaultApprovalKind(agent: AgentType): string {
  switch (agent) {
    case 'research':
      return 'idea';
    case 'script':
      return 'script';
    case 'director':
      return 'plan';
    case 'visual':
      return 'asset';
    case 'voice':
      return 'audio';
    case 'assembly':
      return 'video';
    case 'qa':
      return 'video';
    case 'publisher':
      return 'publication';
    // Analytics is never a gated pipeline step; this path is unreachable.
    case 'analytics':
      return 'publication';
    // Learning is never a gated pipeline step; this path is unreachable.
    case 'learning':
      return 'publication';
  }
}

function activeSteps(pipeline: PipelineDefinition): PipelineDefinition['steps'] {
  return pipeline.steps;
}

function lastCompletedJobFor(contentId: string): JobRow | undefined {
  const jobs = jobRepo.listByContent(contentId).filter((j) => j.status === 'COMPLETED');
  return jobs[jobs.length - 1];
}
