/**
 * RecoveryOverlayHost — W6D root component for recovery overlays.
 *
 * Subscribes to the RecoveryProjection and renders the appropriate
 * overlay components based on active recovery states. Each overlay
 * dispatches actions to the owning runtime — no overlay creates
 * a second retry, persistence, or lifecycle owner.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  getMobileLifecycleKernel,
  useLifecycleKernel,
  type LifecycleKernelState,
  type MobileLaunchState,
} from '../../app/lifecycle';
import { useMobileI18n } from '../../app/mobileI18n';
import { useChatSurfaceFixture } from '../../acceptance/chatSurfaceFixture';
import { useContactsSurfaceFixture } from '../../acceptance/contactsSurfaceFixture';
import { useMomentsSurfaceFixture } from '../../acceptance/momentsSurfaceFixture';
import {
  recoveryStateForFixture,
  setRecoverySurfaceFixture,
  useRecoverySurfaceFixture,
} from '../../acceptance/recoverySurfaceFixture';
import { useSettingsSurfaceFixture } from '../../acceptance/settingsSurfaceFixture';
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
import { recoverActiveMessagingIdentity } from '../../runtimes/messagingRuntime';

import { ActorIdentityRecoveryOverlay } from './ActorIdentityRecoveryOverlay';
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
import { OverflowReconcileBar } from './OverflowReconcileBar';
import { DeferredCapabilityNotice } from './DeferredCapabilityNotice';
import { DeviceLocalBar } from './DeviceLocalBar';
import { WriteRevocationNotice } from './WriteRevocationNotice';
import { SessionRestoreNotice } from './SessionRestoreNotice';

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
  domainFixtureActive = false,
): readonly RecoveryState[] {
  const actorIdentityRecovery = states.find(
    (state) => state.kind === 'actor-identity-recovery',
  );
  if (actorIdentityRecovery) return [actorIdentityRecovery];
  return states.filter((state) => {
    if (domainFixtureActive && state.kind === 'deferred-capability') {
      return false;
    }
    return !(
      launchState === 'access-gate-chain'
      && state.kind === 'device-local-flag'
      && state.reason === 'session-expired'
    );
  });
}

export function bindDeferredCapabilityProjection(
  getState: () => LifecycleKernelState,
  subscribe: (listener: () => void) => () => void,
  report: (state: LifecycleKernelState) => void,
): () => void {
  const sync = () => report(getState());
  sync();
  return subscribe(sync);
}

export function RecoveryOverlayHost({
  onReAuthenticate,
  onSwitchStation,
  onRetryDeviceLocal,
}: RecoveryOverlayHostProps) {
  const { t } = useMobileI18n();
  const lifecycle = useLifecycleKernel();
  const fixture = useRecoverySurfaceFixture();
  const chatFixture = useChatSurfaceFixture();
  const contactsFixture = useContactsSurfaceFixture();
  const momentsFixture = useMomentsSurfaceFixture();
  const settingsFixture = useSettingsSurfaceFixture();
  const domainFixtureActive = Boolean(
    chatFixture.surfaceId
    || contactsFixture.surfaceId
    || momentsFixture.surfaceId
    || settingsFixture.surfaceId,
  );
  const recoveryRuntimeStatus =
    lifecycle.runtimes.get('recovery-projection')?.status;
  const [snapshot, setSnapshot] = useState<RecoveryProjectionSnapshot>(
    () => getRecoveryProjection().getSnapshot(),
  );

  useEffect(() => {
    const kernel = getMobileLifecycleKernel();
    const projection = getRecoveryProjection();
    const unsubscribeProjection = projection.subscribe(setSnapshot);
    setSnapshot(projection.getSnapshot());
    const unsubscribeLifecycle = bindDeferredCapabilityProjection(
      () => kernel.getState(),
      (listener) => kernel.subscribe(listener),
      (state) => projection.reportDeferredCapabilities(state),
    );
    return () => {
      unsubscribeLifecycle();
      unsubscribeProjection();
    };
  }, [lifecycle.generation, recoveryRuntimeStatus]);

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

  const retryDeferredCapabilities = useCallback(async () => {
    const kernel = getMobileLifecycleKernel();
    if (kernel.getPhase() !== 'ACTIVE') {
      throw new Error('mobile.recovery.actionFailed');
    }
    await kernel.restartRuntimeGraph('app-resume');
  }, []);

  const recoverActorIdentity = useCallback(async () => {
    await recoverActiveMessagingIdentity();
    getRecoveryProjection().clearActorIdentityRecovery();
    await getMobileLifecycleKernel().restartRuntimeGraph('app-resume');
  }, []);

  const renderState = useCallback(
    (state: RecoveryState) => {
      const key = fixture.surfaceId
        ? `${state.kind}:${fixture.revision}`
        : state.kind;
      switch (state.kind) {
        case 'legacy-reliability-recovery':
          return (
            <LegacyReliabilityRecoveryOverlay
              key={key}
              state={state}
              t={t}
              onAction={handleLegacyReliabilityAction}
            />
          );
        case 'reliability-reset-recovery':
          return (
            <ReliabilityResetRecoveryOverlay
              key={key}
              t={t}
              onRetry={retryInterruptedReliabilityReset}
            />
          );
        case 'draft-restore-pending':
          return (
            <DraftRestoreOverlay
              key={key}
              state={state}
              t={t}
              forceActionFailed={
                fixture.surfaceId === 'recovery.draft-restore-failed'
              }
            />
          );
        case 'command-recovery':
          return (
            <CommandRecoveryPanel
              key={key}
              state={state}
              t={t}
              onAction={(action) => handleCommandRecoveryAction(state, action)}
            />
          );
        case 'capacity-read-only':
          return <CapacityWarning key={key} state={state} t={t} />;
        case 'session-mismatch':
          return (
            <SessionMismatchOverlay
              key={key}
              state={state}
              t={t}
              onReAuthenticate={onReAuthenticate}
              onSwitchStation={onSwitchStation}
            />
          );
        case 'actor-identity-recovery':
          return (
            <ActorIdentityRecoveryOverlay
              key={key}
              t={t}
              onRecover={recoverActorIdentity}
              onSwitchStation={onSwitchStation}
            />
          );
        case 'event-overflow-reconcile':
          return <OverflowReconcileBar key={key} state={state} t={t} />;
        case 'deferred-capability':
          return (
            <DeferredCapabilityNotice
              key={key}
              state={state}
              t={t}
              canRetry={lifecycle.phase === 'ACTIVE'}
              onRetry={retryDeferredCapabilities}
            />
          );
        case 'device-local-flag':
          return (
            <DeviceLocalBar
              key={key}
              state={state}
              t={t}
              onRetry={onRetryDeviceLocal}
              onChangeStation={onSwitchStation}
            />
          );
        case 'write-revocation':
          return <WriteRevocationNotice key={key} t={t} />;
        default:
          return null;
      }
    },
    [
      handleLegacyReliabilityAction,
      handleCommandRecoveryAction,
      fixture.revision,
      fixture.surfaceId,
      lifecycle.phase,
      onReAuthenticate,
      onRetryDeviceLocal,
      onSwitchStation,
      retryInterruptedReliabilityReset,
      recoverActorIdentity,
      retryDeferredCapabilities,
      t,
    ],
  );

  if (fixture.surfaceId === 'recovery.session-valid-restore') {
    return (
      <div
        className="recovery-overlay-host"
        data-launch-state={lifecycle.launchState}
      >
        <SessionRestoreNotice
          t={t}
          onContinue={() => setRecoverySurfaceFixture(null)}
        />
      </div>
    );
  }

  const fixtureState = recoveryStateForFixture(fixture.surfaceId);
  const visibleStates = fixture.surfaceId
    ? (fixtureState ? [fixtureState] : [])
    : visibleRecoveryStates(
        snapshot.states,
        lifecycle.launchState,
        domainFixtureActive,
      );
  if (visibleStates.length === 0) return null;

  return (
    <div
      className="recovery-overlay-host"
      data-launch-state={lifecycle.launchState}
    >
      {visibleStates.map(renderState)}
    </div>
  );
}
