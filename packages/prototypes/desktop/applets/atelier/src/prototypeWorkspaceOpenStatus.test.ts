import { describe, expect, it } from 'vitest';
import type { OpenWorkspaceResponse } from './runtime';
import {
  buildPrototypeWorkspaceOpenRequestKey,
  buildPrototypeWorkspaceOpenResponse,
  derivePrototypeWorkspaceOpenStatus,
  prototypeWorkspaceOpenErrorStatus,
  shouldApplyPrototypeWorkspaceOpenResponse,
} from './prototypeWorkspaceOpenStatus';

function response(partial: Partial<OpenWorkspaceResponse>): OpenWorkspaceResponse {
  return {
    accepted: true,
    opened: false,
    workspaceUri: 'pt-workspace://task/task-1?workspace=ws-1',
    mode: 'prototype_host_intent',
    reason: 'Host intent only',
    ...partial,
  };
}

describe('buildPrototypeWorkspaceOpenResponse', () => {
  it('builds a Host-owned workspace open intent without claiming IDE launch', () => {
    const response = buildPrototypeWorkspaceOpenResponse({
      taskId: 'task-1',
      workspaceUri: 'pt-workspace://task/task-1?workspace=ws-1',
      ideHint: 'vscode',
    });

    expect(response).toEqual({
      accepted: true,
      opened: false,
      workspaceUri: 'pt-workspace://task/task-1?workspace=ws-1',
      mode: 'prototype_host_intent',
      reason: 'Prototype records a Host-owned workspace open intent without launching an IDE.',
    });
    expect(JSON.stringify(response)).not.toMatch(/file:\/\/|shell|openExternalUrl|runtime\.execute|nativeLaunch|input_snapshot/);
  });
});

describe('derivePrototypeWorkspaceOpenStatus', () => {
  it('shows accepted Host intent without claiming the IDE opened', () => {
    expect(derivePrototypeWorkspaceOpenStatus(response({
      accepted: true,
      opened: false,
    }))).toBe('prototype_host_intent:host_intent_accepted');
  });

  it('shows opened only when the Host response explicitly proves opened=true', () => {
    expect(derivePrototypeWorkspaceOpenStatus(response({
      mode: 'host_intent',
      opened: true,
    }))).toBe('host_intent:opened');
  });
});

describe('prototypeWorkspaceOpenErrorStatus', () => {
  it('uses Error messages for failed Host workspace intent attempts', () => {
    expect(prototypeWorkspaceOpenErrorStatus(new Error('workspace target rejected'))).toBe('workspace target rejected');
  });

  it('uses a bounded fallback for unknown failures', () => {
    expect(prototypeWorkspaceOpenErrorStatus('boom')).toBe('workspace open unavailable');
  });
});

describe('prototype workspace open request ownership', () => {
  it('keys workspace open requests by task, workspace URI, and IDE hint without launch payloads', () => {
    expect(buildPrototypeWorkspaceOpenRequestKey({
      taskId: ' task-1 ',
      workspaceUri: ' pt-workspace://task/task-1?workspace=ws-1 ',
      ideHint: ' vscode ',
    })).toBe('task:task-1|workspace:pt-workspace://task/task-1?workspace=ws-1|ide:vscode');
    expect(buildPrototypeWorkspaceOpenRequestKey({})).toBe('task:workspace|workspace:none|ide:default');
  });

  it('rejects stale workspace open responses after task or target ownership changes', () => {
    const currentRequestKey = buildPrototypeWorkspaceOpenRequestKey({
      taskId: 'task-2',
      workspaceUri: 'pt-workspace://task/task-2?workspace=ws-2',
      ideHint: 'vscode',
    });
    const staleTaskKey = buildPrototypeWorkspaceOpenRequestKey({
      taskId: 'task-1',
      workspaceUri: 'pt-workspace://task/task-1?workspace=ws-1',
      ideHint: 'vscode',
    });
    const staleIdeKey = buildPrototypeWorkspaceOpenRequestKey({
      taskId: 'task-2',
      workspaceUri: 'pt-workspace://task/task-2?workspace=ws-2',
      ideHint: 'cursor',
    });

    expect(shouldApplyPrototypeWorkspaceOpenResponse({
      currentRequestKey,
      responseRequestKey: currentRequestKey,
    })).toBe(true);
    expect(shouldApplyPrototypeWorkspaceOpenResponse({
      currentRequestKey,
      responseRequestKey: staleTaskKey,
    })).toBe(false);
    expect(shouldApplyPrototypeWorkspaceOpenResponse({
      currentRequestKey,
      responseRequestKey: staleIdeKey,
    })).toBe(false);
    expect(shouldApplyPrototypeWorkspaceOpenResponse({
      currentRequestKey,
      responseRequestKey: '',
    })).toBe(false);
    expect(`${currentRequestKey} ${staleTaskKey} ${staleIdeKey}`).not.toMatch(/file:\/\/|shell|openExternalUrl|runtime\.execute|nativeLaunch|input_snapshot/);
  });
});
