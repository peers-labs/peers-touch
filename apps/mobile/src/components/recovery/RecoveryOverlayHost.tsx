/**
 * RecoveryOverlayHost — W6D root component for recovery overlays.
 *
 * Subscribes to the RecoveryProjection and renders the appropriate
 * overlay components based on active recovery states. Each overlay
 * dispatches actions to the owning runtime — no overlay creates
 * a second retry, persistence, or lifecycle owner.
 */

import { useCallback, useEffect, useState } from 'react';

import { useLifecycleKernel } from '../../app/lifecycle';
import { useMobileI18n } from '../../app/mobileI18n';
import {
  getRecoveryProjection,
  type DeviceLocalFlagState,
  type RecoveryProjectionSnapshot,
  type RecoveryState,
  type SessionMismatchState,
} from '../../runtimes/recoveryProjection';

import { DraftRestoreOverlay } from './DraftRestoreOverlay';
import { UnknownOutcomeBar } from './UnknownOutcomeBar';
import { CapacityWarning } from './CapacityWarning';
import { SessionMismatchOverlay } from './SessionMismatchOverlay';
import { OverflowReconcileBar } from './OverflowReconcileBar';
import { DeferredCapabilityNotice } from './DeferredCapabilityNotice';
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

export function RecoveryOverlayHost({
  onReAuthenticate,
  onSwitchStation,
  onRetryDeviceLocal,
}: RecoveryOverlayHostProps) {
  const { t } = useMobileI18n();
  const lifecycle = useLifecycleKernel();
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

  const renderState = useCallback(
    (state: RecoveryState) => {
      switch (state.kind) {
        case 'draft-restore-pending':
          return <DraftRestoreOverlay key={state.kind} state={state} t={t} />;
        case 'unknown-outcome':
          return <UnknownOutcomeBar key={state.kind} state={state} t={t} />;
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
        case 'event-overflow-reconcile':
          return <OverflowReconcileBar key={state.kind} state={state} t={t} />;
        case 'deferred-capability':
          return <DeferredCapabilityNotice key={state.kind} state={state} t={t} />;
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
    [onReAuthenticate, onRetryDeviceLocal, onSwitchStation, t],
  );

  if (!snapshot.hasActiveRecovery) return null;

  return (
    <div
      className="recovery-overlay-host"
      data-launch-state={lifecycle.launchState}
    >
      {snapshot.states.map(renderState)}
    </div>
  );
}
