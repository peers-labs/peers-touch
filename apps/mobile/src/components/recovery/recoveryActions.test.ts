// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import {
  bindDeferredCapabilityProjection,
  visibleRecoveryStates,
} from './RecoveryOverlayHost';

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
  const deferredSource = readFileSync(
    new URL('./DeferredCapabilityNotice.tsx', import.meta.url),
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

  it('hides only runtime degradation while an explicit domain fixture is under review', () => {
    const degraded = {
      kind: 'deferred-capability',
      unavailableRuntimes: [],
    } as const;
    const offline = {
      kind: 'device-local-flag',
      reason: 'no-network',
      since: 2,
    } as const;

    expect(visibleRecoveryStates(
      [degraded, offline],
      'shell',
      true,
    )).toEqual([offline]);
    expect(visibleRecoveryStates(
      [degraded],
      'shell',
    )).toEqual([degraded]);
  });

  it('renders actor identity recovery as the only blocking recovery surface', () => {
    const identity = {
      kind: 'actor-identity-recovery',
      detectedAtMs: 1,
    } as const;
    const degraded = {
      kind: 'deferred-capability',
      unavailableRuntimes: [],
    } as const;

    expect(visibleRecoveryStates([identity, degraded], 'shell')).toEqual([identity]);
  });

  it('keeps deferred capability recovery synchronized with every kernel update', () => {
    let current = { launchState: 'shell', revision: 1 };
    let listener: (() => void) | null = null;
    const observed: unknown[] = [];
    const unbind = bindDeferredCapabilityProjection(
      () => current,
      (next) => {
        listener = next;
        return () => {
          listener = null;
        };
      },
      (state) => observed.push(state),
    );

    current = { launchState: 'shell', revision: 2 };
    listener?.();

    expect(observed).toEqual([
      { launchState: 'shell', revision: 1 },
      { launchState: 'shell', revision: 2 },
    ]);
    unbind();
    expect(listener).toBeNull();
  });

  it('keeps shell degradation compact and explicitly non-blocking', () => {
    expect(hostSource).toContain('bindDeferredCapabilityProjection');
    expect(deferredSource).toContain('data-blocks-unrelated-content="false"');
    expect(stylesSource).toMatch(
      /\.recovery-overlay-host:is\(\s*\[data-launch-state='shell'\],\s*\[data-launch-state='resume'\]\s*\)\s*\{[^}]*padding-bottom:\s*calc\(var\(--tabbar-height\)/s,
    );
    expect(stylesSource).toMatch(
      /\.recovery-overlay-host:is\(\s*\[data-launch-state='shell'\],\s*\[data-launch-state='resume'\]\s*\)\s*\.recovery-deferred-capability/s,
    );
  });

  it('keeps shared shell controls at the 44px mobile touch minimum', () => {
    expect(stylesSource).toMatch(
      /\.header-action\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s,
    );
    expect(stylesSource).toMatch(
      /\.chat-search-bar \.ant-input-affix-wrapper\s*\{[^}]*height:\s*44px;/s,
    );
    expect(stylesSource).toMatch(
      /\.mobile-notice-close\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s,
    );
    expect(stylesSource).toMatch(
      /\.recovery-btn--compact\s*\{[^}]*min-height:\s*44px;/s,
    );
    expect(stylesSource).toMatch(
      /\.header-title\s*\{[^}]*letter-spacing:\s*0;/s,
    );
  });
});
