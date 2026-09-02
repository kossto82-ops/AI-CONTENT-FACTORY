import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type Agent,
  type AgentMode,
  type Approval,
  type AssemblyManifest,
  type Content,
  type Dashboard,
  type Pipeline,
  type PipelineStep,
  type QaChecklist,
} from './api';
import { Badge, Btn, Card, SectionTitle, Stat, toneForStatus } from './ui';

type Tab = 'dashboard' | 'agents' | 'content' | 'approvals' | 'pipeline';

export function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [content, setContent] = useState<Content[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [d, a, c, ap, p] = await Promise.all([
        api.dashboard(),
        api.agents(),
        api.content(),
        api.approvals(),
        api.pipelines(),
      ]);
      setDash(d);
      setAgents(a.agents);
      setContent(c.content);
      setApprovals(ap.approvals);
      setPipeline(p.active);
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

  const saveStep = useCallback(
    (agent: string, patch: { mode?: AgentMode; requiresApproval?: boolean }) => {
      if (!pipeline) return;
      wrap(
        api.updatePipelineStep(pipeline.id, agent, patch),
        `Step ${agent} updated`,
      );
    },
    [wrap, pipeline],
  );

  const runManualJob = useCallback(
    (jobId: string) => wrap(api.runJob(jobId), 'Job run'),
    [wrap],
  );

  const revisePlan = useCallback(
    (contentId: string) => wrap(api.revisePlan(contentId), 'Revision started â€” new plan queued'),
    [wrap],
  );

  const tabs: { id: Tab; label: string }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'pipeline', label: 'Pipeline' },
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
            onRunManualJob={runManualJob}
            busy={busy}
          />
        )}
        {tab === 'agents' && <AgentsView agents={agents} />}
        {tab === 'pipeline' && (
          <PipelineView pipeline={pipeline} onSaveStep={saveStep} busy={busy} />
        )}
        {tab === 'content' && (
          <ContentView
            content={content}
            onStartPipeline={(id) => wrap(api.startPipeline(id), 'Pipeline started')}
            onRunJobs={() => wrap(api.runJobs(), 'Jobs drained')}
            onRevisePlan={revisePlan}
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
            <span className="text-lg font-black">â—‰</span>
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
            {apiOk === false ? 'API offline' : apiOk ? 'API online' : 'connectingâ€¦'}
          </span>
          <Btn onClick={onRefresh} disabled={busy}>
            âŸ³ Refresh
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
  onRunManualJob,
  busy,
}: {
  dash: Dashboard | null;
  approvals: Approval[];
  onStartIdea: () => void;
  onRunJobs: () => void;
  onRunManualJob: (jobId: string) => void;
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
                <span className="flex items-center gap-2">
                  <Badge tone={toneForStatus(j.status)}>{j.status}</Badge>
                  {j.status === 'READY' && (
                    <button
                      onClick={() => onRunManualJob(j.id)}
                      disabled={busy}
                      className="rounded-md border border-ink-700 px-2 py-0.5 text-[11px] font-medium text-slate-300 transition hover:bg-ink-700 disabled:opacity-40"
                    >
                      â–¶ Run
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function PipelineFlow({ pendingApprovals }: { pendingApprovals: number }) {
  const steps = ['Research', 'Script', 'Director', 'Visual', 'Voice', 'Assembly', 'QA'];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-1.5">
          <div className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-sm text-slate-200">
            {s}
          </div>
          {i < steps.length - 1 && <span className="text-slate-600">â†’</span>}
        </div>
      ))}
      <span className="ml-3 text-xs text-slate-500">
        {pendingApprovals > 0 ? 'â¸ waiting for human approval' : 'Â· QA auto-runs Â· publish disabled (MVP)'}
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
                  mode Â· {a.mode}
                </div>
              </div>
              <Badge tone={toneForStatus(a.status)}>{a.status}</Badge>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="text-slate-500">
                Cost <span className="text-slate-200">â‚¬{a.totalCost.toFixed(4)}</span>
              </div>
              <div className="text-slate-500">
                Tokens <span className="text-slate-200">{a.totalTokens.toLocaleString()}</span>
              </div>
            </div>
            {a.lastJob && (
              <div className="mt-2 border-t border-ink-700/50 pt-2 text-xs text-slate-500">
                last job: <span className="font-mono text-slate-400">{a.lastJob.id.slice(0, 10)}</span>{' '}
                Â· {a.lastJob.status}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function PipelineView({
  pipeline,
  onSaveStep,
  busy,
}: {
  pipeline: Pipeline | null;
  onSaveStep: (agent: string, patch: { mode?: AgentMode; requiresApproval?: boolean }) => void;
  busy: boolean;
}) {
  if (!pipeline) {
    return <Card className="p-6 text-sm text-slate-500">No pipeline loaded.</Card>;
  }
  return (
    <div className="space-y-4">
      <div>
        <SectionTitle>Pipeline â€” {pipeline.name}</SectionTitle>
        <p className="mt-1 text-xs text-slate-500">
          Per-step execution mode (AUTO / SEMI / MANUAL) and approval gates. Changes persist and
          apply to the next started pipeline.
        </p>
      </div>
      <div className="space-y-3">
        {pipeline.steps.map((s) => (
          <StepCard key={s.agent} step={s} onSaveStep={onSaveStep} busy={busy} />
        ))}
      </div>
    </div>
  );
}

function StepCard({
  step,
  onSaveStep,
  busy,
}: {
  step: PipelineStep;
  onSaveStep: (agent: string, patch: { mode?: AgentMode; requiresApproval?: boolean }) => void;
  busy: boolean;
}) {
  const mode = step.mode ?? 'AUTOMATIC';
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold capitalize text-slate-100">{step.agent}</div>
          <div className="text-[11px] uppercase tracking-widest text-slate-500">
            gate Â· {step.approvalKind ?? 'â€”'}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-400">
            Mode
            <select
              className="rounded-md border border-ink-700 bg-ink-800 px-2 py-1 text-sm text-slate-200"
              value={mode}
              onChange={(e) => onSaveStep(step.agent, { mode: e.target.value as AgentMode })}
              disabled={busy}
            >
              <option value="AUTOMATIC">AUTOMATIC</option>
              <option value="SEMI_AUTOMATIC">SEMI_AUTOMATIC</option>
              <option value="MANUAL">MANUAL</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input
              type="checkbox"
              checked={Boolean(step.requiresApproval)}
              onChange={(e) => onSaveStep(step.agent, { requiresApproval: e.target.checked })}
              disabled={busy}
              className="h-4 w-4 accent-accent-500"
            />
            Approval gate
          </label>
        </div>
      </div>
    </Card>
  );
}
function ContentView({
  content,
  onStartPipeline,
  onRunJobs,
  onRevisePlan,
  busy,
}: {
  content: Content[];
  onStartPipeline: (id: string) => void;
  onRunJobs: () => void;
  onRevisePlan: (id: string) => void;
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
          <ContentCard key={c.id} c={c} onStartPipeline={onStartPipeline} onRevisePlan={onRevisePlan} busy={busy} />
        ))}
      </div>
    </div>
  );
}

const QA_CHECKLIST_LABELS: { key: keyof QaChecklist; label: string }[] = [
  { key: 'duration_ok', label: 'Duration' },
  { key: 'resolution_ok', label: 'Resolution' },
  { key: 'vertical_9_16', label: 'Vertical 9:16' },
  { key: 'audio_clean', label: 'Audio' },
  { key: 'subtitles_present', label: 'Subtitles' },
  { key: 'clips_ok', label: 'Clips' },
  { key: 'visuals_clean', label: 'Visual' },
  { key: 'continuity_ok', label: 'Continuity' },
  { key: 'coherence_ok', label: 'Coherence' },
  { key: 'appropriateness_ok', label: 'Appropriate' },
  { key: 'metadata_complete', label: 'Metadata' },
];

function QaChecklistGrid({ checklist }: { checklist: QaChecklist }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {QA_CHECKLIST_LABELS.map(({ key, label }) => {
        const v = checklist[key];
        return (
          <span
            key={key}
            title={`${label}: ${v === null ? 'not checked' : v ? 'pass' : 'fail'}`}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              v === null
                ? 'bg-ink-800 text-slate-600'
                : v
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'bg-red-500/10 text-red-400'
            }`}
          >
            {v === null ? '—' : v ? '✓' : '✕'} {label}
          </span>
        );
      })}
    </div>
  );
}

function ContentCard({
  c,
  onStartPipeline,
  onRevisePlan,
  busy,
}: {
  c: Content;
  onStartPipeline: (id: string) => void;
  onRevisePlan: (id: string) => void;
  busy: boolean;
}) {
  const qa = c.latestQa;
  const video = c.assemblyManifest ?? null;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-slate-100">{c.title ?? '(untitled idea)'}</div>
          <div className="font-mono text-[11px] text-slate-500">
            {c.id} Â· {c.format ?? 'â€”'} Â· {c.targetAge ?? 'â€”'}
            {c.planVersion ? ` Â· plan v${c.planVersion}` : ''}
          </div>
{qa && (
            <div className="mt-2 max-w-xl space-y-1">
              <span className={`text-[11px] font-semibold uppercase tracking-widest ${qa.status === 'rejected' ? 'text-red-400' : 'text-emerald-400'}`}>
                QA {qa.status} · score {qa.score.toFixed(1)}
              </span>
              {qa.summary && <p className="text-xs text-slate-500">{qa.summary}</p>}
              {qa.checklist && (
                <QaChecklistGrid checklist={qa.checklist} />
              )}
              {qa.status === 'rejected' &&
                qa.issues.slice(0, 3).map((i, n) => (
                  <p key={n} className="text-xs text-slate-500">
                    <span className="uppercase text-red-400/80">[{i.severity}]</span>{' '}
                    <span className="capitalize text-slate-400">{i.category}</span>
                    {i.location ? <span className="font-mono text-[10px] text-slate-600"> · {i.location}</span> : null} {i.message}
                  </p>
                ))}
            </div>
          )}
          {c.assetScenes && c.assetScenes.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {c.assetScenes.map((s) => (
                <img
                  key={s.sceneId}
                  src={`/api/assets/${c.id}/${s.file}`}
                  alt={s.sceneId}
                  title={s.sceneId}
                  className="h-20 w-12 rounded border border-slate-700 object-cover"
                  loading="lazy"
                />
              ))}
            </div>
          )}
          {c.audioScenes && c.audioScenes.length > 0 && (
            <div className="mt-3 space-y-1">
              {c.audioScenes.map((s) => (
                <div key={s.sceneId} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 truncate font-mono text-[11px] text-slate-500">
                    {s.sceneId}
                    {s.durationSeconds ? ` Â· ${s.durationSeconds}s` : ''}
                  </span>
                  <audio
                    controls
                    preload="none"
                    className="h-8 w-64 max-w-full"
                    src={`/api/assets/${c.id}/audio/${s.file}`}
                  >
                    <source src={`/api/assets/${c.id}/audio/${s.file}`} type={s.mime} />
                  </audio>
                </div>
              ))}
            </div>
          )}
          {video && <FinalVideoPreview content={c} video={video} />}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={toneForStatus(c.status)}>{c.status}</Badge>
          {c.revisable && (
            <Btn kind="danger" onClick={() => onRevisePlan(c.id)} disabled={busy} title="Re-run Director to revise the plan after QA rejection">
              â†» Revise plan
            </Btn>
          )}
          <Btn kind="primary" onClick={() => onStartPipeline(c.id)} disabled={busy}>
            Start pipeline
          </Btn>
        </div>
      </div>
    </Card>
  );
}

function FinalVideoPreview({ content, video }: { content: Content; video: AssemblyManifest }) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const scenes = video.scenes;
  const current = scenes[idx];

  useEffect(() => {
    if (!playing || scenes.length === 0) return;
    const sceneDur = Math.max(1, (current?.endSec ?? 1) - (current?.startSec ?? 0));
    const t = setTimeout(() => {
      if (idx + 1 >= scenes.length) {
        setIdx(0);
      } else {
        setIdx(idx + 1);
      }
    }, sceneDur * 1000);
    return () => clearTimeout(t);
  }, [playing, idx, scenes, current]);

  if (!current) return null;
  const clipUrl = `/api/assets/${content.id}/assembly/${current.clipFile}`;
  const voiceUrl = `/api/assets/${content.id}/audio/${current.voiceFile}`;
  const subtitleUrl = `/api/assets/${content.id}/assembly/${video.subtitleFile}`;
  const isAnimated = current.clipMime === 'image/gif';
  const isVideo = current.clipMime.startsWith('video/');

  return (
    <div className="mt-3 w-full max-w-md rounded-xl border border-ink-700/60 bg-ink-850 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-accent-400">
          Final video Â· {video.videoId}
        </span>
        <div className="flex gap-2 text-[11px] text-slate-500">
          <a className="underline hover:text-slate-300" href={subtitleUrl} target="_blank" rel="noreferrer">
            subtitles.vtt
          </a>
          <a
            className="underline hover:text-slate-300"
            href={`/api/assets/${content.id}/${video.poster}`}
            target="_blank"
            rel="noreferrer"
          >
            poster
          </a>
        </div>
      </div>

      <div className="mx-auto w-fit">
        <div className="relative h-64 w-36 overflow-hidden rounded-lg border border-slate-700 bg-black">
          {isAnimated && <img src={clipUrl} alt={current.sceneId} className="h-full w-full object-cover" />}
          {isVideo && (
            <video key={current.sceneId} src={clipUrl} className="h-full w-full object-cover" muted loop autoPlay={playing} />
          )}
          {!isAnimated && !isVideo && (
            <img src={`/api/assets/${content.id}/${current.visualFile}`} alt={current.sceneId} className="h-full w-full object-cover" />
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1 pt-6 text-[11px] text-slate-200">
            {current.sceneId} Â· {current.startSec.toFixed(1)}sâ€“{current.endSec.toFixed(1)}s
          </div>
        </div>
      </div>

      <div className="mt-2 min-h-8 text-center text-xs text-slate-300">
        {current.narration}
      </div>

      {isVideo && (
        <audio key={current.sceneId} controls autoPlay={playing} className="mt-1 h-8 w-full" src={voiceUrl} />
      )}
      {isAnimated && (
        <div className="mt-1 h-8" title="Voice plays while the animated clip paces the scene" />
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {scenes.map((s, i) => (
            <button
              key={s.sceneId}
              onClick={() => {
                setIdx(i);
                setPlaying(false);
              }}
              title={s.sceneId}
              className={`h-2 w-2 rounded-full transition ${i === idx ? 'bg-accent-400' : 'bg-slate-600 hover:bg-slate-400'}`}
            />
          ))}
        </div>
        <div className="flex gap-1.5">
          <Btn onClick={() => { setPlaying(false); setIdx(Math.max(0, idx - 1)); }}>
            â€¹ Prev
          </Btn>
          <Btn kind={playing ? 'default' : 'primary'} onClick={() => setPlaying(!playing)}>
            {playing ? 'âšâš Pause' : 'â–¶ Play'}
          </Btn>
          <Btn onClick={() => { setPlaying(false); setIdx(Math.min(scenes.length - 1, idx + 1)); }}>
            Next â€º
          </Btn>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-ink-700/50 pt-2 text-[11px] text-slate-500">
        <span>
          {video.resolution} Â· {video.aspectRatio} Â· {video.fps}fps
        </span>
        <span>
          {video.durationSec}s Â· {video.scenes.length} scenes
        </span>
        <span className="capitalize">model: {video.model.replace(/^stub-/, 'stub Â· ')}</span>
        <span>provider: {video.provider}</span>
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
            {a.id} Â· content {a.contentId}
          </div>
        </div>
        <div className="flex gap-2">
          <Btn kind="success" onClick={() => onDecide(a.id, 'APPROVED', 'approved in control center')} disabled={busy}>
            âœ“ Approve
          </Btn>
          <Btn kind="danger" onClick={() => onDecide(a.id, 'REJECTED')} disabled={busy}>
            âœ— Reject
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
