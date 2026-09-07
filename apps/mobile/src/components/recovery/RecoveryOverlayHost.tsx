/**
 * RecoveryOverlayHost — W6D root component for recovery overlays.
 *
 * Subscribes to the RecoveryProjection and renders the appropriate
 * overlay components based on active recovery states. Each overlay
 * dispatches actions to the owning runtime — no overlay creates
 * a second retry, persistence, or lifecycle owner.
 */

import { useCallback, useEffect, useState } from 'react';

import { useMobileI18n } from '../../app/mobileI18n';
import {
  getRecoveryProjection,
  type RecoveryProjectionSnapshot,
  type RecoveryState,
} from '../../runtimes/recoveryProjection';

import { DraftRestoreOverlay } from './DraftRestoreOverlay';
import { UnknownOutcomeBar } from './UnknownOutcomeBar';
import { CapacityWarning } from './CapacityWarning';
import { SessionMismatchOverlay } from './SessionMismatchOverlay';
import { OverflowReconcileBar } from './OverflowReconcileBar';
import { DeferredCapabilityNotice } from './DeferredCapabilityNotice';
import { DeviceLocalBar } from './DeviceLocalBar';

export function RecoveryOverlayHost() {
  const { t } = useMobileI18n();
  const [snapshot, setSnapshot] = useState<RecoveryProjectionSnapshot>(
    () => getRecoveryProjection().getSnapshot(),
  );

  useEffect(() => {
    const projection = getRecoveryProjection();
    setSnapshot(projection.getSnapshot());
    return projection.subscribe(setSnapshot);
  }, []);

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
          return <SessionMismatchOverlay key={state.kind} state={state} t={t} />;
        case 'event-overflow-reconcile':
          return <OverflowReconcileBar key={state.kind} state={state} t={t} />;
        case 'deferred-capability':
          return <DeferredCapabilityNotice key={state.kind} state={state} t={t} />;
        case 'device-local-flag':
          return <DeviceLocalBar key={state.kind} state={state} t={t} />;
        case 'write-revocation':
          // Write revocation is surfaced through the CapacityWarning
          // or SessionMismatchOverlay depending on cause
          return null;
        default:
          return null;
      }
    },
    [t],
  );

  if (!snapshot.hasActiveRecovery) return null;

  return (
    <div className="recovery-overlay-host" role="status" aria-live="polite">
      {snapshot.states.map(renderState)}
    </div>
  );
}
