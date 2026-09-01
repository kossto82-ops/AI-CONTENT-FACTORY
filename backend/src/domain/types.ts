/** Shared domain primitives: statuses, lifecycle states, id generation. */
import { randomUUID } from 'node:crypto';

export type AgentMode = 'MANUAL' | 'SEMI_AUTOMATIC' | 'AUTOMATIC';
export type AgentStatus =
  | 'IDLE'
  | 'READY'
  | 'RUNNING'
  | 'WAITING_APPROVAL'
  | 'ERROR'
  | 'DISABLED';

export type JobStatus =
  | 'PENDING' // created, waiting for dependencies
  | 'READY' // dependencies satisfied, waiting to run (manual or queued)
  | 'RUNNING'
  | 'WAITING_APPROVAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type ContentStatus =
  | 'IDEA'
  | 'RESEARCHED'
  | 'APPROVED'
  | 'SCRIPTED'
  | 'DIRECTED'
  | 'PRODUCING'
  | 'ASSEMBLED'
  | 'QA'
  | 'APPROVED_FOR_PUBLISH'
  | 'PUBLISHED'
  | 'ANALYZED';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type ApprovalKind = 'idea' | 'script' | 'plan' | 'asset' | 'video' | 'publication';

export type EventType =
  | 'content.created'
  | 'content.status_changed'
  | 'job.created'
  | 'job.started'
  | 'job.completed'
  | 'job.failed'
  | 'job.cancelled'
  | 'approval.requested'
  | 'approval.approved'
  | 'approval.rejected'
  | 'pipeline.started'
  | 'pipeline.finished';

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
