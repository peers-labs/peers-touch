import {
  ATELIER_DEFAULT_TASK_ORGANIZER_MODE,
  ATELIER_TASK_LIFECYCLE_STATES,
  ATELIER_TASK_ORGANIZER_MODES,
  type AtelierTaskLifecycleStatus,
} from './projection.contract.generated';
import type { Task, TaskPlugin, TaskStatus } from './types';

export type PrototypeTaskOrganizerActionKey = 'archive' | 'delete' | 'restore' | 'purge';

export interface PrototypeTaskOrganizerActionView {
  key: PrototypeTaskOrganizerActionKey;
  label: string;
  danger: boolean;
}

export interface PrototypeTaskOrganizerRowView {
  selected: boolean;
  confirmingPurge: boolean;
  actions: PrototypeTaskOrganizerActionView[];
}

export interface PrototypeTaskOrganizerBuckets {
  active: Task[];
  archived: Task[];
  deleted: Task[];
}

export interface PrototypeTaskOrganizerFoldersView extends PrototypeTaskOrganizerBuckets {
  projectOrder: string[];
}

export interface PrototypeTaskOrganizerPluginDescriptorView {
  id: TaskPlugin['id'];
  ready: boolean;
}

const TASK_ORGANIZER_ACTIONS_BY_STATUS: Record<TaskStatus, (input: {
  confirmingPurge: boolean;
}) => PrototypeTaskOrganizerActionView[]> = {
  active: () => [
    { key: 'archive', label: '归档', danger: false },
    { key: 'delete', label: '删除', danger: true },
  ],
  archived: () => [
    { key: 'restore', label: '恢复到进行中', danger: false },
    { key: 'delete', label: '删除', danger: true },
  ],
  deleted: ({ confirmingPurge }) => [
    { key: 'restore', label: '还原', danger: false },
    { key: 'purge', label: confirmingPurge ? '确认彻底删除' : '彻底删除', danger: true },
  ],
};

export function derivePrototypeTaskOrganizerRowView(input: {
  task: Task;
  selectedId: string;
  purgeConfirmId: string;
}): PrototypeTaskOrganizerRowView {
  const confirmingPurge = input.task.status === 'deleted' && input.purgeConfirmId === input.task.id;
  return {
    selected: input.selectedId === input.task.id,
    confirmingPurge,
    actions: TASK_ORGANIZER_ACTIONS_BY_STATUS[input.task.status]({ confirmingPurge }),
  };
}

export function derivePrototypeTaskOrganizerBuckets(tasks: Task[]): PrototypeTaskOrganizerBuckets {
  return {
    active: tasks.filter((task) => task.status === 'active'),
    archived: tasks.filter((task) => task.status === 'archived'),
    deleted: tasks.filter((task) => task.status === 'deleted'),
  };
}

export function derivePrototypeTaskOrganizerFoldersView(tasks: Task[]): PrototypeTaskOrganizerFoldersView {
  const buckets = derivePrototypeTaskOrganizerBuckets(tasks);
  const projectOrder: string[] = [];
  for (const task of buckets.active) {
    if (!projectOrder.includes(task.project)) projectOrder.push(task.project);
  }
  return {
    ...buckets,
    projectOrder,
  };
}

export function taskOrganizerActionToLifecycleStatus(
  action: PrototypeTaskOrganizerActionKey,
): AtelierTaskLifecycleStatus | null {
  if (action === 'archive') return 'archived';
  if (action === 'delete') return 'deleted';
  if (action === 'restore') return 'active';
  return null;
}

export function prototypeTaskOrganizerPluginDescriptors(): PrototypeTaskOrganizerPluginDescriptorView[] {
  return ATELIER_TASK_ORGANIZER_MODES.map((mode) => ({
    id: mode.id,
    ready: mode.ready,
  }));
}

export function prototypeDefaultTaskOrganizerPluginId(): TaskPlugin['id'] {
  return ATELIER_DEFAULT_TASK_ORGANIZER_MODE;
}

export function assertPrototypeTaskOrganizerLifecycleTaxonomy(): readonly TaskStatus[] {
  return ATELIER_TASK_LIFECYCLE_STATES;
}
