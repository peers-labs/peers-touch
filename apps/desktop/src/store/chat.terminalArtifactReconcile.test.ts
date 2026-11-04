import { describe, expect, it } from 'vitest';

import {
  mergeTerminalSessions,
  type TerminalSessionView,
} from './terminalSessions';
import type {
  TerminalSessionMeta,
  TerminalStationSession,
} from '../services/desktop_api';

function stationRow(
  sessionId: string,
  status: string,
  extra: Partial<TerminalStationSession> = {},
): TerminalStationSession {
  return {
    sessionId,
    conversationId: 'conv-1',
    turnId: '',
    deviceId: 'dev-1',
    cwd: '/wks',
    command: 'sh',
    args: [],
    pid: 42,
    status,
    exitCode: 0,
    outputBytes: '10',
    ...extra,
  };
}

function liveMeta(sessionId: string, status: TerminalSessionMeta['status'], extra: Partial<TerminalSessionMeta> = {}): TerminalSessionMeta {
  return {
    sessionId,
    command: 'sh',
    args: [],
    cwd: '/wks',
    pid: 42,
    status,
    exitCode: status === 'running' ? null : 0,
    outputBytes: 20,
    startedAtMs: 100,
    ...extra,
  };
}

describe('terminal session reconciliation', () => {
  it('never advertises a running Station row without a live handle', () => {
    const views = mergeTerminalSessions(
      [stationRow('s1', 'TERMINAL_SESSION_STATUS_RUNNING')],
      new Map(),
    );
    expect(views[0].status).toBe('unknown');
    expect(views[0].live).toBe(false);
  });

  it('prefers live worker proof while a handle exists', () => {
    const views = mergeTerminalSessions(
      [stationRow('s1', 'TERMINAL_SESSION_STATUS_RUNNING')],
      new Map([['s1', liveMeta('s1', 'running')]]),
    ) as TerminalSessionView[];
    expect(views[0].status).toBe('running');
    expect(views[0].live).toBe(true);
    expect(views[0].outputBytes).toBe(20);
  });

  it('keeps terminal Station state after the worker handle is gone', () => {
    const exited = mergeTerminalSessions(
      [stationRow('s1', 'TERMINAL_SESSION_STATUS_EXITED', { exitCode: 0 })],
      new Map(),
    );
    expect(exited[0].status).toBe('exited');
    expect(exited[0].exitCode).toBe(0);

    const killed = mergeTerminalSessions(
      [stationRow('s2', 'TERMINAL_SESSION_STATUS_KILLED', { exitCode: 143 })],
      new Map(),
    );
    expect(killed[0].status).toBe('killed');
    expect(killed[0].exitCode).toBe(143);
  });

  it('projects the worker exit code when the live handle reports it', () => {
    const views = mergeTerminalSessions(
      [stationRow('s1', 'TERMINAL_SESSION_STATUS_RUNNING')],
      new Map([['s1', liveMeta('s1', 'exited', { exitCode: 7 })]]),
    );
    expect(views[0].status).toBe('exited');
    expect(views[0].exitCode).toBe(7);
  });

  it('treats a RUNNING sandbox row as live without a device worker handle', () => {
    const views = mergeTerminalSessions(
      [stationRow('w1', 'TERMINAL_SESSION_STATUS_RUNNING', {
        deviceId: '',
        executionTarget: 2,
        sandboxRef: 'wbox-1',
      })],
      new Map(),
    );
    expect(views[0].placement).toBe('sandbox');
    expect(views[0].sandboxRef).toBe('wbox-1');
    expect(views[0].status).toBe('running');
    expect(views[0].live).toBe(true);
  });

  it('accepts the string enum form of the sandbox execution target', () => {
    const views = mergeTerminalSessions(
      [stationRow('w2', 'TERMINAL_SESSION_STATUS_EXITED', {
        deviceId: '',
        executionTarget: 'EXECUTION_TARGET_WORKSPACE_SANDBOX',
        sandboxRef: 'wbox-2',
      })],
      new Map(),
    );
    expect(views[0].placement).toBe('sandbox');
    expect(views[0].status).toBe('exited');
    expect(views[0].live).toBe(false);
  });

  it('keeps device placement for legacy rows without an execution target', () => {
    const views = mergeTerminalSessions(
      [stationRow('d1', 'TERMINAL_SESSION_STATUS_RUNNING')],
      new Map(),
    );
    expect(views[0].placement).toBe('desktop');
    expect(views[0].status).toBe('unknown');
  });
});
