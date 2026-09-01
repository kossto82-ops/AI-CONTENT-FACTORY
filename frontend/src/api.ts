// Typed client for the Control Center API (proxied through Vite to /api).

export interface Job {
  id: string;
  type: string;
  status: string;
  contentId: string | null;
  attempt: number;
  maxRetries: number;
  tokensIn: number;
  tokensOut: number;
  costEur: number;
  model: string | null;
  provider: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  trace: unknown[];
}

export interface QaIssue {
  severity: string;
  category: string;
  message: string;
}

export interface Content {
  id: string;
  title: string | null;
  targetAge: string | null;
  format: string | null;
  hook: string | null;
  status: string;
  currentVersion: number;
  createdAt: string;
  planVersion?: number;
  latestQa?: { status: string; score: number; issues: QaIssue[] } | null;
  revisable?: boolean;
}

export interface Approval {
  id: string;
  contentId: string | null;
  jobId: string | null;
  kind: string;
  status: string;
  requestReason: string | null;
  createdAt: string;
}

export interface Agent {
  type: string;
  name: string;
  status: string;
  mode: string;
  lastJob: Job | null;
  totalCost: number;
  totalTokens: number;
}

export interface Dashboard {
  counts: Record<string, number>;
  totalContent: number;
  pendingApprovals: number;
  pendingApprovalList: Approval[];
  recentJobs: Job[];
}

export type AgentMode = 'MANUAL' | 'SEMI_AUTOMATIC' | 'AUTOMATIC';

export interface PipelineStep {
  order: number;
  agent: string;
  mode?: AgentMode;
  requiresApproval?: boolean;
  approvalKind?: string;
}

export interface Pipeline {
  id: string;
  name: string;
  steps: PipelineStep[];
}

export interface PipelinesResponse {
  pipelines: { id: string; name: string }[];
  active: Pipeline;
}

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as { error?: string })?.error ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}

export const api = {
  dashboard: () => req<Dashboard>('/api/dashboard'),
  agents: () => req<{ agents: Agent[] }>('/api/agents'),
  content: () => req<{ content: Content[] }>('/api/content'),
  contentDetail: (id: string) =>
    req<{
      content: Content;
      jobs: Job[];
      approvals: Approval[];
      artifacts: { kind: string; version: number; payload: unknown; createdAt: string }[];
    }>(`/api/content/${id}`),
  approvals: () => req<{ approvals: Approval[] }>('/api/approvals'),
  pipelines: () => req<PipelinesResponse>('/api/pipelines'),
  updatePipelineStep: (
    pipelineId: string,
    agent: string,
    patch: { mode?: AgentMode; requiresApproval?: boolean; approvalKind?: string },
  ) =>
    req<{ pipeline: Pipeline }>(`/api/pipelines/${pipelineId}/steps/${agent}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  runJob: (jobId: string) =>
    req<{ ran: boolean; progressed: boolean; jobId: string }>(`/api/jobs/${jobId}/run`, { method: 'POST' }),
  revisePlan: (contentId: string) =>
    req<{ started: boolean; jobId: string; contentId: string }>(
      `/api/content/${contentId}/revise/director`,
      { method: 'POST' },
    ),
  createContent: (topic?: string, targetAge?: string) =>
    req<{ id: string }>('/api/content', {
      method: 'POST',
      body: JSON.stringify({ topic, targetAge }),
    }),
  startPipeline: (contentId: string) =>
    req<{ started: boolean; jobId: string }>(`/api/pipeline/${contentId}/start`, { method: 'POST' }),
  runJobs: () => req<{ drained: boolean; progressed: boolean }>('/api/jobs/run', { method: 'POST' }),
  decideApproval: (approvalId: string, status: string, decision?: string) =>
    req<{ decided: boolean; status: string }>(`/api/approvals/${approvalId}/decide`, {
      method: 'POST',
      body: JSON.stringify({ status, decision }),
    }),
};
