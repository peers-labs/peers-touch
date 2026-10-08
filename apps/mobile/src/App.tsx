import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal } from 'antd';

import { AppProviders } from './app/AppProviders';
import {
  getMobileLifecycleKernel,
  useLifecycleKernel,
} from './app/lifecycle';
import { useMobileI18n } from './app/mobileI18n';
import { MobileShell } from './components/MobileShell';
import {
  RecoveryOverlayHost,
  ScopeExitDraftDecisionOverlay,
  type ScopeExitDecisionReason,
} from './components/recovery';
import {
  currentAccessGate,
  submitStationLoginGate,
  submitStationInviteCodeGate,
  submitStationSchemaGate,
  isAccessGranted,
  loadRememberedLoginAccounts,
  rememberLoginAccount,
  type RememberedLoginAccount,
  type StationLoginInput,
} from './features/auth/authSession';
import { AccessGateHost } from './features/auth/AccessGateHost';
import { useAuthStore } from './features/auth/authStore';
import {
  activateAndVerifyStationRoute,
  discoverStationConnection,
  verifyBoundStationRoute,
  type StationIdentityResult,
} from './features/station/stationConnection';
import { StationLaunchScreen } from './features/station/StationLaunchScreen';
import {
  applyAccessGateRuntimeResult,
  cancelAccessAttemptForActiveStation,
  refreshAccessDecisionForActiveStation,
  startAccessAttemptForActiveStation,
} from './runtimes/accessRuntime';
import {
  activateNativeSessionRuntime,
  logoutSessionRuntime,
} from './runtimes/sessionRuntime';
import {
  getRecoveryProjection,
  type DeviceLocalFlagState,
  type SessionMismatchState,
} from './runtimes/recoveryProjection';
import {
  activateStationEntry,
  activeStationRoute,
  activeStationEntry,
  addStationRoute,
  buildStationAccessInput,
  removeStationEntry,
  replaceStationEntryIdentity,
  requireMatchingStationIdentity,
  stationEntryAtUrl,
  stationRoutes,
  updateStationEntryStatus,
  type StationProtocol,
  type MobileStationEntry,
  type MobileStationRouteCandidate,
  type StoredStationRegistry,
} from './features/station/stationRegistry';
import type { NativeStationRouteCandidate } from './services/mobileCommands';
import { removeStationRouteBinding } from './services/mobileCommands';
import {
  readStationRegistryProjection,
  replaceStationRegistryProjection,
  selectStationRouteRuntime,
  updateStationRegistryProjection,
  useStationRegistryProjection,
} from './runtimes/stationRuntime';
import {
  notifyReliabilityCommandChanged,
  openReliabilityAdmission,
  prepareReliabilityScopeExit,
  readReliabilityRuntimeStatus,
} from './runtimes/commandRuntime';
import type { DraftDisposition } from './app/lifecycle/types';

interface PendingScopeExitRequest {
  readonly reason: ScopeExitDecisionReason;
  readonly draftCount: number;
  readonly committedDisposition: DraftDisposition | null;
  readonly run: (disposition: DraftDisposition) => Promise<void>;
  readonly cancel: () => Promise<void>;
  readonly canCancel: boolean;
}

interface PendingRouteChoice {
  readonly routes: NativeStationRouteCandidate[];
}


/**
 * MobileAppRoot — root renderer for the lifecycle-owned launch-state machine.
 *
 * The lifecycle kernel (via AppProviders) manages runtime bootstrap/teardown.
 * This component renders the pre-shell launch flow and dispatches transition
 * intents to the kernel.
 *
 * Lifecycle coordination:
 * - The kernel bootstraps all runtimes before this component mounts.
 * - Launch state transitions are driven by station and auth outcomes.
 * - The shell only renders when lifecyclePhase is ACTIVE.
 */
function MobileAppRoot() {
  const { t } = useMobileI18n();
  const lifecycle = useLifecycleKernel();

  const launchState = lifecycle.launchState;
  const stationRegistry = useStationRegistryProjection();
  const [stationError, setStationError] = useState<string | null>(null);
  const [stationChecking, setStationChecking] = useState(false);
  const [verifyingStationUrls, setVerifyingStationUrls] = useState<string[]>([]);
  const [rememberedAccounts, setRememberedAccounts] = useState<RememberedLoginAccount[]>([]);
  const [pendingRouteChoice, setPendingRouteChoice] =
    useState<PendingRouteChoice | null>(null);
  const authError = useAuthStore((state) => state.error);
  const authLoading = useAuthStore((state) => state.loading);
  const accessDecision = useAuthStore((state) => state.accessDecision);
  const setAuthError = useAuthStore((state) => state.setError);
  const setAuthLoading = useAuthStore((state) => state.setLoading);
  const setAccessDecision = useAuthStore((state) => state.setAccessDecision);
  const autoVerifiedStationUrls = useRef<Set<string>>(new Set());
  const pendingScopeExitRef = useRef<PendingScopeExitRequest | null>(null);
  const [pendingScopeExit, setPendingScopeExit] =
    useState<PendingScopeExitRequest | null>(null);
  const activeStation = activeStationEntry(stationRegistry);
  const activeRoute = activeStation ? activeStationRoute(activeStation) : null;
  const activeRouteKey = activeStation && activeRoute
    ? `${activeStation.stationPeerId}:${activeRoute.routeId}:${activeStation.routeRevision ?? 1}`
    : '';

  // The lifecycle-owned auth descriptor restores and revalidates credentials.
  // React only loads the device-local Station projection for rendering.
  useEffect(() => {
    if (lifecycle.phase !== 'ACTIVE') return;


  }, [lifecycle.generation, lifecycle.phase]);


  // --- Auto-verify the selected Station route ---
  useEffect(() => {
    if (launchState !== 'station-selection' || !activeStation || !activeRoute) return;
    autoProbeStation(activeStation, activeRoute);
  }, [activeRouteKey, launchState]);

  // --- Load remembered accounts when active station changes ---
  useEffect(() => {
    if (!activeStation) {
      setRememberedAccounts([]);
      return;
    }

    let mounted = true;
    loadRememberedLoginAccounts(activeStation.stationPeerId)
      .then((accounts) => {
        if (mounted) setRememberedAccounts(accounts);
      })
      .catch(() => {
        if (mounted) setRememberedAccounts([]);
      });
    return () => {
      mounted = false;
    };
  }, [activeStation?.stationPeerId]);

  async function commitStationRegistry(registry: StoredStationRegistry) {
    await replaceStationRegistryProjection(registry);
  }

  async function commitStationScope(registry: StoredStationRegistry) {
    const current = await readStationRegistryProjection();
    const currentStationPeerId = current.activeStationPeerId;
    if (
      !currentStationPeerId
      || currentStationPeerId === registry.activeStationPeerId
    ) {
      await commitStationRegistry(registry);
      return;
    }

    const completed = await runUserScopeTransition(
      'station-replace',
      async () => {
        await logoutSessionRuntime();
        await replaceStationRegistryProjection(registry);
      },
    );
    if (completed) showStationSelection();
  }

  function confirmStationIdentityReplacement(
    station: MobileStationEntry,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      Modal.confirm({
        title: t('mobile.launch.stationReplaceConfirmTitle'),
        content: t('mobile.launch.stationReplaceConfirmBody', {
          station: station.label,
        }),
        okText: t('mobile.launch.stationReplace'),
        cancelText: t('common.action.cancel'),
        okButtonProps: { danger: true },
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }

  async function runUserScopeTransition(
    reason: ScopeExitDecisionReason,
    transition: () => Promise<void>,
    options: { readonly restart?: boolean } = {},
  ): Promise<boolean> {
    if (pendingScopeExitRef.current) {
      throw new Error('mobile.reliability.scopeExitAlreadyPending');
    }
    const observed = await readReliabilityRuntimeStatus();
    const status = observed.active
      && observed.stationPeerId
      && observed.actorPtid
      ? await prepareReliabilityScopeExit(
          observed.stationPeerId,
          observed.actorPtid,
          observed.runtimeGeneration,
        )
      : observed;
    const execute = async (draftDisposition: DraftDisposition) => {
      await getMobileLifecycleKernel().transitionScope(
        reason,
        transition,
        options.restart === undefined
          ? { draftDisposition }
          : { restart: options.restart, draftDisposition },
      );
    };

    if (!status.active) {
      await execute('discard');
      return true;
    }

    return new Promise<boolean>((resolve) => {
      const request: PendingScopeExitRequest = {
        reason,
        draftCount: status.draftCount,
        committedDisposition: status.draftCount === 0 ? 'discard' : null,
        canCancel: status.draftCount > 0,
        run: async (draftDisposition) => {
          const current = pendingScopeExitRef.current;
          if (!current) {
            throw new Error('mobile.reliability.scopeExitMissing');
          }
          if (
            current.committedDisposition
            && current.committedDisposition !== draftDisposition
          ) {
            throw new Error('mobile.reliability.scopeExitDispositionCommitted');
          }
          const committedRequest = {
            ...current,
            committedDisposition: draftDisposition,
            canCancel: false,
          };
          pendingScopeExitRef.current = committedRequest;
          setPendingScopeExit(committedRequest);
          try {
            await execute(draftDisposition);
            pendingScopeExitRef.current = null;
            setPendingScopeExit(null);
            resolve(true);
          } catch (error) {
            throw error;
          }
        },
        cancel: async () => {
          const current = pendingScopeExitRef.current;
          if (!current?.canCancel) return;
          await openReliabilityAdmission(
            status.stationPeerId!,
            status.actorPtid!,
            status.runtimeGeneration,
          );
          notifyReliabilityCommandChanged();
          pendingScopeExitRef.current = null;
          setPendingScopeExit(null);
          resolve(false);
        },
      };
      pendingScopeExitRef.current = request;
      setPendingScopeExit(request);
    });
  }

  function autoProbeStation(
    station: MobileStationEntry,
    route: MobileStationRouteCandidate,
  ) {
    const verificationKey = `${station.stationPeerId}:${route.routeId}:${station.routeRevision ?? 1}`;
    if (autoVerifiedStationUrls.current.has(verificationKey)) return;
    autoVerifiedStationUrls.current.add(verificationKey);
    setVerifyingStationUrls((urls) => (
      urls.includes(route.endpointOrigin) ? urls : [...urls, route.endpointOrigin]
    ));

    verifyBoundStationRoute({
      stationPeerId: station.stationPeerId,
      routeId: route.routeId,
      routeGeneration: route.routeGeneration,
      routeRevision: station.routeRevision ?? 1,
      sourceRef: route.sourceRef,
      endpointOrigin: route.endpointOrigin,
    })
      .then(async (identity) => {
        requireMatchingStationIdentity(station, identity.stationPeerId);
        await updateStationRegistryProjection((current) => {
          const entry = current.entries.find(
            (candidate) => candidate.stationPeerId === station.stationPeerId,
          );
          if (!entry) return current;
          const next = updateStationEntryStatus(current, entry.stationPeerId, {
            checkedAt: identity.verifiedAt,
            online: true,
          });
          if (next === current) return current;
          return next;
        });
      })
      .catch(async () => {
        await updateStationRegistryProjection((current) => (
          updateStationEntryStatus(current, station.stationPeerId, {
            checkedAt: Date.now(),
            online: false,
          })
        ));
      })
      .finally(() => {
        setVerifyingStationUrls((urls) => (
          urls.filter((entryUrl) => entryUrl !== route.endpointOrigin)
        ));
      });
  }

  async function addDiscoveredRoute(
    route: NativeStationRouteCandidate,
  ): Promise<boolean> {
    const current = await readStationRegistryProjection();
    const existing = current.entries.find(
      (entry) => entry.stationPeerId === route.stationPeerId,
    );
    const nextRevision = existing
      ? (existing.routeRevision ?? 1) + (
        activeStationRoute(existing)?.routeId === route.routeId ? 0 : 1
      )
      : 1;
    const identity = await activateAndVerifyStationRoute(route, nextRevision);
    const next = addStationRoute(
      current,
      {
        identity: {
          stationPeerId: identity.stationPeerId,
          url: identity.canonicalOrigin,
        },
        stationHostPublicKey: route.stationHostPublicKey,
        route,
      },
      {
        checkedAt: identity.verifiedAt,
        online: true,
      },
    );
    if (!next.ok) {
      const conflictingStation = stationEntryAtUrl(current, route.endpointOrigin);
      if (
        route.routeType === 'direct'
        && next.error === 'mobile.launch.stationIdentityMismatch'
        && conflictingStation
        && await confirmStationIdentityReplacement(conflictingStation)
      ) {
        const replacement = replaceStationEntryIdentity(
          current,
          conflictingStation.stationPeerId,
          {
            stationPeerId: identity.stationPeerId,
            url: identity.canonicalOrigin,
          },
          {
            checkedAt: identity.verifiedAt,
            online: true,
          },
        );
        if (!replacement.ok) {
          await restorePreviousRoute(current, route);
          setStationError(t(replacement.error));
          return false;
        }
        const routedReplacement = addStationRoute(
          replacement.registry,
          {
            identity: {
              stationPeerId: identity.stationPeerId,
              url: identity.canonicalOrigin,
            },
            stationHostPublicKey: route.stationHostPublicKey,
            route,
          },
          {
            checkedAt: identity.verifiedAt,
            online: true,
          },
        );
        if (!routedReplacement.ok) {
          await restorePreviousRoute(current, route);
          setStationError(t(routedReplacement.error));
          return false;
        }
        try {
          await commitStationScope(routedReplacement.registry);
        } catch (error) {
          await restorePreviousRoute(current, route);
          throw error;
        }
        return true;
      }
      await restorePreviousRoute(current, route);
      setStationError(t(next.error));
      return false;
    }
    try {
      await commitStationScope(next.registry);
    } catch (error) {
      await restorePreviousRoute(current, route);
      throw error;
    }
    autoVerifiedStationUrls.current.add(
      `${identity.stationPeerId}:${route.routeId}:${nextRevision}`,
    );
    setStationError(null);
    return true;
  }

  async function restorePreviousRoute(
    registry: StoredStationRegistry,
    rejectedRoute: NativeStationRouteCandidate,
  ): Promise<void> {
    const previousStation = activeStationEntry(registry);
    const previousRoute = previousStation ? activeStationRoute(previousStation) : null;
    if (previousStation && previousRoute) {
      await verifyBoundStationRoute({
        stationPeerId: previousStation.stationPeerId,
        routeId: previousRoute.routeId,
        routeGeneration: previousRoute.routeGeneration,
        routeRevision: previousStation.routeRevision ?? 1,
        sourceRef: previousRoute.sourceRef,
        endpointOrigin: previousRoute.endpointOrigin,
      });
      return;
    }
    await removeStationRouteBinding({
      stationPeerId: rejectedRoute.stationPeerId,
      routeId: rejectedRoute.routeId,
      sourceRef: rejectedRoute.sourceRef,
    });
  }

  function confirmRouteSwitch(
    previous: MobileStationRouteCandidate,
    next: MobileStationRouteCandidate,
  ): Promise<boolean> {
    if (previous.routeType === next.routeType) return Promise.resolve(true);
    return new Promise((resolve) => {
      Modal.confirm({
        title: t('mobile.launch.routeSwitchConfirmTitle'),
        content: t('mobile.launch.routeSwitchConfirmBody'),
        okText: t('mobile.launch.switchRoute'),
        cancelText: t('common.action.cancel'),
        okButtonProps: {
          'data-station-route-confirm': 'true',
        },
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }

  async function selectStationRoute(
    stationPeerId: string,
    route: MobileStationRouteCandidate,
  ): Promise<void> {
    const current = await readStationRegistryProjection();
    const station = current.entries.find((entry) => entry.stationPeerId === stationPeerId);
    if (!station) throw new Error('mobile.auth.activeStationRequired');
    const previous = activeStationRoute(station);
    if (!previous || previous.routeId === route.routeId) return;
    if (!await confirmRouteSwitch(previous, route)) return;
    await selectStationRouteRuntime(stationPeerId, route.routeId);
  }

  async function verifyStationEntry(
    station: MobileStationEntry,
  ): Promise<StationIdentityResult> {
    const route = activeStationRoute(station);
    if (!route) throw new Error('mobile.launch.stationRouteUnavailable');
    return verifyBoundStationRoute({
      stationPeerId: station.stationPeerId,
      routeId: route.routeId,
      routeGeneration: route.routeGeneration,
      routeRevision: station.routeRevision ?? 1,
      sourceRef: route.sourceRef,
      endpointOrigin: route.endpointOrigin,
    });
  }

  async function login(input: Omit<StationLoginInput, 'stationPeerId' | 'stationUrl'>) {
    if (!activeStation) {
      setAuthError(t('mobile.auth.selectStation'));
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    try {
      if (!accessDecision?.attemptId) {
        setAuthError(t('mobile.auth.gateNotReady'));
        return;
      }
      const gate = currentAccessGate(accessDecision);
      if (!gate) {
        setAuthError(t('mobile.auth.gateNotReady'));
        return;
      }

      const { decision } = await submitStationLoginGate({
        stationUrl: activeStation.url,
        stationPeerId: activeStation.stationPeerId,
        attemptId: accessDecision.attemptId,
        gate,
        ...input,
      });
      applyAccessGateRuntimeResult(decision);
      if (isAccessGranted(decision)) {
        const activeSession = await activateNativeSessionRuntime(activeStation, decision);
        await rememberLoginAccount(activeSession, input.email).catch(() => undefined);
        setRememberedAccounts(
          await loadRememberedLoginAccounts(activeSession.stationPeerId).catch(() => []),
        );
        await reconcileShellAdmission();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      setAuthError(t(msg) !== msg ? t(msg) : (msg || t('mobile.auth.loginFailed')));
    } finally {
      setAuthLoading(false);
    }
  }

  async function logout() {
    const completed = await runUserScopeTransition(
      'logout',
      async () => {
        await logoutSessionRuntime();
      },
    );
    if (!completed) return;
    const selectedStation = activeStationEntry(
      await readStationRegistryProjection(),
    );
    if (!selectedStation) {
      showStationSelection();
      return;
    }
    await startAccessGateChainFor(selectedStation);
  }

  async function leaveCurrentStationForSelection() {
    const completed = await runUserScopeTransition(
      'station-replace',
      async () => {
        await logoutSessionRuntime();
      },
    );
    if (!completed) return;
    setAccessDecision(null);
    showStationSelection();
  }

  async function retryDeviceLocalRecovery(state: DeviceLocalFlagState) {
    if (state.reason === 'session-expired') {
      await getMobileLifecycleKernel().transitionScope(
        'revocation',
        logoutSessionRuntime,
        { draftDisposition: 'retain' },
      );
      const selectedStation = activeStationEntry(
        await readStationRegistryProjection(),
      );
      if (!selectedStation) {
        showStationSelection();
        return;
      }
      await startAccessGateChainFor(selectedStation);
      getRecoveryProjection().clearDeviceLocalFlag(state.reason);
      return;
    }

    const selectedStation = activeStationEntry(
      await readStationRegistryProjection(),
    );
    if (!selectedStation) {
      throw new Error('mobile.auth.activeStationRequired');
    }
    const verified = await verifyStationEntry(selectedStation);
    requireMatchingStationIdentity(selectedStation, verified.stationPeerId);
    await getMobileLifecycleKernel().restartRuntimeGraph('app-resume');
    getRecoveryProjection().clearDeviceLocalFlag(state.reason);
  }

  async function reAuthenticateSessionMismatch(
    state: SessionMismatchState,
  ) {
    const selectedStation = activeStationEntry(
      await readStationRegistryProjection(),
    );
    if (
      !selectedStation
      || selectedStation.stationPeerId !== state.expectedStationPeerId
    ) {
      throw new Error('mobile.launch.stationIdentityMismatch');
    }
    const verified = await verifyStationEntry(selectedStation);
    requireMatchingStationIdentity(selectedStation, verified.stationPeerId);
    await getMobileLifecycleKernel().transitionScope(
      'revocation',
      logoutSessionRuntime,
      { draftDisposition: 'retain' },
    );
    await startAccessGateChainFor(selectedStation);
    getRecoveryProjection().clearSessionMismatch();
  }

  async function submitInviteCode(code: string) {
    if (!activeStation) {
      setAuthError(t('mobile.auth.selectStation'));
      return;
    }
    if (!accessDecision?.attemptId) {
      setAuthError(t('mobile.auth.gateNotReady'));
      return;
    }
    const gate = currentAccessGate(accessDecision);
    if (!gate) {
      setAuthError(t('mobile.auth.gateNotReady'));
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    try {
      const { decision } = await submitStationInviteCodeGate({
        stationPeerId: activeStation.stationPeerId,
        stationUrl: activeStation.url,
        attemptId: accessDecision.attemptId,
        gate,
        inviteCode: code,
      });
      applyAccessGateRuntimeResult(decision);
      if (isAccessGranted(decision)) {
        await activateNativeSessionRuntime(activeStation, decision);
        await reconcileShellAdmission();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      setAuthError(t(msg) !== msg ? t(msg) : (msg || t('mobile.auth.inviteCodeRejected')));
    } finally {
      setAuthLoading(false);
    }
  }

  async function submitSchemaGate(values: Record<string, string | boolean | number>) {
    if (!activeStation || !accessDecision?.attemptId) {
      setAuthError(t('mobile.auth.gateNotReady'));
      return;
    }
    const gate = currentAccessGate(accessDecision);
    if (!gate) {
      setAuthError(t('mobile.auth.gateNotReady'));
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    try {
      const { decision } = await submitStationSchemaGate({
        stationPeerId: activeStation.stationPeerId,
        stationUrl: activeStation.url,
        attemptId: accessDecision.attemptId,
        gate,
        values,
      });
      applyAccessGateRuntimeResult(decision);
      if (isAccessGranted(decision)) {
        await activateNativeSessionRuntime(activeStation, decision);
        await reconcileShellAdmission();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      setAuthError(t(msg) !== msg ? t(msg) : (msg || t('mobile.auth.gateUnavailable')));
    } finally {
      setAuthLoading(false);
    }
  }

  async function refreshAccessGateDecision() {
    try {
      const decision = await refreshAccessDecisionForActiveStation();
      if (isAccessGranted(decision)) await reconcileShellAdmission();
    } catch {
      // The auth runtime preserves the attempt and projects the inline error.
    }
  }

  async function cancelAccessGateAttemptAndChangeStation() {
    try {
      await cancelAccessAttemptForActiveStation();
    } catch {
      return;
    }
    showStationSelection();
  }

  async function startAccessGateChainFor(station: MobileStationEntry) {
    getMobileLifecycleKernel().transitionLaunchState('station-handshake');
    setAuthLoading(true);
    setAuthError(null);
    let observedStationPeerId: string | null = null;
    try {
      const verified = await verifyStationEntry(station);
      observedStationPeerId = verified.stationPeerId;
      requireMatchingStationIdentity(station, verified.stationPeerId);
      getRecoveryProjection().clearSessionMismatch();
      const decision = await startAccessAttemptForActiveStation();
      applyAccessGateRuntimeResult(decision);
      if (isAccessGranted(decision)) {
        await reconcileShellAdmission();
        return;
      }
      getMobileLifecycleKernel().transitionLaunchState('access-gate-chain');
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (
        msg === 'mobile.launch.stationIdentityMismatch'
        && observedStationPeerId
      ) {
        getRecoveryProjection().reportSessionMismatch(
          station.stationPeerId,
          observedStationPeerId,
        );
      }
      setStationError(t(msg) !== msg ? t(msg) : (msg || t('mobile.launch.stationUnavailable')));
      showStationSelection();
    } finally {
      setAuthLoading(false);
    }
  }

  async function reconcileShellAdmission() {
    await getMobileLifecycleKernel().reconcileLaunchState('access-granted');
  }

  function showStationSelection() {
    const kernel = getMobileLifecycleKernel();
    if (kernel.getState().launchState === 'shell') {
      kernel.transitionLaunchState('station-change');
    }
    kernel.transitionLaunchState('station-selection');
  }

  // --- Render based on launch state ---

  function renderWithRecovery(content: ReactNode) {
    return (
      <>
        {content}
        <RecoveryOverlayHost
          onReAuthenticate={reAuthenticateSessionMismatch}
          onSwitchStation={leaveCurrentStationForSelection}
          onRetryDeviceLocal={retryDeviceLocalRecovery}
        />
        {pendingScopeExit && (
          <ScopeExitDraftDecisionOverlay
            reason={pendingScopeExit.reason}
            draftCount={pendingScopeExit.draftCount}
            committedDisposition={pendingScopeExit.committedDisposition}
            t={t}
            onDecision={pendingScopeExit.run}
            onCancel={pendingScopeExit.cancel}
            canCancel={pendingScopeExit.canCancel}
          />
        )}
        <Modal
          title={t('mobile.launch.chooseRelayStation')}
          open={pendingRouteChoice !== null}
          footer={null}
          onCancel={() => setPendingRouteChoice(null)}
          destroyOnClose
        >
          <div className="station-route-candidate-list">
            {pendingRouteChoice?.routes.map((route) => (
              <button
                key={`${route.stationPeerId}:${route.routeId}`}
                type="button"
                className="station-route-candidate"
                onClick={() => {
                  setPendingRouteChoice(null);
                  void addDiscoveredRoute(route).catch((error) => {
                    const message = error instanceof Error ? error.message : '';
                    setStationError(t(message) !== message
                      ? t(message)
                      : (message || t('mobile.launch.stationUnavailable')));
                  });
                }}
              >
                <span>{t('mobile.launch.station')}</span>
                <code>{route.stationPeerId}</code>
              </button>
            ))}
          </div>
        </Modal>
      </>
    );
  }

  if (launchState === 'shell') {
    return renderWithRecovery(
      <MobileShell
        stationRegistry={stationRegistry}
        onChangeStation={leaveCurrentStationForSelection}
        onChangeStationRoute={selectStationRoute}
        onLogout={logout}
      />,
    );
  }

  if (launchState === 'access-gate-chain') {
    return renderWithRecovery(
      <AccessGateHost
        decision={accessDecision}
        stationLabel={activeStation?.label || t('mobile.launch.station')}
        stationUrl={activeStation?.url || ''}
        error={authError}
        loading={authLoading}
        rememberedAccounts={rememberedAccounts}
        onBack={cancelAccessGateAttemptAndChangeStation}
        onRefresh={refreshAccessGateDecision}
        onLogin={login}
        onInviteCode={submitInviteCode}
        onSchemaSubmit={submitSchemaGate}
      />,
    );
  }

  return renderWithRecovery(
    <StationLaunchScreen
      registry={stationRegistry}
      error={stationError}
      checking={stationChecking}
      verifyingUrls={verifyingStationUrls}
      onAddStation={async (protocol: StationProtocol, address: string) => {
        const stationInput = buildStationAccessInput({ protocol, address });
        if (!stationInput) {
          setStationError(t('mobile.launch.validAddressHint'));
          return false;
        }

        setStationChecking(true);
        setStationError(null);
        try {
          const discovery = await discoverStationConnection(stationInput);
          if (discovery.routes.length > 1) {
            setPendingRouteChoice({ routes: discovery.routes });
            return true;
          }
          return await addDiscoveredRoute(discovery.routes[0]);
        } catch (error) {
          const msg = error instanceof Error ? error.message : '';
          setStationError(t(msg) !== msg ? t(msg) : (msg || t('mobile.launch.stationUnavailable')));
          return false;
        } finally {
          setStationChecking(false);
        }
      }}
      onSelectStation={async (stationPeerId) => {
        setStationError(null);
        const current = await readStationRegistryProjection();
        const next = activateStationEntry(current, stationPeerId);
        await commitStationScope(next);
      }}
      onSelectStationRoute={selectStationRoute}
      onRemoveStation={async (stationPeerId) => {
        setStationError(null);
        const current = await readStationRegistryProjection();
        const removing = current.entries.find((entry) => entry.stationPeerId === stationPeerId);
        const next = removeStationEntry(current, stationPeerId);
        if (next !== current) {
          await commitStationScope(next);
          await Promise.all((removing ? stationRoutes(removing) : []).map((route) => (
            removeStationRouteBinding({
              stationPeerId,
              routeId: route.routeId,
              sourceRef: route.sourceRef,
            })
          )));
        }
      }}
      onContinue={async () => {
        const current = await readStationRegistryProjection();
        const selectedStation = activeStationEntry(current);
        if (!selectedStation || stationChecking) return;

        setStationChecking(true);
        setStationError(null);
        try {
          const identity = await verifyStationEntry(selectedStation);
          let verifiedRegistry = current;
          let verifiedStation = selectedStation;
          if (identity.stationPeerId !== selectedStation.stationPeerId) {
            if (!await confirmStationIdentityReplacement(selectedStation)) return;
            const replacement = replaceStationEntryIdentity(
              current,
              selectedStation.stationPeerId,
              {
                stationPeerId: identity.stationPeerId,
                url: selectedStation.url,
              },
              {
                checkedAt: identity.verifiedAt,
                online: true,
              },
            );
            if (!replacement.ok) {
              setStationError(t(replacement.error));
              return;
            }
            verifiedRegistry = replacement.registry;
            verifiedStation = activeStationEntry(replacement.registry)!;
            await commitStationScope(replacement.registry);
          } else {
            requireMatchingStationIdentity(selectedStation, identity.stationPeerId);
          }
          const next = activateStationEntry(verifiedRegistry, verifiedStation.stationPeerId, {
            checkedAt: identity.verifiedAt,
            online: true,
          });
          await commitStationRegistry(next);
          const nextStation = activeStationEntry(next);
          if (!nextStation) throw new Error('mobile.launch.stationIdentityInvalid');
          await startAccessGateChainFor(nextStation);
        } catch (error) {
          const msg = error instanceof Error ? error.message : '';
          setStationError(t(msg) !== msg ? t(msg) : (msg || t('mobile.launch.stationUnavailable')));
        } finally {
          setStationChecking(false);
        }
      }}
    />,
  );
}

export function App() {
  return (
    <AppProviders>
      <MobileAppRoot />
    </AppProviders>
  );
}
