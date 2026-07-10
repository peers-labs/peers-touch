import { describe, expect, it } from 'vitest';
import {
  ATELIER_WORKSPACE_OPEN_FORBIDDEN_ACTIONS,
  ATELIER_WORKSPACE_OPEN_OPTIONAL_FIELDS,
  ATELIER_WORKSPACE_OPEN_REQUIRED_FIELDS,
  buildAtelierWorkspaceOpenIntent,
  containsForbiddenAtelierWorkspacePayloadActions,
  isCanonicalAtelierWorkspaceOpenTarget,
} from './workspaceActionGuards';

describe('workspace action guards', () => {
  const target = {
    workspaceId: 'ws-1',
    workspaceUri: 'pt-workspace://task/task-1?workspace=ws-1',
    label: 'workspace',
    ideHint: ' cursor ',
  };

  it('builds Host-owned canonical workspace open intents', () => {
    expect(ATELIER_WORKSPACE_OPEN_REQUIRED_FIELDS).toEqual(['taskId', 'workspaceUri']);
    expect(ATELIER_WORKSPACE_OPEN_OPTIONAL_FIELDS).toEqual(['ideHint']);
    expect(buildAtelierWorkspaceOpenIntent({
      taskId: ' task-1 ',
      target,
      pendingWorkspaceOpenId: '',
    })).toEqual({
      status: 'ready',
      intent: {
        taskId: 'task-1',
        workspaceUri: 'pt-workspace://task/task-1?workspace=ws-1',
        ideHint: 'cursor',
      },
    });
  });

  it('blocks missing task ids, missing targets, and concurrent workspace opens', () => {
    expect(buildAtelierWorkspaceOpenIntent({ taskId: '', target, pendingWorkspaceOpenId: '' })).toEqual({ status: 'blocked' });
    expect(buildAtelierWorkspaceOpenIntent({ taskId: 'task-1', target: undefined, pendingWorkspaceOpenId: '' })).toEqual({ status: 'blocked' });
    expect(buildAtelierWorkspaceOpenIntent({ taskId: 'task-1', target, pendingWorkspaceOpenId: 'task-0' })).toEqual({ status: 'blocked' });
  });

  it('rejects non-contract workspace URI shapes before Host invoke', () => {
    expect(isCanonicalAtelierWorkspaceOpenTarget(target, 'task-1')).toBe(true);
    expect(isCanonicalAtelierWorkspaceOpenTarget({ ...target, workspaceUri: 'file:///tmp/ws' }, 'task-1')).toBe(false);
    expect(isCanonicalAtelierWorkspaceOpenTarget({ ...target, workspaceUri: 'pt-workspace://task/task-2?workspace=ws-1' }, 'task-1')).toBe(false);
    expect(isCanonicalAtelierWorkspaceOpenTarget({ ...target, workspaceUri: 'pt-workspace://task/task-1?workspace=ws-2' }, 'task-1')).toBe(false);
    expect(buildAtelierWorkspaceOpenIntent({
      taskId: 'task-1',
      target: { ...target, workspaceUri: 'pt-workspace://file/task-1?workspace=ws-1' },
      pendingWorkspaceOpenId: '',
    })).toEqual({ status: 'invalid' });
  });

  it('rejects file, shell, execute, run, and external URL applet payload actions', () => {
    expect(ATELIER_WORKSPACE_OPEN_FORBIDDEN_ACTIONS).toEqual(['file', 'shell', 'spawn', 'execute', 'run', 'openExternalUrl']);
    expect(containsForbiddenAtelierWorkspacePayloadActions({ shell: 'open .' })).toBe(true);
    expect(containsForbiddenAtelierWorkspacePayloadActions({ openExternalUrl: 'file:///tmp/ws' })).toBe(true);
    expect(buildAtelierWorkspaceOpenIntent({
      taskId: 'task-1',
      target,
      pendingWorkspaceOpenId: '',
      extraPayload: { execute: true },
    })).toEqual({ status: 'invalid' });
  });
});
