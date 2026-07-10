import { describe, expect, it } from 'vitest';
import {
  ATELIER_DEFAULT_TASK_ORGANIZER_MODE,
  ATELIER_TASK_LIFECYCLE_STATES,
  ATELIER_TASK_ORGANIZER_MODES,
} from './projection.contract.generated';
import {
  assertPrototypeTaskOrganizerLifecycleTaxonomy,
  derivePrototypeTaskOrganizerBuckets,
  derivePrototypeTaskOrganizerFoldersView,
  derivePrototypeTaskOrganizerRowView,
  prototypeDefaultTaskOrganizerPluginId,
  prototypeTaskOrganizerPluginDescriptors,
  taskOrganizerActionToLifecycleStatus,
} from './prototypeTaskOrganizerProjection';
import type { Task, TaskStatus } from './types';

function task(id: string, status: TaskStatus, project = 'repo'): Task {
  return {
    id,
    title: `Task ${id}`,
    project,
    status,
  };
}

describe('derivePrototypeTaskOrganizerRowView', () => {
  it('derives active task lifecycle actions without execution actions', () => {
    expect(derivePrototypeTaskOrganizerRowView({
      task: task('task-1', 'active'),
      selectedId: 'task-1',
      purgeConfirmId: '',
    })).toMatchObject({
      selected: true,
      confirmingPurge: false,
      actions: [
        { key: 'archive', label: '归档', danger: false },
        { key: 'delete', label: '删除', danger: true },
      ],
    });
  });

  it('derives archived task lifecycle actions as restore or delete only', () => {
    expect(derivePrototypeTaskOrganizerRowView({
      task: task('task-1', 'archived'),
      selectedId: '',
      purgeConfirmId: '',
    }).actions).toEqual([
      { key: 'restore', label: '恢复到进行中', danger: false },
      { key: 'delete', label: '删除', danger: true },
    ]);
  });

  it('derives deleted task purge confirmation labels without bypassing Station precondition', () => {
    expect(derivePrototypeTaskOrganizerRowView({
      task: task('task-1', 'deleted'),
      selectedId: '',
      purgeConfirmId: '',
    }).actions).toContainEqual({ key: 'purge', label: '彻底删除', danger: true });
    expect(derivePrototypeTaskOrganizerRowView({
      task: task('task-1', 'deleted'),
      selectedId: '',
      purgeConfirmId: 'task-1',
    })).toMatchObject({
      confirmingPurge: true,
      actions: [
        { key: 'restore', label: '还原', danger: false },
        { key: 'purge', label: '确认彻底删除', danger: true },
      ],
    });
  });
});

describe('derivePrototypeTaskOrganizerBuckets', () => {
  it('partitions projected tasks by generated workbench lifecycle status', () => {
    expect(derivePrototypeTaskOrganizerBuckets([
      task('active-1', 'active'),
      task('archived-1', 'archived'),
      task('deleted-1', 'deleted'),
    ])).toMatchObject({
      active: [task('active-1', 'active')],
      archived: [task('archived-1', 'archived')],
      deleted: [task('deleted-1', 'deleted')],
    });
  });

  it('preserves first-seen active project order for folders view', () => {
    expect(derivePrototypeTaskOrganizerFoldersView([
      task('active-1', 'active', 'repo-a'),
      task('archived-1', 'archived', 'repo-z'),
      task('active-2', 'active', 'repo-b'),
      task('active-3', 'active', 'repo-a'),
    ])).toMatchObject({
      projectOrder: ['repo-a', 'repo-b'],
    });
  });
});

describe('taskOrganizerActionToLifecycleStatus', () => {
  it('maps row action keys to generated workbench lifecycle status values', () => {
    expect(taskOrganizerActionToLifecycleStatus('archive')).toBe('archived');
    expect(taskOrganizerActionToLifecycleStatus('delete')).toBe('deleted');
    expect(taskOrganizerActionToLifecycleStatus('restore')).toBe('active');
    expect(taskOrganizerActionToLifecycleStatus('purge')).toBeNull();
  });

  it('keeps organizer lifecycle taxonomy orthogonal to execution status values', () => {
    expect(assertPrototypeTaskOrganizerLifecycleTaxonomy()).toEqual([...ATELIER_TASK_LIFECYCLE_STATES]);
    for (const executionStatus of ['running', 'succeeded', 'failed', 'paused', 'blocked']) {
      expect(ATELIER_TASK_LIFECYCLE_STATES).not.toContain(executionStatus);
    }
  });
});

describe('prototype task organizer plugin descriptors', () => {
  it('derives plugin descriptors and default plugin id from generated contract', () => {
    expect(prototypeTaskOrganizerPluginDescriptors()).toEqual(
      ATELIER_TASK_ORGANIZER_MODES.map((mode) => ({
        id: mode.id,
        ready: mode.ready,
      })),
    );
    expect(prototypeDefaultTaskOrganizerPluginId()).toBe(ATELIER_DEFAULT_TASK_ORGANIZER_MODE);
  });
});
