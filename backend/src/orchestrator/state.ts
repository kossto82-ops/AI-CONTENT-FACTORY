import { contentRepo, jobRepo, type JobRow } from '../db/repository.js';
import { eventBus } from '../events/bus.js';
import {
  type ApprovalStatus,
  type ContentStatus,
  type EventType,
  type JobStatus,
  nowIso,
} from '../domain/types.js';

/**
 * Centralized job + content state transitions (Section 9: no scattered state
 * logic). All allowed transitions live here; the Orchestrator only calls these
 * helpers.
 */

const JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  PENDING: ['READY', 'CANCELLED'],
  READY: ['RUNNING', 'CANCELLED'],
  RUNNING: ['COMPLETED', 'FAILED', 'WAITING_APPROVAL', 'CANCELLED', 'READY'],
  WAITING_APPROVAL: ['READY', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: ['READY', 'CANCELLED'], // READY allows retry
  CANCELLED: [],
};

const CONTENT_ORDER: ContentStatus[] = [
  'IDEA',
  'RESEARCHED',
  'APPROVED',
  'SCRIPTED',
  'DIRECTED',
  'PRODUCING',
  'ASSEMBLED',
  'QA',
  'APPROVED_FOR_PUBLISH',
  'PUBLISHED',
  'SCHEDULED',
  'ANALYZED',
];

export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Invalid transition: ${from} -> ${to}`);
  }
}

/** Compute the content status reachable from current after a forward step. */
function nextContentStatus(prev: ContentStatus): ContentStatus {
  const i = CONTENT_ORDER.indexOf(prev);
  if (i === -1 || i === CONTENT_ORDER.length - 1) return prev;
  return CONTENT_ORDER[i + 1]!;
}

/**
 * Core job transition. Validates, mutates the row in memory, persists, emits.
 * Returns false if the transition is not allowed.
 */
export function transitionJob(job: JobRow, to: JobStatus): boolean {
  if (job.status === to) return true; // idempotent no-op
  const allowed = JOB_TRANSITIONS[job.status] ?? [];
  if (!allowed.includes(to)) {
    throw new InvalidTransitionError(job.status, to);
  }
  const from = job.status;
  job.status = to;
  if (to === 'RUNNING') job.started_at = job.started_at ?? nowIso();
  if (to === 'COMPLETED') job.completed_at = nowIso();
  if (to === 'FAILED') job.completed_at = nowIso();
  if (to === 'CANCELLED') job.completed_at = nowIso();
  jobRepo.updateStatus(job);

  const eventMap: Record<string, EventType> = {
    COMPLETED: 'job.completed',
    FAILED: 'job.failed',
    CANCELLED: 'job.cancelled',
    WAITING_APPROVAL: 'approval.requested',
  };
  if (to === 'RUNNING') {
    eventBus.emit({ type: 'job.started', entityId: job.id, entityType: 'job', payload: { type: job.type }, at: nowIso() });
  }
  const evt = eventMap[to];
  if (evt) {
    eventBus.emit({
      type: evt,
      entityId: job.id,
      entityType: 'job',
      payload: { type: job.type, from, to },
      at: nowIso(),
    });
  }
  return true;
}

/** Advance a content object one lifecycle step. Returns the new status. */
export function advanceContent(contentId: string, to?: ContentStatus): ContentStatus {
  const c = contentRepo.get(contentId);
  if (!c) throw new Error(`Content not found: ${contentId}`);
  const target = to ?? nextContentStatus(c.status);
  contentRepo.setStatus(contentId, target);
  eventBus.emit({
    type: 'content.status_changed',
    entityId: contentId,
    entityType: 'content',
    payload: { from: c.status, to: target },
    at: nowIso(),
  });
  return target;
}

export interface ApprovalDecisionInput {
  approvalId: string;
  status: ApprovalStatus;
  decision?: string;
  notifyJobId?: string;
}
