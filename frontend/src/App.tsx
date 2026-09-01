import { useCallback, useEffect, useState } from 'react';
import { api, type Agent, type Approval, type Content, type Dashboard } from './api';
import { Badge, Btn, Card, SectionTitle, Stat, toneForStatus } from './ui';

type Tab = 'dashboard' | 'agents' | 'content' | 'approvals';

export function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [content, setContent] = useState<Content[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [d, a, c, ap] = await Promise.all([
        api.dashboard(),
        api.agents(),
        api.content(),
        api.approvals(),
      ]);
      setDash(d);
      setAgents(a.agents);
      setContent(c.content);
      setApprovals(ap.approvals);
      setApiOk(true);
      setError(null);
    } catch (e) {
      setApiOk(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const wrap = useCallback(
    async (p: Promise<unknown>, okMsg: string) => {
      setBusy(true);
      try {
        await p;
        notify(okMsg);
        await refresh();
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [refresh, notify],
  );

  const tabs: { id: Tab; label: string }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'agents', label: 'Agents' },
    { id: 'content', label: 'Content' },
    { id: 'approvals', label: `Approvals${approvals.length ? ` (${approvals.length})` : ''}` },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <Header apiOk={apiOk} onRefresh={refresh} busy={busy} />

      <nav className="mx-auto flex w-full max-w-6xl gap-1 border-b border-ink-700/50 px-4">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-3 text-sm font-medium transition ${
              tab === t.id
                ? 'border-b-2 border-accent-500 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {error && tab === 'dashboard' && apiOk === false && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            Cannot reach Control Center API: {error}. Is the backend running on :8787?
          </div>
        )}
        {tab === 'dashboard' && (
          <DashboardView
            dash={dash}
            approvals={approvals}
            onStartIdea={() =>
              wrap(api.createContent('curiosity and friendship for young children', '4-7'), 'Idea created')
            }
            onRunJobs={() => wrap(api.runJobs(), 'Jobs drained')}
            busy={busy}
          />
        )}
        {tab === 'agents' && <AgentsView agents={agents} />}
        {tab === 'content' && (
          <ContentView
            content={content}
            onStartPipeline={(id) => wrap(api.startPipeline(id), 'Pipeline started')}
            onRunJobs={() => wrap(api.runJobs(), 'Jobs drained')}
            busy={busy}
          />
        )}
        {tab === 'approvals' && (
          <ApprovalsView
            approvals={approvals}
            onDecide={(id, status, note) =>
              wrap(api.decideApproval(id, status, note), status === 'APPROVED' ? 'Approved' : 'Rejected')
            }
            busy={busy}
          />
        )}
      </main>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg border border-ink-700 bg-ink-800 px-4 py-2 text-sm text-slate-100 shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}

function Header({
  apiOk,
  onRefresh,
  busy,
}: {
  apiOk: boolean | null;
  onRefresh: () => void;
  busy: boolean;
}) {
  return (
    <header className="border-b border-ink-700/50 bg-ink-900/70">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="glow flex h-9 w-9 items-center justify-center rounded-lg bg-accent-500/10 text-accent-400">
            <span className="text-lg font-black">◉</span>
          </div>
          <div>
            <div className="text-base font-semibold text-slate-100">AI Content Factory</div>
            <div className="text-[11px] uppercase tracking-widest text-slate-500">Control Center</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 text-xs ${
              apiOk === false ? 'text-red-400' : apiOk ? 'text-emerald-400' : 'text-slate-500'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                apiOk === false ? 'bg-red-500' : apiOk ? 'bg-emerald-500' : 'bg-slate-500'
              }`}
            />
            {apiOk === false ? 'API offline' : apiOk ? 'API online' : 'connecting…'}
          </span>
          <Btn onClick={onRefresh} disabled={busy}>
            ⟳ Refresh
          </Btn>
        </div>
      </div>
    </header>
  );
}

function DashboardView({
  dash,
  approvals,
  onStartIdea,
  onRunJobs,
  busy,
}: {
  dash: Dashboard | null;
  approvals: Approval[];
  onStartIdea: () => void;
  onRunJobs: () => void;
  busy: boolean;
}) {
  const counts = dash?.counts ?? {};
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Ideas / Content" value={dash?.totalContent ?? 0} />
        <Stat label="Pending approvals" value={approvals.length} accent="text-amber-300" />
        <Stat label="Running jobs" value={counts.RUNNING ?? 0} accent="text-sky-300" />
        <Stat label="Failed jobs" value={counts.FAILED ?? 0} accent="text-red-300" />
        <Stat label="Completed jobs" value={counts.COMPLETED ?? 0} accent="text-emerald-300" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Btn kind="primary" onClick={onStartIdea} disabled={busy}>
          + New Idea
        </Btn>
        <Btn onClick={onRunJobs} disabled={busy} title="Advance any queued jobs (pipeline flow)">
          Run queued jobs
        </Btn>
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle>Systems / Pipeline</SectionTitle>
        </div>
        <PipelineFlow pendingApprovals={approvals.length} />
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-4">
          <SectionTitle>Awaiting approval</SectionTitle>
          <div className="mt-3 space-y-2">
            {approvals.length === 0 && <p className="text-sm text-slate-500">Nothing waiting.</p>}
            {approvals.map((a) => (
              <ApprovalRow key={a.id} a={a} compact />
            ))}
            {approvals.length > 0 && (
              <p className="pt-1 text-xs text-slate-500">Open the Approvals tab to decide.</p>
            )}
          </div>
        </Card>
        <Card className="p-4">
          <SectionTitle>Recent jobs</SectionTitle>
          <div className="mt-3 space-y-1.5">
            {!dash?.recentJobs?.length && <p className="text-sm text-slate-500">No jobs yet.</p>}
            {(dash?.recentJobs ?? []).slice(0, 8).map((j) => (
              <div key={j.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate font-mono text-xs text-slate-400">
                  {j.type} <span className="text-slate-600">{j.id.slice(0, 10)}</span>
                </span>
                <Badge tone={toneForStatus(j.status)}>{j.status}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function PipelineFlow({ pendingApprovals }: { pendingApprovals: number }) {
  const steps = ['Research', 'Script', 'Director', 'QA'];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-1.5">
          <div className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-sm text-slate-200">
            {s}
          </div>
          {i < steps.length - 1 && <span className="text-slate-600">→</span>}
        </div>
      ))}
      <span className="ml-3 text-xs text-slate-500">
        {pendingApprovals > 0 ? '⏸ waiting for human approval' : '· QA auto-runs · publish disabled (MVP)'}
      </span>
    </div>
  );
}

function AgentsView({ agents }: { agents: Agent[] }) {
  return (
    <div className="space-y-4">
      <SectionTitle>Agents</SectionTitle>
      <div className="grid gap-4 md:grid-cols-2">
        {agents.map((a) => (
          <Card key={a.type} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold text-slate-100">{a.name}</div>
                <div className="text-[11px] uppercase tracking-widest text-slate-500">
                  mode · {a.mode}
                </div>
              </div>
              <Badge tone={toneForStatus(a.status)}>{a.status}</Badge>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="text-slate-500">
                Cost <span className="text-slate-200">€{a.totalCost.toFixed(4)}</span>
              </div>
              <div className="text-slate-500">
                Tokens <span className="text-slate-200">{a.totalTokens.toLocaleString()}</span>
              </div>
            </div>
            {a.lastJob && (
              <div className="mt-2 border-t border-ink-700/50 pt-2 text-xs text-slate-500">
                last job: <span className="font-mono text-slate-400">{a.lastJob.id.slice(0, 10)}</span>{' '}
                · {a.lastJob.status}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function ContentView({
  content,
  onStartPipeline,
  onRunJobs,
  busy,
}: {
  content: Content[];
  onStartPipeline: (id: string) => void;
  onRunJobs: () => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionTitle>Content ({content.length})</SectionTitle>
        <Btn onClick={onRunJobs} disabled={busy}>
          Run queued jobs
        </Btn>
      </div>
      {content.length === 0 && (
        <Card className="p-6 text-sm text-slate-500">No content yet. Create an idea from the Dashboard.</Card>
      )}
      <div className="space-y-3">
        {content.map((c) => (
          <Card key={c.id} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-slate-100">{c.title ?? '(untitled idea)'}</div>
                <div className="font-mono text-[11px] text-slate-500">
                  {c.id} · {c.format ?? '—'} · {c.targetAge ?? '—'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={toneForStatus(c.status)}>{c.status}</Badge>
                <Btn kind="primary" onClick={() => onStartPipeline(c.id)} disabled={busy}>
                  Start pipeline
                </Btn>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ApprovalsView({
  approvals,
  onDecide,
  busy,
}: {
  approvals: Approval[];
  onDecide: (id: string, status: string, note?: string) => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-4">
      <SectionTitle>Human-in-the-loop approvals</SectionTitle>
      {approvals.length === 0 && (
        <Card className="p-6 text-sm text-slate-500">No pending approvals. All clear.</Card>
      )}
      <div className="space-y-3">
        {approvals.map((a) => (
          <ApprovalCard key={a.id} a={a} onDecide={onDecide} busy={busy} />
        ))}
      </div>
    </div>
  );
}

function ApprovalCard({
  a,
  onDecide,
  busy,
}: {
  a: Approval;
  onDecide: (id: string, status: string, note?: string) => void;
  busy: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold capitalize text-slate-100">{a.kind}</span>
            <Badge tone="WAITING_APPROVAL">AWAITING REVIEW</Badge>
          </div>
          <div className="font-mono text-[11px] text-slate-500">
            {a.id} · content {a.contentId}
          </div>
        </div>
        <div className="flex gap-2">
          <Btn kind="success" onClick={() => onDecide(a.id, 'APPROVED', 'approved in control center')} disabled={busy}>
            ✓ Approve
          </Btn>
          <Btn kind="danger" onClick={() => onDecide(a.id, 'REJECTED')} disabled={busy}>
            ✗ Reject
          </Btn>
        </div>
      </div>
    </Card>
  );
}

function ApprovalRow({ a, compact }: { a: Approval; compact?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm capitalize text-slate-200">{a.kind}</span>
      {!compact && <Badge tone="WAITING_APPROVAL">{a.status}</Badge>}
      {compact && <span className="font-mono text-[11px] text-slate-500">{a.contentId}</span>}
    </div>
  );
}
