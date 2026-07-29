import {
  ATELIER_TASK_LIFECYCLE,
  ATELIER_TASK_LIFECYCLE_STATES,
  type AtelierTaskLifecycleStatus,
} from './projection.contract.generated';
import type { AtelierState } from './types';

export type PrototypeTaskLifecycleIntent =
  | {
      status: 'invalid';
    }
  | {
      status: 'setStatus';
      taskId: string;
      taskStatus: AtelierTaskLifecycleStatus;
    }
  | {
      status: 'purge';
      taskId: string;
    };

export function buildPrototypeTaskLifecycleRequestKey(input: {
  kind: 'setStatus' | 'purge';
  taskId?: string;
  status?: string;
}): string {
  const taskId = input.taskId?.trim() || 'none';
  const status = input.status?.trim() || 'none';
  return `kind:${input.kind}|task:${taskId}|status:${status}`;
}

export function shouldApplyPrototypeTaskLifecycleSnapshot(input: {
  currentRequestKey: string;
  responseRequestKey: string;
}): boolean {
  return Boolean(input.responseRequestKey) && input.currentRequestKey === input.responseRequestKey;
}

export function buildPrototypeTaskStatusIntent(input: {
  taskId: string;
  status: string;
}): PrototypeTaskLifecycleIntent {
  const taskId = input.taskId.trim();
  const taskStatus = input.status.trim();
  if (!taskId || !isPrototypeTaskLifecycleStatus(taskStatus)) return { status: 'invalid' };
  return {
    status: 'setStatus',
    taskId,
    taskStatus,
  };
}

export function buildPrototypeTaskPurgeIntent(input: {
  taskId: string;
  taskStatus?: string;
}): PrototypeTaskLifecycleIntent {
  const taskId = input.taskId.trim();
  if (!taskId) return { status: 'invalid' };
  if (input.taskStatus !== ATELIER_TASK_LIFECYCLE.purgeRequiresStatus) return { status: 'invalid' };
  return {
    status: 'purge',
    taskId,
  };
}

function isPrototypeTaskLifecycleStatus(status: string): status is AtelierTaskLifecycleStatus {
  return ATELIER_TASK_LIFECYCLE_STATES.includes(status as AtelierTaskLifecycleStatus);
}

export function buildPrototypeTaskStatusProjection(input: {
  state: AtelierState;
  taskId: string;
  status: AtelierTaskLifecycleStatus;
}): AtelierState {
  const taskId = input.taskId.trim();
  if (!taskId || !isPrototypeTaskLifecycleStatus(input.status)) return input.state;

  return {
    ...input.state,
    tasks: input.state.tasks.map((task) =>
      task.id === taskId
        ? { ...task, status: input.status, running: input.status === 'active' ? task.running : false }
        : task,
    ),
  };
}

export function buildPrototypeTaskPurgeProjection(input: {
  state: AtelierState;
  selectedTaskId: string;
  taskId: string;
}): { state: AtelierState; selectedTaskId: string } {
  const taskId = input.taskId.trim();
  if (!taskId) return { state: input.state, selectedTaskId: input.selectedTaskId };

  const tasks = input.state.tasks.filter((task) => task.id !== taskId);
  const nextSelected = input.selectedTaskId === taskId ? tasks[0]?.id ?? '' : input.selectedTaskId;
  const { [taskId]: _stream, ...stream } = input.state.stream;
  const { [taskId]: _todos, ...todos } = input.state.todos;
  const { [taskId]: _context, ...context } = input.state.context;
  const { [taskId]: _artifacts, ...artifacts } = input.state.artifacts;
  const { [taskId]: _gates, ...gates } = input.state.gates;

  return {
    selectedTaskId: nextSelected,
    state: {
      ...input.state,
      selectedTaskId: nextSelected,
      tasks,
      stream,
      todos,
      context,
      artifacts,
      gates,
    },
  };
}
