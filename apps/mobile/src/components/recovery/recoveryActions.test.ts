// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { visibleRecoveryStates } from './RecoveryOverlayHost';

describe('Mobile reliability recovery surfaces', () => {
  const appSource = readFileSync(
    new URL('../../App.tsx', import.meta.url),
    'utf8',
  );
  const scopeExitSource = readFileSync(
    new URL('./ScopeExitDraftDecisionOverlay.tsx', import.meta.url),
    'utf8',
  );
  const legacySource = readFileSync(
    new URL('./LegacyReliabilityRecoveryOverlay.tsx', import.meta.url),
    'utf8',
  );
  const hostSource = readFileSync(
    new URL('./RecoveryOverlayHost.tsx', import.meta.url),
    'utf8',
  );
  const stylesSource = readFileSync(
    new URL('../../styles.css', import.meta.url),
    'utf8',
  );

  it('fences Rust draft admission before deciding whether scope drafts exist', () => {
    expect(appSource).toMatch(
      /readReliabilityRuntimeStatus\(\)[\s\S]*prepareReliabilityScopeExit\(/,
    );
    expect(appSource).toMatch(
      /committedDisposition:\s*status\.draftCount === 0 \? 'discard' : null/,
    );
    expect(appSource).toMatch(
      /openReliabilityAdmission\([\s\S]*notifyReliabilityCommandChanged\(\)/,
    );
  });

  it('keeps the first draft disposition immutable after cleanup starts', () => {
    expect(scopeExitSource).toMatch(
      /committedDisposition[\s\S]*committedDisposition !== disposition/,
    );
    expect(scopeExitSource).toMatch(
      /decisionCommitted && committedDisposition !== 'retain'/,
    );
    expect(scopeExitSource).toMatch(
      /decisionCommitted && committedDisposition !== 'discard'/,
    );
  });

  it('clears stale destructive confirmation after another legacy action', () => {
    expect(legacySource).toMatch(
      /action !== 'reset-all'[\s\S]*setConfirmReset\(false\)/,
    );
    expect(legacySource).toMatch(
      /state\.archivedLegacyFiles,\s*state\.retainedReadOnly/,
    );
  });

  it('routes reset and command actions through Rust-owned recovery operations', () => {
    expect(hostSource).toMatch(
      /retryInterruptedReliabilityReset[\s\S]*resetAllLocalReliabilityData/,
    );
    expect(hostSource).toMatch(
      /case 'reliability-reset-recovery'[\s\S]*ReliabilityResetRecoveryOverlay/,
    );
    expect(hostSource).toMatch(
      /handleCommandRecoveryAction[\s\S]*applyReliabilityCommandRecoveryAction/,
    );
    expect(hostSource).toMatch(
      /case 'command-recovery'[\s\S]*CommandRecoveryPanel/,
    );
  });

  it('lets Auth own session expiry only while the access gate is visible', () => {
    const expired = {
      kind: 'device-local-flag',
      reason: 'session-expired',
      since: 1,
    } as const;
    const offline = {
      kind: 'device-local-flag',
      reason: 'no-network',
      since: 2,
    } as const;

    expect(visibleRecoveryStates(
      [expired, offline],
      'access-gate-chain',
    )).toEqual([offline]);
    expect(visibleRecoveryStates([expired], 'shell')).toEqual([expired]);
  });

  it('keeps routine resume write fencing out of the visible recovery layer', () => {
    const routinePause = {
      kind: 'write-revocation',
      admission: {
        open: false,
        reason: 'runtime_suspended',
        closedAt: 1,
      },
    } as const;
    const controlLoss = {
      kind: 'write-revocation',
      admission: {
        open: false,
        reason: 'control_event_lost',
        closedAt: 2,
      },
    } as const;

    expect(visibleRecoveryStates([routinePause], 'resume')).toEqual([]);
    expect(visibleRecoveryStates([routinePause], 'shell')).toEqual([]);
    expect(visibleRecoveryStates([controlLoss], 'shell')).toEqual([
      controlLoss,
    ]);
  });

  it('keeps background synchronization and route failures out of global overlays', () => {
    const overflow = {
      kind: 'event-overflow-reconcile',
      staleDomains: [],
    } as const;
    const unavailable = {
      kind: 'deferred-capability',
      unavailableRuntimes: [],
    } as const;
    const commandRecovery = {
      kind: 'command-recovery',
      commands: [],
    } as const;

    expect(visibleRecoveryStates(
      [overflow, unavailable, commandRecovery],
      'shell',
    )).toEqual([commandRecovery]);
  });

  it('reserves tab-bar clearance only when navigation keeps the tab bar visible', () => {
    expect(hostSource).toContain('data-tabbar-visible={tabBarVisible}');
    expect(stylesSource).toContain(
      ".recovery-overlay-host[data-launch-state='shell'][data-tabbar-visible='true']",
    );
    expect(stylesSource).not.toContain(
      ".recovery-overlay-host[data-launch-state='shell'] {",
    );
  });
});
