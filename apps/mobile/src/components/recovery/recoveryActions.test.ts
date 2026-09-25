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
});
