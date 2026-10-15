// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { createRecoveryProjection } from '../../runtimes/recoveryProjection';
import {
  bindDeferredCapabilityProjection,
  isBlockingRecoveryState,
  isShellStatusState,
  recoverySurfacePresentation,
  visibleRecoveryStates,
} from './RecoveryOverlayHost';

describe('Mobile reliability recovery surfaces', () => {
  const appSource = readFileSync(
    new URL('../../App.tsx', import.meta.url),
    'utf8',
  );
  const entryRuntimeSource = readFileSync(
    new URL('../../runtimes/entryRuntime.ts', import.meta.url),
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
  const mobileShellSource = readFileSync(
    new URL('../MobileShell.tsx', import.meta.url),
    'utf8',
  );
  const stylesSource = readFileSync(
    new URL('../../styles.css', import.meta.url),
    'utf8',
  );

  it('fences Rust draft admission before deciding whether scope drafts exist', () => {
    expect(entryRuntimeSource).toMatch(
      /readReliabilityRuntimeStatus\(\)[\s\S]*prepareReliabilityScopeExit\(/,
    );
    expect(entryRuntimeSource).toMatch(
      /if \(status\.draftCount === 0\)[\s\S]*execute\('discard'\)/,
    );
    expect(entryRuntimeSource).toMatch(
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

  it('keeps routine suspend write fencing without a recovery card and preserves real revocation', () => {
    const projection = createRecoveryProjection();
    projection.reportWriteAdmission({ open: false, reason: 'runtime_suspended', closedAt: 1 });
    expect(projection.getSnapshot().isWriteBlocked).toBe(true);
    expect(visibleRecoveryStates(projection.getSnapshot().states, 'shell')).toEqual([]);
    projection.reportWriteAdmission({ open: false, reason: 'control_event_lost', closedAt: 2 });
    expect(visibleRecoveryStates(projection.getSnapshot().states, 'shell')).toHaveLength(1);
    expect(projection.getSnapshot().isWriteBlocked).toBe(true);
    projection.reportWriteAdmission({ open: true });
    expect(projection.getSnapshot().isWriteBlocked).toBe(false);
    projection.teardown();
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

  it('suppresses shell status while a blocking recovery surface is active', () => {
    const draft = {
      kind: 'draft-restore-pending',
      drafts: [{ key: 'chat:one' }],
      discoveredAtMs: 1,
    } as const;
    const degraded = {
      kind: 'deferred-capability',
      unavailableRuntimes: [],
    } as const;

    expect(isBlockingRecoveryState(draft)).toBe(true);
    expect(isBlockingRecoveryState(degraded)).toBe(false);
    expect(recoverySurfacePresentation(
      [draft, degraded],
      'shell',
      true,
    )).toEqual({
      blocksApplicationSurface: true,
      overlayStates: [draft],
      shellStatusStates: [],
    });
  });

  it('keeps retained legacy data non-blocking while unresolved legacy data blocks', () => {
    expect(isBlockingRecoveryState({
      kind: 'legacy-reliability-recovery',
      archivedLegacyFiles: 1,
      retainedReadOnly: true,
    })).toBe(false);
    expect(isBlockingRecoveryState({
      kind: 'legacy-reliability-recovery',
      archivedLegacyFiles: 1,
      retainedReadOnly: false,
    })).toBe(true);
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
    const degraded = {
      kind: 'deferred-capability',
      unavailableRuntimes: [],
    } as const;

    expect(hostSource).toContain('bindDeferredCapabilityProjection');
    expect(isShellStatusState(degraded, 'shell')).toBe(true);
    expect(isShellStatusState(degraded, 'resume')).toBe(true);
    expect(isShellStatusState(degraded, 'access-gate-chain')).toBe(false);
    expect(deferredSource).toContain('data-blocks-unrelated-content="false"');
    expect(hostSource).toContain(
      'presentation.shellStatusStates.map(renderState)',
    );
    expect(mobileShellSource).toContain('data-recovery-status-slot');
    expect(stylesSource).toMatch(
      /\.mobile-shell-status-slot\s*\{[^}]*flex:\s*0 0 auto;/s,
    );
    expect(stylesSource).toMatch(
      /\.mobile-shell-status-slot:not\(:empty\)\s*\{[^}]*display:\s*block;/s,
    );
    expect(appSource).toContain(
      'surfaceRef.current.inert = blocked',
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
