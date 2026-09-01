import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from './config.js';
import { getDB } from './db/database.js';
import { contentRepo, jobRepo, approvalRepo, artifactRepo } from './db/repository.js';
import { Orchestrator } from './orchestrator/orchestrator.js';
import { allRunners } from './agents/registry.js';
import type { AgentMode } from './domain/types.js';
import {
  listPipelines,
  loadPipeline,
  pipelineToApi,
  updateStepDefinition,
} from './pipelineStore.js';

const orchestrator = new Orchestrator();

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
    match: /^\/api\/content$/,
    handler(_m, _req, res) {
      sendJson(res, 200, { content: contentRepo.list().map(contentToApi) });
    },
  },
  {
    method: 'POST',
    match: /^\/api\/content$/,
    async handler(_m, req, res) {
      const body = await readJson(req);
      const id = orchestrator.createContent({
        topic: body.topic,
        targetAge: body.targetAge,
      });
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
      sendJson(res, 200, {
        content: contentToApi(c),
        jobs,
        approvals: approvals.map(approvalToApi),
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
          await orchestrator.drain(loadPipeline());
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

