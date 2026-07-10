import { describe, expect, it } from 'vitest';
import { ATELIER_TASK_LIFECYCLE_STATES } from '../domain/projection.contract.generated';
import { buildAtelierTaskLifecycleIntent } from './taskLifecycleActionGuards';

describe('task lifecycle action guards', () => {
  it('blocks empty task ids and concurrent lifecycle submissions', () => {
    expect(buildAtelierTaskLifecycleIntent({
      taskId: '',
      action: 'archive',
      pendingTaskActionId: '',
      purgeConfirmTaskId: '',
    })).toEqual({ status: 'blocked' });
    expect(buildAtelierTaskLifecycleIntent({
      taskId: 'task-1',
      action: 'archive',
      pendingTaskActionId: 'task-1',
      purgeConfirmTaskId: '',
    })).toEqual({ status: 'blocked' });
  });

  it('rejects actions outside the official lifecycle menu', () => {
    expect(buildAtelierTaskLifecycleIntent({
      taskId: 'task-1',
      action: 'run-shell',
      pendingTaskActionId: '',
      purgeConfirmTaskId: '',
    })).toEqual({ status: 'invalid' });
  });

  it('maps archive, restore, and delete to generated lifecycle statuses', () => {
    expect(ATELIER_TASK_LIFECYCLE_STATES).toEqual(expect.arrayContaining(['active', 'archived', 'deleted']));
    expect(buildAtelierTaskLifecycleIntent({
      taskId: ' task-1 ',
      action: 'archive',
      pendingTaskActionId: '',
      purgeConfirmTaskId: '',
    })).toEqual({
      status: 'ready',
      intent: { kind: 'setStatus', taskId: 'task-1', action: 'archive', status: 'archived' },
    });
    expect(buildAtelierTaskLifecycleIntent({
      taskId: 'task-1',
      action: 'restore',
      pendingTaskActionId: '',
      purgeConfirmTaskId: '',
    })).toMatchObject({
      status: 'ready',
      intent: { kind: 'setStatus', status: 'active' },
    });
    expect(buildAtelierTaskLifecycleIntent({
      taskId: 'task-1',
      action: 'delete',
      pendingTaskActionId: '',
      purgeConfirmTaskId: '',
    })).toMatchObject({
      status: 'ready',
      intent: { kind: 'setStatus', status: 'deleted' },
    });
  });

  it('requires a matching second purge request before creating a purge intent', () => {
    expect(buildAtelierTaskLifecycleIntent({
      taskId: ' task-1 ',
      action: 'purge',
      pendingTaskActionId: '',
      purgeConfirmTaskId: '',
      taskStatus: 'deleted',
    })).toEqual({ status: 'confirm-purge', taskId: 'task-1' });
    expect(buildAtelierTaskLifecycleIntent({
      taskId: 'task-1',
      action: 'purge',
      pendingTaskActionId: '',
      purgeConfirmTaskId: 'task-2',
      taskStatus: 'deleted',
    })).toEqual({ status: 'confirm-purge', taskId: 'task-1' });
    expect(buildAtelierTaskLifecycleIntent({
      taskId: 'task-1',
      action: 'purge',
      pendingTaskActionId: '',
      purgeConfirmTaskId: 'task-1',
      taskStatus: 'deleted',
    })).toEqual({
      status: 'ready',
      intent: { kind: 'purge', taskId: 'task-1', action: 'purge' },
    });
  });

  it('rejects purge intents unless the projected task status is deleted', () => {
    for (const taskStatus of ['', 'active', 'archived', 'running']) {
      expect(buildAtelierTaskLifecycleIntent({
        taskId: 'task-1',
        action: 'purge',
        pendingTaskActionId: '',
        purgeConfirmTaskId: 'task-1',
        taskStatus,
      })).toEqual({ status: 'invalid' });
    }
  });
});
