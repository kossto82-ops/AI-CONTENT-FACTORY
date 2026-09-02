import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { getDB, type DB } from './db/database.js';
import { contentRepo, jobRepo, approvalRepo, artifactRepo, channelRepo } from './db/repository.js';
import { Orchestrator } from './orchestrator/orchestrator.js';
import { allRunners } from './agents/registry.js';
import { computeAnalytics, type AnalyticsInput } from './agents/analytics.js';
import { computeLearning, type LearningInput } from './agents/learning.js';
import { newId, nowIso } from './domain/types.js';
import type { AgentMode } from './domain/types.js';
import {
  listPipelines,
  loadPipeline,
  pipelineToApi,
  updateStepDefinition,
} from './pipelineStore.js';

const orchestrator = new Orchestrator();

const ASSETS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

// ---- helpers ----

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

/**
 * Delete a content row together with everything that references it, in one
 * transaction: jobs, executions (by job id), approvals, artifacts, events and
 * the content row itself. On-disk assets are removed by the caller. Tables
 * store content_id/job_id as plain columns (no ON DELETE CASCADE), so the
 * cleanup must be explicit.
 */
export function deleteContentDeep(id: string, db: DB): void {
  const jobIds = (db.prepare('SELECT id FROM job WHERE content_id = ?').all(id) as { id: string }[]).map(
    (r) => r.id,
  );
  const approvalIds = (
    db.prepare('SELECT id FROM approval WHERE content_id = ?').all(id) as { id: string }[]
  ).map((r) => r.id);

  db.exec('BEGIN');
  try {
    for (const jid of jobIds) {
      db.prepare('DELETE FROM execution WHERE job_id = ?').run(jid);
      db.prepare("DELETE FROM event WHERE entity_type='job' AND entity_id=?").run(jid);
    }
    for (const aid of approvalIds) {
      db.prepare("DELETE FROM event WHERE entity_type='approval' AND entity_id=?").run(aid);
    }
    db.prepare('DELETE FROM job WHERE content_id = ?').run(id);
    db.prepare('DELETE FROM approval WHERE content_id = ?').run(id);
    db.prepare('DELETE FROM artifact WHERE content_id = ?').run(id);
    db.prepare("DELETE FROM event WHERE entity_type='content' AND entity_id=?").run(id);
    db.prepare('DELETE FROM content WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function jobToApi(j: ReturnType<typeof jobRepo.listByContent>[number]) {
  return {
    id: j.id,
    type: j.type,
    status: j.status,
    contentId: j.content_id,
    attempt: j.attempt,
    maxRetries: j.max_retries,
    tokensIn: j.tokens_in,
    tokensOut: j.tokens_out,
    costEur: j.cost_eur,
    model: j.model,
    provider: j.provider,
    error: j.error,
    created_at: j.created_at,
    started_at: j.started_at,
    completed_at: j.completed_at,
    trace: safeParse(j.trace),
  };
}

function contentToApi(c: ReturnType<typeof contentRepo.list>[number]) {
  return {
    id: c.id,
    title: c.title,
    targetAge: c.target_age,
    format: c.format,
    hook: c.hook,
    status: c.status,
    currentVersion: c.current_version,
    channelId: c.channel_id,
    createdAt: c.created_at,
  };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/** Latest QA verdict (parsed) for a content, if any. */
function latestQaSummary(contentId: string): {
  status: string;
  score: number;
  issues: { severity: string; category: string; message: string; location?: string; suggestedFix?: string; autoFixable?: boolean }[];
  checklist?: Record<string, boolean | null>;
  reviewScope?: Record<string, boolean>;
  summary?: string;
} | null {
  const art = artifactRepo.latest(contentId, 'qa');
  if (!art) return null;
  const v = safeParse(art.payload) as {
    status?: string;
    score?: number;
    issues?: { severity: string; category: string; message: string; location?: string; suggestedFix?: string; autoFixable?: boolean }[];
    checklist?: Record<string, boolean | null>;
    reviewScope?: Record<string, boolean>;
    summary?: string;
  };
  if (!v.status) return null;
  return {
    status: v.status,
    score: v.score ?? 0,
    issues: v.issues ?? [],
    checklist: v.checklist,
    reviewScope: v.reviewScope,
    summary: v.summary,
  };
}

const statusCounts = (): Record<string, number> => {
  const rows = getDB()
    .prepare('SELECT status, COUNT(*) AS n FROM job GROUP BY status')
    .all() as { status: string; n: number }[];
  return rows.reduce((acc, r) => {
    acc[r.status] = r.n;
    return acc;
  }, {} as Record<string, number>);
};

// ---- routes ----

type Route = { method: string; match: RegExp; handler: (m: RegExpMatchArray, req: IncomingMessage, res: ServerResponse) => Promise<void> | void };

const routes: Route[] = [
  {
    method: 'GET',
    match: /^\/api\/dashboard$/,
    async handler(_m, _req, res) {
      const pending = approvalRepo.listPending();
      const jobs = getDB().prepare('SELECT * FROM job ORDER BY created_at DESC LIMIT 50').all() as any[];
      sendJson(res, 200, {
        counts: statusCounts(),
        totalContent: contentRepo.list().length,
        pendingApprovals: pending.length,
        pendingApprovalList: pending.map(approvalToApi),
        recentJobs: jobs.map(jobToApi as any),
      });
    },
  },
  {
    method: 'GET',
    match: /^\/api\/agents$/,
    handler(_m, _req, res) {
      const jobs = getDB().prepare('SELECT * FROM job ORDER BY created_at').all() as any[];
      const agents = allRunners().map((a) => {
        const mine = jobs.filter((j) => j.type === a.type);
        const last = mine[mine.length - 1];
        return {
          type: a.type,
          name: a.name,
          status: last ? last.status : 'IDLE',
          mode: agentDefaultMode(a.type),
          lastJob: last ? jobToApi(last) : null,
          totalCost: mine.reduce((s, j) => s + (j.cost_eur || 0), 0),
          totalTokens: mine.reduce((s, j) => s + (j.tokens_in || 0) + (j.tokens_out || 0), 0),
        };
      });
      sendJson(res, 200, { agents });
    },
  },
  {
    method: 'GET',
    match: /^\/api\/analytics$/,
    handler(_m, _req, res) {
      const jobs = (getDB().prepare('SELECT * FROM job').all() as any[]).map((j) => ({
        content_id: j.content_id,
        type: j.type,
        status: j.status,
        cost_eur: j.cost_eur || 0,
        tokens_in: j.tokens_in || 0,
        tokens_out: j.tokens_out || 0,
        created_at: j.created_at,
        completed_at: j.completed_at,
      }));
      const contents = contentRepo.list().map((c) => ({
        id: c.id,
        status: c.status,
        created_at: c.created_at,
      }));
      const artifactRows = getDB()
        .prepare("SELECT kind, payload FROM artifact WHERE kind IN ('qa','publish_package')")
        .all() as { kind: string; payload: string }[];
      const qaVerdicts = artifactRows
        .filter((a) => a.kind === 'qa')
        .map((a) => safeParse(a.payload) as { status?: string; score?: number; issues?: { severity: string; category: string }[] })
        .filter((v) => v.status)
        .map((v) => ({
          status: v.status as 'approved' | 'rejected',
          score: v.score ?? 0,
          issues: (v.issues ?? []).map((i) => ({ severity: i.severity, category: i.category })),
        }));
      const publishPackages = artifactRows
        .filter((a) => a.kind === 'publish_package')
        .map((a) => safeParse(a.payload) as { status?: string; target?: string })
        .filter((p) => p.status)
        .map((p) => ({ status: p.status as 'SCHEDULED' | 'PUBLISHED', target: p.target ?? 'LocalExport' }));
      const input: AnalyticsInput = { jobs, qaVerdicts, publishPackages, contents };
      sendJson(res, 200, computeAnalytics(input));
    },
  },
  {
    method: 'GET',
    match: /^\/api\/learning$/,
    handler(_m, _req, res) {
      const jobs = (getDB().prepare('SELECT * FROM job').all() as any[]).map((j) => ({
        content_id: j.content_id,
        type: j.type,
        status: j.status,
        cost_eur: j.cost_eur || 0,
        tokens_in: j.tokens_in || 0,
        tokens_out: j.tokens_out || 0,
        created_at: j.created_at,
        completed_at: j.completed_at,
      }));
      const contents = contentRepo.list().map((c) => ({
        id: c.id,
        status: c.status,
        created_at: c.created_at,
      }));
      const artifactRows = getDB()
        .prepare("SELECT content_id, kind, version, payload FROM artifact WHERE kind IN ('qa','publish_package','production_plan')")
        .all() as { content_id: string; kind: string; version: number; payload: string }[];
      const qaVerdicts = artifactRows
        .filter((a) => a.kind === 'qa')
        .map((a) => {
          const v = safeParse(a.payload) as { content_id?: string; status?: string; score?: number; issues?: { severity: string; category: string }[] };
          return {
            content_id: a.content_id,
            status: v.status as 'approved' | 'rejected',
            score: v.score ?? 0,
            issues: (v.issues ?? []).map((i) => ({ severity: i.severity, category: i.category })),
          };
        })
        .filter((v) => v.status);
      const publishPackages = artifactRows
        .filter((a) => a.kind === 'publish_package')
        .map((a) => safeParse(a.payload) as { status?: string; target?: string })
        .filter((p) => p.status)
        .map((p) => ({ status: p.status as 'SCHEDULED' | 'PUBLISHED', target: p.target ?? 'LocalExport' }));

      // Source plans with provenance: any content that has a production plan,
      // enriched with its best QA score, format/target-age and total cost.
      const bestQa = new Map<string, number>();
      for (const v of qaVerdicts) {
        const cid = v.content_id ?? '';
        if (!cid) continue;
        bestQa.set(cid, Math.max(bestQa.get(cid) ?? 0, v.score ?? 0));
      }
      const costByContent = new Map<string, number>();
      for (const j of jobs) {
        if (!j.content_id) continue;
        costByContent.set(j.content_id, (costByContent.get(j.content_id) ?? 0) + (j.cost_eur || 0));
      }
      const contentById = new Map(contentRepo.list().map((c) => [c.id, c]));
      const plans = artifactRows
        .filter((a) => a.kind === 'production_plan')
        .map((a) => {
          const plan = safeParse(a.payload) as Parameters<typeof computeLearning>[0]['plans'][number]['plan'] | null;
          const c = contentById.get(a.content_id);
          if (!plan || !c) return null;
          return {
            contentId: a.content_id,
            plan,
            qaScore: bestQa.get(a.content_id) ?? 0,
            format: c.format,
            targetAge: c.target_age,
            totalCostEur: costByContent.get(a.content_id) ?? 0,
          };
        })
        .filter((p): p is NonNullable<typeof p> => p !== null);

      const input: LearningInput = { jobs, qaVerdicts, publishPackages, contents, plans };
      const result = computeLearning(input);

      // Persist the learning set (lessons/ideas/recommendations) atomically:
      // replace the previous run so the table always mirrors the latest result.
      const db = getDB();
      db.exec('BEGIN');
      try {
        db.prepare("DELETE FROM learning WHERE kind IN ('lesson','idea','recommendation')").run();
        const ins = db.prepare(
          'INSERT INTO learning (id, kind, source_content_id, title, body, payload, created_at) VALUES (?,?,?,?,?,?,?)',
        );
        for (const l of result.lessons) {
          ins.run(newId('learn'), 'lesson', null, l.title, l.body, JSON.stringify(l), result.generatedAt);
        }
        for (const id of result.ideas) {
          ins.run(
            newId('learn'), 'idea', id.sourceContentId, id.idea.title,
            id.idea.reason, JSON.stringify(id), result.generatedAt,
          );
        }
        for (const r of result.recommendations) {
          ins.run(newId('learn'), 'recommendation', null, r.action, r.reason, JSON.stringify(r), result.generatedAt);
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      sendJson(res, 200, result);
    },
  },
  {
    method: 'GET',
    match: /^\/api\/channels$/,
    handler(_m, _req, res) {
      sendJson(res, 200, {
        channels: channelRepo.list().map((c) => ({
          id: c.id,
          name: c.name,
          config: c.config ? safeParse(c.config) : null,
          createdAt: c.created_at,
        })),
      });
    },
  },
  {
    method: 'POST',
    match: /^\/api\/channels$/,
    async handler(_m, req, res) {
      const body = await readJson(req);
      const name = String(body.name ?? '').trim();
      if (!name) return sendJson(res, 400, { error: 'name is required' });
      const channel = channelRepo.list().find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (channel) return sendJson(res, 400, { error: `channel already exists: ${name}` });
      const id = `channel_${Math.random().toString(36).slice(2, 10)}`;
      const now = nowIso();
      channelRepo.insert({
        id,
        name,
        config: body.config ? JSON.stringify(body.config) : null,
        created_at: now,
        updated_at: now,
      });
      sendJson(res, 201, {
        id,
        name,
        config: body.config ? body.config : null,
        createdAt: now,
      });
    },
  },
  {
    method: 'PUT',
    match: /^\/api\/channels\/([^/]+)$/,
    async handler(m, req, res) {
      const id = m[1]!;
      const existing = channelRepo.get(id);
      if (!existing) return sendJson(res, 404, { error: 'channel not found' });
      const body = await readJson(req);
      const name = body.name === undefined ? existing.name : String(body.name).trim();
      if (!name) return sendJson(res, 400, { error: 'name cannot be empty' });
      const config = body.config === undefined ? existing.config : body.config !== null ? JSON.stringify(body.config) : null;
      channelRepo.updateConfig(id, name, config);
      sendJson(res, 200, {
        id,
        name,
        config: config ? JSON.parse(config) : null,
      });
    },
  },
  {
    method: 'GET',
    match: /^\/api\/content$/,
    handler(_m, _req, res) {
      const content = contentRepo.list().map((c) => {
        const base = contentToApi(c);
        const qa = latestQaSummary(c.id);
        const planArt = artifactRepo.latest(c.id, 'production_plan');
        const assetsArt = artifactRepo.latest(c.id, 'assets');
        const assetManifest = assetsArt
          ? (safeParse(assetsArt.payload) as { scenes?: { sceneId: string; file: string }[] } | null)
          : null;
        const audioArt = artifactRepo.latest(c.id, 'voice');
        const audioManifest = audioArt
          ? (safeParse(audioArt.payload) as { scenes?: { sceneId: string; file: string; mime?: string; durationSeconds?: number }[] } | null)
          : null;
        const videoArt = artifactRepo.latest(c.id, 'video');
        const assemblyManifest = videoArt ? safeParse(videoArt.payload) : null;
        const publishArt = artifactRepo.latest(c.id, 'publish_package');
        const publishPackage = publishArt ? safeParse(publishArt.payload) : null;
        return {
          ...base,
          planVersion: planArt?.version ?? 0,
          latestQa: qa
            ? { status: qa.status, score: qa.score, issues: qa.issues, checklist: qa.checklist, reviewScope: qa.reviewScope, summary: qa.summary }
            : null,
          revisable: qa?.status === 'rejected' && !!planArt,
          assetScenes: assetManifest?.scenes ?? [],
          audioScenes: audioManifest?.scenes ?? [],
          assemblyManifest,
          publishPackage,
        };
      });
      sendJson(res, 200, { content });
    },
  },
  {
    method: 'POST',
    match: /^\/api\/content$/,
    async handler(_m, req, res) {
      const body = await readJson(req);
      const channelId = body.channelId ? String(body.channelId) : undefined;
      if (channelId && !channelRepo.get(channelId)) {
        return sendJson(res, 400, { error: `channel not found: ${channelId}` });
      }
      const id = orchestrator.createContent(
        {
          topic: body.topic,
          targetAge: body.targetAge,
        },
        channelId,
      );
      sendJson(res, 201, { id });
    },
  },
  {
    method: 'GET',
    match: /^\/api\/content\/([^/]+)$/,
    handler(m, _req, res) {
      const id = m[1]!;
      const c = contentRepo.get(id);
      if (!c) return sendJson(res, 404, { error: 'content not found' });
      const jobs = jobRepo.listByContent(id).map(jobToApi);
      const approvals = getDB()
        .prepare('SELECT * FROM approval WHERE content_id=? ORDER BY created_at')
        .all(id) as any[];
      const artifacts = getDB()
        .prepare('SELECT kind, version, payload, created_at FROM artifact WHERE content_id=? ORDER BY kind, version')
        .all(id) as any[];
      const publishArt = artifactRepo.latest(id, 'publish_package');
      sendJson(res, 200, {
        content: contentToApi(c),
        jobs,
        approvals: approvals.map(approvalToApi),
        publishPackage: publishArt ? safeParse(publishArt.payload) : null,
        artifacts: artifacts.map((a) => ({
          kind: a.kind,
          version: a.version,
          payload: safeParse(a.payload),
          createdAt: a.created_at,
        })),
      });
    },
  },
  {
    method: 'DELETE',
    match: /^\/api\/content\/([^/]+)$/,
    async handler(m, _req, res) {
      const id = m[1]!;
      if (!contentRepo.get(id)) return sendJson(res, 404, { error: 'content not found' });

      try {
        deleteContentDeep(id, getDB());
      } catch (e) {
        return sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }

      // Remove the on-disk asset folder (safe if already absent).
      try {
        await rm(join(ASSETS_ROOT, id), { recursive: true, force: true });
      } catch {
        /* ignore missing/partial removal */
      }

      sendJson(res, 200, { deleted: true, id });
    },
  },
  {
    method: 'GET',
    match: /^\/api\/assets\/([^/]+)\/(.+)$/,
    async handler(m, _req, res) {
      const contentId = decodeURIComponent(m[1]!);
      const file = decodeURIComponent(m[2]!);
      // Prevent path traversal outside the content's asset dir. Allow one
      // optional subdirectory segment (e.g. "audio/<file>.wav") and no "..".
      if (
        /\.\./.test(file) ||
        !/^[\w.\- ]+(\/[\w.\- ]+)?$/.test(file) ||
        !/^[\w.\- ]+$/.test(contentId)
      ) {
        return sendJson(res, 400, { error: 'invalid asset path' });
      }
      const abs = join(ASSETS_ROOT, contentId, file);
      try {
        const data = await readFile(abs);
        const ext = file.split('.').pop()?.toLowerCase();
        const mime =
          ext === 'png' ? 'image/png' :
          ext === 'webp' ? 'image/webp' :
          ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
          ext === 'gif' ? 'image/gif' :
          ext === 'wav' ? 'audio/wav' :
          ext === 'mp3' ? 'audio/mpeg' :
          ext === 'ogg' ? 'audio/ogg' :
          ext === 'flac' ? 'audio/flac' :
          ext === 'mp4' ? 'video/mp4' :
          ext === 'webm' ? 'video/webm' :
          ext === 'mov' ? 'video/quicktime' :
          ext === 'vtt' ? 'text/vtt' :
          'application/octet-stream';
        res.writeHead(200, { 'content-type': mime, 'cache-control': 'public, max-age=3600' });
        res.end(data);
      } catch {
        sendJson(res, 404, { error: 'asset not found' });
      }
    },
  },
  {
    method: 'POST',
    match: /^\/api\/pipeline\/([^/]+)\/start$/,
    handler(m, _req, res) {
      const contentId = m[1]!;
      if (!contentRepo.get(contentId)) return sendJson(res, 404, { error: 'content not found' });
      const jobId = orchestrator.startPipeline(contentId, loadPipeline());
      sendJson(res, 200, { started: true, jobId, contentId });
    },
  },
  {
    method: 'POST',
    match: /^\/api\/content\/([^/]+)\/revise\/director$/,
    async handler(m, _req, res) {
      const contentId = m[1]!;
      if (!contentRepo.get(contentId)) return sendJson(res, 404, { error: 'content not found' });
      try {
        const jobId = orchestrator.revisePlan(contentId, loadPipeline());
        await orchestrator.drain(loadPipeline());
        sendJson(res, 200, { started: true, jobId, contentId, revision: true });
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
    },
  },
  {
    method: 'PUT',
    match: /^\/api\/content\/([^/]+)\/schedule$/,
    async handler(m, req, res) {
      const contentId = m[1]!;
      const c = contentRepo.get(contentId);
      if (!c) return sendJson(res, 404, { error: 'content not found' });
      const body = await readJson(req);
      const scheduledAt = body.scheduledAt === undefined || body.scheduledAt === null ? null : String(body.scheduledAt);
      try {
        const meta = safeParse(c.meta) as Record<string, unknown>;
        if (scheduledAt === null) delete meta.scheduledAt;
        else meta.scheduledAt = scheduledAt;
        contentRepo.updateMeta(contentId, JSON.stringify(meta));
        sendJson(res, 200, { contentId, scheduledAt });
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
    },
  },
  {
    method: 'POST',
    match: /^\/api\/jobs\/run$/,
    async handler(_m, _req, res) {
      const progressed = await orchestrator.drain(loadPipeline());
      sendJson(res, 200, { drained: true, progressed });
    },
  },
  {
    method: 'GET',
    match: /^\/api\/jobs\/([^/]+)$/,
    handler(m, _req, res) {
      const j = jobRepo.get(m[1]!);
      if (!j) return sendJson(res, 404, { error: 'job not found' });
      sendJson(res, 200, {
        ...jobToApi(j),
        input: safeParse(j.input),
        output: safeParse(j.output ?? 'null'),
        parentJob: j.parent_job,
        dependency: j.dependency,
      });
    },
  },
  {
    method: 'GET',
    match: /^\/api\/approvals$/,
    handler(_m, _req, res) {
      sendJson(res, 200, { approvals: approvalRepo.listPending().map(approvalToApi) });
    },
  },
  {
    method: 'POST',
    match: /^\/api\/approvals\/([^/]+)\/decide$/,
    async handler(m, req, res) {
      const body = await readJson(req);
      const status = body.status === 'APPROVED' ? 'APPROVED' : body.status === 'REJECTED' ? 'REJECTED' : undefined;
      if (!status) return sendJson(res, 400, { error: 'status must be APPROVED or REJECTED' });
      try {
        orchestrator.decideApproval(
          { approvalId: m[1]!, status, decision: body.decision ? String(body.decision) : undefined },
          loadPipeline(),
        );
        if (status === 'APPROVED') {
          // Advance the pipeline in the background instead of awaiting the full
          // drain: a drain runs every chained LLM job and can take minutes (or
          // stall on a hung gateway call), which would otherwise leave the
          // approve HTTP request hanging and freeze the Control Center UI.
          void orchestrator.drain(loadPipeline()).catch((e) => {
            // eslint-disable-next-line no-console
            console.error('[aicf] background drain after approval failed:', e);
          });
        }
        sendJson(res, 200, { decided: true, status });
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
    },
  },
  {
    method: 'GET',
    match: /^\/api\/pipelines$/,
    handler(_m, _req, res) {
      sendJson(res, 200, {
        pipelines: listPipelines().map((p) => ({ id: p.id, name: p.name })),
        active: pipelineToApi(loadPipeline()),
      });
    },
  },
  {
    method: 'PUT',
    match: /^\/api\/pipelines\/([^/]+)\/steps\/([^/]+)$/,
    async handler(m, req, res) {
      const pipelineId = m[1]!;
      const agent = m[2]!;
      const body = await readJson(req);
      try {
        const updated = updateStepDefinition({
          pipelineId,
          agent,
          mode: body.mode as AgentMode | undefined,
          requiresApproval:
            body.requiresApproval === undefined ? undefined : Boolean(body.requiresApproval),
          approvalKind: body.approvalKind as any,
        });
        sendJson(res, 200, { pipeline: pipelineToApi(updated) });
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
    },
  },
  {
    method: 'POST',
    match: /^\/api\/jobs\/([^/]+)\/run$/,
    async handler(m, _req, res) {
      const jobId = m[1]!;
      try {
        const done = await orchestrator.runJob(jobId, loadPipeline());
        sendJson(res, 200, { ran: true, progressed: done, jobId });
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
    },
  },
];

function approvalToApi(a: ReturnType<typeof approvalRepo.listPending>[number]) {
  return {
    id: a.id,
    contentId: a.content_id,
    jobId: a.job_id,
    kind: a.kind,
    status: a.status,
    requestReason: a.request_reason,
    createdAt: a.created_at,
  };
}

function agentDefaultMode(type: string): AgentMode {
  switch (type) {
    case 'research':
    case 'qa':
    case 'visual':
    case 'voice':
    case 'assembly':
    case 'publisher':
    case 'analytics':
    case 'learning':
      return 'AUTOMATIC';
    default:
      return 'SEMI_AUTOMATIC';
  }
}

// ---- server ----

export function startServer(): ReturnType<typeof createServer> {
  const server = createServer(async (req, res) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // CORS for the Vite dev server (localhost:5173).
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET,POST,PUT,OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    for (const r of routes) {
      if (r.method === method) {
        const m = url.match(r.match);
        if (m) {
          try {
            await r.handler(m, req, res);
          } catch (e) {
            sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
          }
          return;
        }
      }
    }
    sendJson(res, 404, { error: `not found: ${method} ${url}` });
  });

  server.listen(config.server.port, config.server.host, () => {
    // eslint-disable-next-line no-console
    console.log(`[aicf] API listening on http://${config.server.host}:${config.server.port}`);
  });
  return server;
}

