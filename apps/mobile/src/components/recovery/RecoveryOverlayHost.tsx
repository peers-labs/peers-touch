/**
 * RecoveryOverlayHost — W6D root component for recovery overlays.
 *
 * Subscribes to the RecoveryProjection and renders app-level recovery
 * surfaces. Route-owned runtime failures and background reconciliation remain
 * local instead of stacking global notices.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  getMobileLifecycleKernel,
  useLifecycleKernel,
  type MobileLaunchState,
} from '../../app/lifecycle';
import { useMobileI18n } from '../../app/mobileI18n';
import { useMobileNavigationStore } from '../../app/navigation';
import {
  applyReliabilityCommandRecoveryAction,
  applyLegacyReliabilityDisposition,
  resetAllLocalReliabilityData,
  type ReliabilityCommandRecoveryAction,
} from '../../runtimes/commandRuntime';
import {
  getRecoveryProjection,
  type DeviceLocalFlagState,
  type RecoveryProjectionSnapshot,
  type RecoveryState,
  type SessionMismatchState,
} from '../../runtimes/recoveryProjection';

import { DraftRestoreOverlay } from './DraftRestoreOverlay';
import {
  CommandRecoveryPanel,
} from './CommandRecoveryPanel';
import {
  LegacyReliabilityRecoveryOverlay,
  type LegacyReliabilityRecoveryAction,
} from './LegacyReliabilityRecoveryOverlay';
import { ReliabilityResetRecoveryOverlay } from './ReliabilityResetRecoveryOverlay';
import { CapacityWarning } from './CapacityWarning';
import { SessionMismatchOverlay } from './SessionMismatchOverlay';
import { DeviceLocalBar } from './DeviceLocalBar';
import { WriteRevocationNotice } from './WriteRevocationNotice';

interface RecoveryOverlayHostProps {
  readonly onReAuthenticate: (
    state: SessionMismatchState,
  ) => Promise<void>;
  readonly onSwitchStation: () => Promise<void>;
  readonly onRetryDeviceLocal: (
    state: DeviceLocalFlagState,
  ) => Promise<void>;
}

export function visibleRecoveryStates(
  states: readonly RecoveryState[],
  launchState: MobileLaunchState,
): readonly RecoveryState[] {
  const appLevelStates = states.filter((state) => !(
    state.kind === 'event-overflow-reconcile'
    || state.kind === 'deferred-capability'
    || (
      state.kind === 'write-revocation'
      && !state.admission.open
      && state.admission.reason === 'runtime_suspended'
    )
  ));
  const eligibleStates = launchState !== 'access-gate-chain'
    ? appLevelStates
    : appLevelStates.filter((state) => !(
        state.kind === 'device-local-flag'
        && state.reason === 'session-expired'
      ));
  return eligibleStates;
}

export function RecoveryOverlayHost({
  onReAuthenticate,
  onSwitchStation,
  onRetryDeviceLocal,
}: RecoveryOverlayHostProps) {
  const { t } = useMobileI18n();
  const lifecycle = useLifecycleKernel();
  const tabBarVisible = useMobileNavigationStore(
    (state) => state.detailStack.length === 0,
  );
  const recoveryRuntimeStatus =
    lifecycle.runtimes.get('recovery-projection')?.status;
  const [snapshot, setSnapshot] = useState<RecoveryProjectionSnapshot>(
    () => getRecoveryProjection().getSnapshot(),
  );

  useEffect(() => {
    const projection = getRecoveryProjection();
    const unsubscribe = projection.subscribe(setSnapshot);
    setSnapshot(projection.getSnapshot());
    return unsubscribe;
  }, [lifecycle.generation, recoveryRuntimeStatus]);

  useEffect(() => {
    getRecoveryProjection().reportDeferredCapabilities(lifecycle);
  }, [lifecycle]);

  const handleLegacyReliabilityAction = useCallback(
    async (action: LegacyReliabilityRecoveryAction) => {
      const projection = getRecoveryProjection();
      if (action === 'retain') {
        const result = await applyLegacyReliabilityDisposition('retain');
        projection.reportLegacyReliabilityRecovery(
          result.archivedLegacyFiles,
          true,
        );
        return;
      }

      if (action === 'discard-legacy') {
        await applyLegacyReliabilityDisposition('discard-legacy');
      } else {
        await resetAllLocalReliabilityData();
      }
      projection.clearLegacyReliabilityRecovery();
      await getMobileLifecycleKernel().restartRuntimeGraph(
        'reliability-recovery',
      );
    },
    [],
  );

  const retryInterruptedReliabilityReset = useCallback(async () => {
    await resetAllLocalReliabilityData();
    const projection = getRecoveryProjection();
    projection.clearReliabilityResetRecovery();
    projection.clearLegacyReliabilityRecovery();
    await getMobileLifecycleKernel().restartRuntimeGraph(
      'reliability-recovery',
    );
  }, []);

  const handleCommandRecoveryAction = useCallback(
    async (
      state: Extract<RecoveryState, { kind: 'command-recovery' }>,
      action: ReliabilityCommandRecoveryAction,
    ) => {
      await applyReliabilityCommandRecoveryAction(action, state.commands);
    },
    [],
  );

  const renderState = useCallback(
    (state: RecoveryState) => {
      switch (state.kind) {
        case 'legacy-reliability-recovery':
          return (
            <LegacyReliabilityRecoveryOverlay
              key={state.kind}
              state={state}
              t={t}
              onAction={handleLegacyReliabilityAction}
            />
          );
        case 'reliability-reset-recovery':
          return (
            <ReliabilityResetRecoveryOverlay
              key={state.kind}
              t={t}
              onRetry={retryInterruptedReliabilityReset}
            />
          );
        case 'draft-restore-pending':
          return <DraftRestoreOverlay key={state.kind} state={state} t={t} />;
        case 'command-recovery':
          return (
            <CommandRecoveryPanel
              key={state.kind}
              state={state}
              t={t}
              onAction={(action) => handleCommandRecoveryAction(state, action)}
            />
          );
        case 'capacity-read-only':
          return <CapacityWarning key={state.kind} state={state} t={t} />;
        case 'session-mismatch':
          return (
            <SessionMismatchOverlay
              key={state.kind}
              state={state}
              t={t}
              onReAuthenticate={onReAuthenticate}
              onSwitchStation={onSwitchStation}
            />
          );
        case 'device-local-flag':
          return (
            <DeviceLocalBar
              key={state.kind}
              state={state}
              t={t}
              onRetry={onRetryDeviceLocal}
              onChangeStation={onSwitchStation}
            />
          );
        case 'write-revocation':
          return <WriteRevocationNotice key={state.kind} t={t} />;
        default:
          return null;
      }
    },
    [
      handleLegacyReliabilityAction,
      handleCommandRecoveryAction,
      onReAuthenticate,
      onRetryDeviceLocal,
      onSwitchStation,
      retryInterruptedReliabilityReset,
      t,
    ],
  );

  const visibleStates = visibleRecoveryStates(
    snapshot.states,
    lifecycle.launchState,
  );
  if (visibleStates.length === 0) return null;

  return (
    <div
      className="recovery-overlay-host"
      data-launch-state={lifecycle.launchState}
      data-tabbar-visible={tabBarVisible}
    >
      {visibleStates.map(renderState)}
    </div>
  );
}
