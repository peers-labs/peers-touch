import { ATELIER_TASK_LIFECYCLE, ATELIER_TASK_LIFECYCLE_STATES } from '../domain/projection.contract.generated';

export type AtelierTaskActionKind = 'archive' | 'restore' | 'delete' | 'purge';
export type AtelierTaskLifecycleStatus = typeof ATELIER_TASK_LIFECYCLE_STATES[number];

export interface AtelierTaskSetStatusIntent {
  kind: 'setStatus';
  taskId: string;
  action: Exclude<AtelierTaskActionKind, 'purge'>;
  status: AtelierTaskLifecycleStatus;
}

export interface AtelierTaskPurgeIntent {
  kind: 'purge';
  taskId: string;
  action: 'purge';
}

export type AtelierTaskLifecycleIntent = AtelierTaskSetStatusIntent | AtelierTaskPurgeIntent;

export type AtelierTaskLifecycleIntentResult =
  | { status: 'ready'; intent: AtelierTaskLifecycleIntent }
  | { status: 'confirm-purge'; taskId: string }
  | { status: 'blocked' }
  | { status: 'invalid' };

export function buildAtelierTaskLifecycleIntent(input: {
  taskId: string;
  action: AtelierTaskActionKind | string;
  pendingTaskActionId: string;
  purgeConfirmTaskId: string;
  taskStatus?: string;
}): AtelierTaskLifecycleIntentResult {
  const taskId = input.taskId.trim();
  if (!taskId || input.pendingTaskActionId) return { status: 'blocked' };
  if (!isAtelierTaskActionKind(input.action)) return { status: 'invalid' };
  if (input.action === 'purge') {
    if (input.taskStatus !== ATELIER_TASK_LIFECYCLE.purgeRequiresStatus) return { status: 'invalid' };
    if (input.purgeConfirmTaskId !== taskId) return { status: 'confirm-purge', taskId };
    return { status: 'ready', intent: { kind: 'purge', taskId, action: 'purge' } };
  }
  const lifecycleStatus = taskLifecycleStatusForAction(input.action);
  if (!lifecycleStatus) return { status: 'invalid' };
  return {
    status: 'ready',
    intent: {
      kind: 'setStatus',
      taskId,
      action: input.action,
      status: lifecycleStatus,
    },
  };
}

function isAtelierTaskActionKind(value: string): value is AtelierTaskActionKind {
  return value === 'archive' || value === 'restore' || value === 'delete' || value === 'purge';
}

function taskLifecycleStatusForAction(action: Exclude<AtelierTaskActionKind, 'purge'>): AtelierTaskLifecycleStatus | null {
  const status = action === 'archive' ? 'archived' : action === 'restore' ? 'active' : 'deleted';
  return isAtelierTaskLifecycleStatus(status) ? status : null;
}

function isAtelierTaskLifecycleStatus(value: string): value is AtelierTaskLifecycleStatus {
  return (ATELIER_TASK_LIFECYCLE_STATES as readonly string[]).includes(value);
}
