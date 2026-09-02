import { getDB, closeDB } from './db/database.js';
import { contentRepo, jobRepo, approvalRepo, channelRepo } from './db/repository.js';
import { Orchestrator } from './orchestrator/orchestrator.js';
import { DEFAULT_PIPELINE } from './pipeline.js';

/**
 * Brain-first CLI. Demonstrates the orchestration layer end-to-end without a UI.
 *
 *   new-content [--topic X] [--age Y] [--channel <channelId>]  create an Idea (content)
 *   channels                        list channels
 *   start <contentId>               materialize the first pipeline job
 *   run                             drain runnable jobs (AUTO/SEMI up to gates)
 *   approvals                       list pending human approvals
 *   approve <approvalId> [note]     approve a gate (resumes pipeline)
 *   reject  <approvalId> [note]     reject a gate (halts branch)
 *   status [contentId]              show content lifecycle + job ladder
 *   jobs                            list jobs
 */

const orchestrator = new Orchestrator();

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

function printJob(j: Awaited<ReturnType<typeof jobRepo.get>> & Record<string, any>): void {
  const cost = (j.cost_eur ?? 0).toFixed(4);
  const trace = (() => {
    try {
      return JSON.parse(j.trace ?? '[]');
    } catch {
      return [];
    }
  })() as string[];
  log(
    `${j.id.padEnd(18)} ${String(j.type).padEnd(10)} ${String(j.status).padEnd(18)} ` +
      `attempt=${j.attempt} tokensIn=${j.tokens_in} tokensOut=${j.tokens_out} cost=€${cost} model=${j.model ?? '-'}`,
  );
  for (const t of trace.slice(-3)) log(`    - ${t}`);
  if (j.error) log(`    ERROR: ${j.error}`);
}

function printApproval(a: Awaited<ReturnType<typeof approvalRepo.pending>>[number]): void {
  log(`${a.id.padEnd(18)} ${a.kind.padEnd(14)} ${a.status.padEnd(10)} content=${a.content_id} job=${a.job_id}`);
}

function printPipeline(contentId: string): void {
  const jobs = jobRepo.listByContent(contentId);
  const ladder: Record<string, string> = {};
  for (const j of jobs) ladder[j.type] = j.status;
  log(`Content ${contentId} ladder: ${JSON.stringify(ladder, null, 2)}`);
}

async function main(argv: string[]): Promise<void> {
  const cmd = argv[0];
  switch (cmd) {
    case 'new-content': {
      const topic = argValue(argv, '--topic') ?? undefined;
      const age = argValue(argv, '--age') ?? undefined;
      const channelId = argValue(argv, '--channel') ?? undefined;
      if (channelId && !channelRepo.get(channelId)) throw new Error(`Channel not found: ${channelId}`);
      const id = orchestrator.createContent({ topic, targetAge: age }, channelId);
      log(`Created content: ${id}${channelId ? ` (channel ${channelId})` : ''}`);
      break;
    }

    case 'channels': {
      const list = channelRepo.list();
      if (!list.length) {
        log('No channels.');
        break;
      }
      for (const c of list) {
        log(`${c.id.padEnd(24)} ${c.name}`);
      }
      break;
    }

    case 'start': {
      const contentId = argv[1];
      if (!contentId) throw new Error('usage: start <contentId>');
      const jobId = orchestrator.startPipeline(contentId, DEFAULT_PIPELINE);
      log(`Pipeline started. First job: ${jobId}`);
      printPipeline(contentId);
      break;
    }

    case 'run': {
      log('Draining runnable jobs…');
      const progressed = await orchestrator.drain(DEFAULT_PIPELINE);
      log(progressed ? 'Done draining (may be waiting for approval).' : 'Nothing runnable.');
      break;
    }

    case 'approvals': {
      const list = approvalRepo.listPending();
      if (!list.length) {
        log('No pending approvals.');
        break;
      }
      for (const a of list) printApproval(a);
      break;
    }

    case 'approve':
    case 'reject': {
      const id = argv[1];
      if (!id) throw new Error(`usage: ${cmd} <approvalId> [note]`);
      const note = argv.slice(2).join(' ') || undefined;
      orchestrator.decideApproval(
        { approvalId: id, status: cmd === 'approve' ? 'APPROVED' : 'REJECTED', decision: note },
        DEFAULT_PIPELINE,
      );
      log(`${cmd.toUpperCase()} ${id}`);
      // Auto-drain after approval to continue the pipeline.
      if (cmd === 'approve') {
        const progressed = await orchestrator.drain(DEFAULT_PIPELINE);
        if (progressed) log('Pipeline advanced after approval.');
      }
      break;
    }

    case 'status': {
      const contentId = argv[1];
      if (contentId) {
        const c = contentRepo.get(contentId);
        if (!c) throw new Error(`Content not found: ${contentId}`);
        log(`Content ${c.id} — status=${c.status} ${c.title ? `title="${c.title}"` : ''}`);
        for (const a of listArtifacts(contentId)) log(`  artifact ${a.kind} v${a.version}`);
        printPipeline(contentId);
      } else {
        for (const c of contentRepo.list()) {
          log(`${c.id.padEnd(18)} ${c.status} ${c.title ?? ''}`);
        }
      }
      break;
    }

    case 'jobs': {
      const contentId = argv[1];
      const jobs = contentId
        ? jobRepo.listByContent(contentId)
        : (getDB().prepare('SELECT * FROM job ORDER BY created_at').all() as any[]);
      if (!jobs.length) {
        log('No jobs.');
        break;
      }
      for (const j of jobs) printJob(j);
      break;
    }

    case 'dashboard': {
      const pending = approvalRepo.listPending();
      const running = jobRepo.listByStatus('RUNNING');
      const ready = jobRepo.listByStatus('READY');
      const failed = jobRepo.listByStatus('FAILED');
      log('=== AI Content Factory dashboard ===');
      log(`Pending approvals : ${pending.length}`);
      log(`Running jobs      : ${running.length}`);
      log(`Ready (queued)    : ${ready.length}`);
      log(`Failed jobs       : ${failed.length}`);
      log('--- content ---');
      for (const c of contentRepo.list()) log(`  ${c.id} ${c.status}`);
      log('--- pending approvals ---');
      for (const a of pending) printApproval(a);
      break;
    }

    case 'help':
    default:
      log(`
Commands:
  new-content [--topic X] [--age Y] [--channel <id>]  create an Idea (content)
  channels                            list channels
  start <contentId>                   materialize the first pipeline job
  run                                 drain runnable jobs
  approvals                           list pending approvals
  approve <approvalId> [note]         approve a gate (resumes pipeline)
  reject  <approvalId> [note]         reject a gate
  status [contentId]                  show content lifecycle + ladder
  jobs [contentId]                    list jobs
  dashboard                           overall status
`);
  }
}

function argValue(argv: string[], key: string): string | undefined {
  const i = argv.indexOf(key);
  return i !== -1 ? argv[i + 1] : undefined;
}

function listArtifacts(contentId: string): { kind: string; version: number }[] {
  return getDB()
    .prepare('SELECT kind, version FROM artifact WHERE content_id=? ORDER BY kind, version')
    .all(contentId) as any[];
}

main(process.argv.slice(2))
  .then(() => closeDB())
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error('Error:', e instanceof Error ? e.message : e);
    closeDB();
    process.exit(1);
  });
