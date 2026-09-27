import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  registerSettingsExitGuard,
  requestSettingsExit,
  type SettingsExitAction,
} from './settingsExitGuard';

let release: (() => void) | null = null;

afterEach(() => {
  release?.();
  release = null;
});

describe('Settings exit guard', () => {
  it('runs navigation immediately when no Settings page owns the guard', () => {
    const action = vi.fn();

    requestSettingsExit(action);

    expect(action).toHaveBeenCalledOnce();
  });

  it('defers navigation to the active Settings decision owner', () => {
    const requests: SettingsExitAction[] = [];
    release = registerSettingsExitGuard((action) => requests.push(action));
    const action = vi.fn();

    requestSettingsExit(action);

    expect(action).not.toHaveBeenCalled();
    expect(requests).toEqual([action]);
    requests[0]();
    expect(action).toHaveBeenCalledOnce();
  });

  it('allows only one selected Settings tree to own exit decisions', () => {
    release = registerSettingsExitGuard(() => undefined);

    expect(() => registerSettingsExitGuard(() => undefined))
      .toThrow('mobile.settings.exitGuardAlreadyRegistered');

    release();
    release = null;
    expect(() => {
      release = registerSettingsExitGuard(() => undefined);
    }).not.toThrow();
  });
});
