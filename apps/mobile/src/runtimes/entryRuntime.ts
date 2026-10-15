import { useSyncExternalStore } from 'react';

import { getMobileLifecycleKernel } from '../app/lifecycle/MobileLifecycleKernel';
import type { DraftDisposition, MobileRuntimeDescriptor } from '../app/lifecycle/types';
import type { ScopeExitDecisionReason } from '../components/recovery';
import {
  currentAccessGate,
  isAccessGranted,
  loadRememberedLoginAccounts,
  rememberLoginAccount,
  submitStationInviteCodeGate,
  submitStationLoginGate,
  submitStationSchemaGate,
  type RememberedLoginAccount,
  type StationLoginInput,
} from '../features/auth/authSession';
import { useAuthStore } from '../features/auth/authStore';
import {
  activateAndVerifyStationRoute,
  discoverStationConnection,
  verifyBoundStationRoute,
} from '../features/station/stationConnection';
import {
  activateStationEntry,
  activeStationRoute,
  activeStationEntry,
  addStationRoute,
  buildStationAccessInput,
  removeStationEntry,
  requireMatchingStationIdentity,
  stationEntryAtUrl,
  stationRoutes,
  updateStationEntryStatus,
  type MobileStationEntry,
  type MobileStationRouteCandidate,
  type StoredStationRegistry,
} from '../features/station/stationRegistry';
import {
  removeStationRouteBinding,
  type NativeStationRouteCandidate,
} from '../services/mobileCommands';
import {
  applyAccessGateRuntimeResult,
  cancelAccessAttemptForActiveStation,
  refreshAccessDecisionForActiveStation,
  startAccessAttemptForActiveStation,
} from './accessRuntime';
import {
  notifyReliabilityCommandChanged,
  openReliabilityAdmission,
  prepareReliabilityScopeExit,
  readReliabilityRuntimeStatus,
} from './commandRuntime';
import {
  getRecoveryProjection,
  type DeviceLocalFlagState,
  type SessionMismatchState,
} from './recoveryProjection';
import { activateNativeSessionRuntime, logoutSessionRuntime } from './sessionRuntime';
import {
  readStationRegistryProjection,
  replaceStationRegistryProjection,
  selectStationRouteRuntime,
  subscribeStationRegistryProjection,
  updateStationRegistryProjection,
} from './stationRuntime';

export interface EntryScopeExitProjection {
  readonly reason: ScopeExitDecisionReason;
  readonly draftCount: number;
  readonly committedDisposition: DraftDisposition | null;
  readonly canCancel: boolean;
  readonly run: (disposition: DraftDisposition) => Promise<void>;
  readonly cancel: () => Promise<void>;
}

export interface MobileEntryProjection {
  readonly stationError: string | null;
  readonly stationChecking: boolean;
  readonly verifyingStationUrls: readonly string[];
  readonly checkedStationUrls: readonly string[];
  readonly rememberedAccounts: RememberedLoginAccount[];
  readonly pendingScopeExit: EntryScopeExitProjection | null;
  readonly pendingIdentityReplacement: MobileStationEntry | null;
  readonly pendingRouteChoices: readonly NativeStationRouteCandidate[];
}

/**
 * App-scoped entry orchestration. Credentials, registry persistence and launch
 * admission remain with their existing owners; this runtime owns transient
 * operation state and user decisions across renderer mounts.
 */
export function createMobileEntryRuntime() {
  let snapshot: MobileEntryProjection = {
    stationError: null,
    stationChecking: false,
    verifyingStationUrls: [],
    checkedStationUrls: [],
    rememberedAccounts: [],
    pendingScopeExit: null,
    pendingIdentityReplacement: null,
    pendingRouteChoices: [],
  };
  const listeners = new Set<() => void>();
  const verifiedSelectionKeys = new Set<string>();
  let accessRevision = 0;
  let selectionRevision = 0;
  let accountRevision = 0;
  let rememberedStationPeerId: string | null = null;
  let selectionActive = false;
  let releases: (() => void)[] = [];
  let resolveIdentity: ((replace: boolean) => void) | null = null;
  let scopePreparing = false;

  const publish = (patch: Partial<MobileEntryProjection>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };
  const errorKey = (error: unknown, fallback: string) => (
    error instanceof Error && error.message ? error.message : fallback
  );
  const selectedStation = async () => activeStationEntry(await readStationRegistryProjection());
  const showStationSelection = () => {
    accessRevision += 1;
    useAuthStore.getState().setLoading(false);
    const kernel = getMobileLifecycleKernel();
    if (kernel.getState().launchState === 'shell') {
      kernel.transitionLaunchState('station-change');
    }
    kernel.transitionLaunchState('station-selection');
  };
  const confirmStationIdentityReplacement = (station: MobileStationEntry) => (
    new Promise<boolean>((resolve) => {
      if (resolveIdentity) {
        resolve(false);
        return;
      }
      resolveIdentity = resolve;
      publish({ pendingIdentityReplacement: station });
    })
  );
  const resolveStationIdentityReplacement = (replace: boolean) => {
    const resolve = resolveIdentity;
    resolveIdentity = null;
    publish({ pendingIdentityReplacement: null });
    resolve?.(replace);
  };

  async function runUserScopeTransition(
    reason: ScopeExitDecisionReason,
    transition: () => Promise<unknown>,
  ): Promise<boolean> {
    if (scopePreparing || snapshot.pendingScopeExit) {
      throw new Error('mobile.reliability.scopeExitAlreadyPending');
    }
    scopePreparing = true;
    try {
      const observed = await readReliabilityRuntimeStatus();
      const status = observed.active && observed.stationPeerId && observed.actorPtid
        ? await prepareReliabilityScopeExit(
            observed.stationPeerId, observed.actorPtid, observed.runtimeGeneration,
          )
        : observed;
      const execute = (draftDisposition: DraftDisposition) => (
        getMobileLifecycleKernel().transitionScope(
          reason, async () => { await transition(); }, { draftDisposition },
        )
      );
      if (!status.active) {
        await execute('discard');
        return true;
      }
      // A decision-free scope exit needs no dialog. Admission is already fenced.
      if (status.draftCount === 0) {
        await execute('discard');
        return true;
      }
      return await new Promise<boolean>((resolve) => {
        const request: EntryScopeExitProjection = {
          reason,
          draftCount: status.draftCount,
          committedDisposition: null,
          canCancel: true,
          run: async (draftDisposition) => {
            const current = snapshot.pendingScopeExit;
            if (!current) throw new Error('mobile.reliability.scopeExitMissing');
            if (
              current.committedDisposition
              && current.committedDisposition !== draftDisposition
            ) throw new Error('mobile.reliability.scopeExitDispositionCommitted');
            publish({
              pendingScopeExit: {
                ...current, committedDisposition: draftDisposition, canCancel: false,
              },
            });
            await execute(draftDisposition);
            publish({ pendingScopeExit: null });
            resolve(true);
          },
          cancel: async () => {
            if (!snapshot.pendingScopeExit?.canCancel) return;
            await openReliabilityAdmission(
              status.stationPeerId!, status.actorPtid!, status.runtimeGeneration,
            );
            notifyReliabilityCommandChanged();
            publish({ pendingScopeExit: null });
            resolve(false);
          },
        };
        publish({ pendingScopeExit: request });
      });
    } finally {
      scopePreparing = false;
    }
  }

  async function commitStationScope(registry: StoredStationRegistry) {
    const current = await readStationRegistryProjection();
    if (
      !current.activeStationPeerId
      || current.activeStationPeerId === registry.activeStationPeerId
    ) {
      await replaceStationRegistryProjection(registry);
      return;
    }
    const completed = await runUserScopeTransition('station-replace', async () => {
      await logoutSessionRuntime();
      await replaceStationRegistryProjection(registry);
    });
    if (completed) showStationSelection();
  }

  async function probeEntry(entry: MobileStationEntry, revision: number) {
    const route = activeStationRoute(entry);
    const key = route
      ? `${entry.stationPeerId}\u0000${route.routeId}\u0000${entry.routeRevision ?? 1}`
      : `${entry.stationPeerId}\u0000missing`;
    if (verifiedSelectionKeys.has(key)) return;
    verifiedSelectionKeys.add(key);
    publish({
      verifyingStationUrls: [...snapshot.verifyingStationUrls, entry.url],
      checkedStationUrls: snapshot.checkedStationUrls.filter((url) => url !== entry.url),
    });
    let online = false;
    let checkedAt = Date.now();
    try {
      if (!route) throw new Error('mobile.launch.stationRouteUnavailable');
      const identity = await verifyBoundStationRoute({
        stationPeerId: entry.stationPeerId,
        routeId: route.routeId,
        routeGeneration: route.routeGeneration,
        routeRevision: entry.routeRevision ?? 1,
        sourceRef: route.sourceRef,
        endpointOrigin: route.endpointOrigin,
      });
      checkedAt = identity.verifiedAt;
      online = identity.stationPeerId === entry.stationPeerId;
    } catch {
      online = false;
    }
    if (revision !== selectionRevision) return;
    await updateStationRegistryProjection((current) => {
      const currentEntry = current.entries.find((candidate) => (
        candidate.stationPeerId === entry.stationPeerId && candidate.url === entry.url
      ));
      return currentEntry
        ? updateStationEntryStatus(current, entry.stationPeerId, { checkedAt, online })
        : current;
    }).catch((error: unknown) => {
      publish({ stationError: errorKey(error, 'mobile.launch.stationUnavailable') });
    });
    if (revision !== selectionRevision) return;
    publish({
      verifyingStationUrls: snapshot.verifyingStationUrls.filter((url) => url !== entry.url),
      checkedStationUrls: [...new Set([...snapshot.checkedStationUrls, entry.url])],
    });
  }

  async function synchronizeSelection() {
    const stationSelection = getMobileLifecycleKernel().getState().launchState === 'station-selection';
    if (stationSelection !== selectionActive) {
      selectionActive = stationSelection;
      selectionRevision += 1;
      verifiedSelectionKeys.clear();
      publish({ checkedStationUrls: [], verifyingStationUrls: [] });
    }
    const observedSelectionRevision = selectionRevision;
    const registry = await readStationRegistryProjection();
    if (observedSelectionRevision !== selectionRevision) return;
    if (stationSelection) {
      for (const entry of registry.entries) void probeEntry(entry, selectionRevision);
    }
    const stationPeerId = registry.activeStationPeerId;
    if (stationPeerId === rememberedStationPeerId) return;
    rememberedStationPeerId = stationPeerId;
    const revision = ++accountRevision;
    publish({ rememberedAccounts: [] });
    if (!stationPeerId) return;
    try {
      const accounts = await loadRememberedLoginAccounts(stationPeerId);
      if (revision !== accountRevision) return;
      publish({ rememberedAccounts: accounts });
      const auth = useAuthStore.getState();
      const remembered = accounts.find((account) => (
        account.stationPeerId === auth.session?.stationPeerId
        && account.ptid === auth.session?.actorRef.ptid
      ));
      if (auth.session && !auth.session.actorRef.acct && remembered) {
        auth.setSession({
          ...auth.session, actorRef: { ...auth.session.actorRef, acct: remembered.email },
        });
      }
    } catch {
      // Remembered labels are optional; authentication never depends on them.
    }
  }

  async function verifyStationEntry(station: MobileStationEntry) {
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

  async function startAccessGateChainFor(station: MobileStationEntry) {
    const requestRevision = ++accessRevision;
    const kernel = getMobileLifecycleKernel();
    kernel.transitionLaunchState('station-handshake');
    const auth = useAuthStore.getState();
    auth.setLoading(true);
    auth.setError(null);
    let observedStationPeerId: string | null = null;
    try {
      const verified = await verifyStationEntry(station);
      observedStationPeerId = verified.stationPeerId;
      requireMatchingStationIdentity(station, verified.stationPeerId);
      if (requestRevision !== accessRevision) return;
      getRecoveryProjection().clearSessionMismatch();
      const decision = await startAccessAttemptForActiveStation();
      if (
        requestRevision !== accessRevision
        || kernel.getState().launchState !== 'station-handshake'
      ) {
        if (useAuthStore.getState().accessDecision?.attemptId === decision.attemptId) {
          await cancelAccessAttemptForActiveStation().catch(() => auth.setAccessDecision(null));
        }
        return;
      }
      applyAccessGateRuntimeResult(decision);
      if (isAccessGranted(decision)) {
        await kernel.reconcileLaunchState('access-granted');
      } else {
        kernel.transitionLaunchState('access-gate-chain');
      }
    } catch (error) {
      if (requestRevision !== accessRevision) return;
      if (errorKey(error, '') === 'mobile.launch.stationIdentityMismatch' && observedStationPeerId) {
        getRecoveryProjection().reportSessionMismatch(station.stationPeerId, observedStationPeerId);
      }
      publish({ stationError: errorKey(error, 'mobile.launch.stationUnavailable') });
      auth.setLoading(false);
      showStationSelection();
    } finally {
      if (requestRevision === accessRevision) auth.setLoading(false);
    }
  }

  async function submitGate(
    submit: (
      station: MobileStationEntry,
      attemptId: string,
      gate: NonNullable<ReturnType<typeof currentAccessGate>>,
    ) => ReturnType<typeof submitStationLoginGate>,
    fallback: string,
    email?: string,
  ) {
    const station = await selectedStation();
    const auth = useAuthStore.getState();
    const attemptId = auth.accessDecision?.attemptId;
    const gate = auth.accessDecision && currentAccessGate(auth.accessDecision);
    if (!station || !attemptId || !gate) {
      auth.setError('mobile.auth.gateNotReady');
      return;
    }
    const revision = accessRevision;
    auth.setLoading(true);
    auth.setError(null);
    try {
      const { decision } = await submit(station, attemptId, gate);
      if (revision !== accessRevision) return;
      applyAccessGateRuntimeResult(decision);
      if (isAccessGranted(decision)) {
        await activateNativeSessionRuntime(station, decision);
        if (revision !== accessRevision) return;
        if (email) {
          const session = useAuthStore.getState().session;
          if (session) {
            await rememberLoginAccount(session, email).catch(() => undefined);
            const accounts = await loadRememberedLoginAccounts(station.stationPeerId).catch(() => []);
            if (revision === accessRevision) publish({ rememberedAccounts: accounts });
          }
        }
        await getMobileLifecycleKernel().reconcileLaunchState('access-granted');
      }
    } catch (error) {
      if (revision === accessRevision) auth.setError(errorKey(error, fallback));
    } finally {
      if (revision === accessRevision) auth.setLoading(false);
    }
  }

  async function restorePreviousRoute(
    registry: StoredStationRegistry,
    rejectedRoute: NativeStationRouteCandidate,
  ): Promise<void> {
    const previousStation = activeStationEntry(registry);
    const previousRoute = previousStation
      ? activeStationRoute(previousStation)
      : null;
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
    const identity = await activateAndVerifyStationRoute(
      route,
      nextRevision,
    );
    const input = {
      identity: {
        stationPeerId: identity.stationPeerId,
        url: identity.canonicalOrigin,
      },
      stationRootPublicKey: route.stationRootPublicKey,
      route,
    };
    let next = addStationRoute(current, input, {
      checkedAt: identity.verifiedAt,
      online: true,
    });
    if (!next.ok) {
      const conflictingStation = route.routeType === 'direct'
        ? stationEntryAtUrl(current, route.endpointOrigin)
        : null;
      if (
        next.error !== 'mobile.launch.stationIdentityMismatch'
        || !conflictingStation
        || !await confirmStationIdentityReplacement(conflictingStation)
      ) {
        await restorePreviousRoute(current, route);
        throw new Error(next.error);
      }
      const previousRoutes = stationRoutes(conflictingStation);
      next = addStationRoute(
        removeStationEntry(current, conflictingStation.stationPeerId),
        input,
        {
          checkedAt: identity.verifiedAt,
          online: true,
        },
      );
      if (!next.ok) {
        await restorePreviousRoute(current, route);
        throw new Error(next.error);
      }
      try {
        await commitStationScope(next.registry);
      } catch (error) {
        await restorePreviousRoute(current, route);
        throw error;
      }
      await Promise.all(previousRoutes.map((previousRoute) => (
        removeStationRouteBinding({
          stationPeerId: conflictingStation.stationPeerId,
          routeId: previousRoute.routeId,
          sourceRef: previousRoute.sourceRef,
        })
      )));
      return true;
    }
    try {
      await commitStationScope(next.registry);
    } catch (error) {
      await restorePreviousRoute(current, route);
      throw error;
    }
    verifiedSelectionKeys.add(
      `${identity.stationPeerId}\u0000${route.routeId}\u0000${nextRevision}`,
    );
    publish({
      checkedStationUrls: [
        ...new Set([
          ...snapshot.checkedStationUrls,
          identity.canonicalOrigin,
        ]),
      ],
      stationError: null,
    });
    return true;
  }

  async function addStation(stationInput: string): Promise<boolean> {
    if (snapshot.stationChecking) return false;
    const normalizedInput = buildStationAccessInput(stationInput);
    if (!normalizedInput) {
      publish({ stationError: 'mobile.launch.validAddressHint' });
      return false;
    }
    publish({ stationChecking: true, stationError: null });
    try {
      const discovery = await discoverStationConnection(normalizedInput);
      if (discovery.routes.length > 1) {
        publish({ pendingRouteChoices: discovery.routes });
        return true;
      }
      return await addDiscoveredRoute(discovery.routes[0]);
    } catch (error) {
      publish({ stationError: errorKey(error, 'mobile.launch.stationUnavailable') });
      return false;
    } finally {
      publish({ stationChecking: false });
    }
  }

  async function chooseDiscoveredRoute(
    route: NativeStationRouteCandidate,
  ): Promise<boolean> {
    if (snapshot.stationChecking) return false;
    publish({
      pendingRouteChoices: [],
      stationChecking: true,
      stationError: null,
    });
    try {
      return await addDiscoveredRoute(route);
    } catch (error) {
      publish({
        stationError: errorKey(error, 'mobile.launch.stationUnavailable'),
      });
      return false;
    } finally {
      publish({ stationChecking: false });
    }
  }

  async function continueStation() {
    if (snapshot.stationChecking) return;
    const station = await selectedStation();
    if (!station) return;
    publish({ stationChecking: true, stationError: null });
    try {
      const identity = await verifyStationEntry(station);
      publish({
        checkedStationUrls: [
          ...new Set([...snapshot.checkedStationUrls, station.url]),
        ],
      });
      const current = await readStationRegistryProjection();
      if (current.activeStationPeerId !== station.stationPeerId) return;
      requireMatchingStationIdentity(station, identity.stationPeerId);
      const next = activateStationEntry(current, station.stationPeerId, {
        checkedAt: identity.verifiedAt,
        online: true,
      });
      await replaceStationRegistryProjection(next);
      const verifiedStation = activeStationEntry(next);
      if (!verifiedStation) {
        throw new Error('mobile.launch.stationIdentityInvalid');
      }
      await startAccessGateChainFor(verifiedStation);
    } catch (error) {
      publish({ stationError: errorKey(error, 'mobile.launch.stationUnavailable') });
      await updateStationRegistryProjection((registry) => updateStationEntryStatus(
        registry, station.stationPeerId, { checkedAt: Date.now(), online: false },
      ));
    } finally {
      publish({ stationChecking: false });
    }
  }

  async function leaveCurrentStationForSelection() {
    accessRevision += 1;
    const completed = await runUserScopeTransition('station-replace', logoutSessionRuntime);
    if (!completed) return;
    useAuthStore.getState().setAccessDecision(null);
    useAuthStore.getState().setLoading(false);
    showStationSelection();
  }

  async function reauthenticateStation(expectedStationPeerId: string) {
    const station = await selectedStation();
    if (!station || station.stationPeerId !== expectedStationPeerId) {
      throw new Error('mobile.launch.stationIdentityMismatch');
    }
    const verified = await verifyStationEntry(station);
    requireMatchingStationIdentity(station, verified.stationPeerId);
    await getMobileLifecycleKernel().transitionScope(
      'revocation', logoutSessionRuntime, { draftDisposition: 'retain' },
    );
    await startAccessGateChainFor(station);
  }

  const actions = {
    reAuthenticatePin: reauthenticateStation,
    addStation,
    chooseDiscoveredRoute,
    cancelRouteChoice() {
      publish({ pendingRouteChoices: [] });
    },
    continueStation,
    showStationSelection,
    resolveStationIdentityReplacement,
    leaveCurrentStationForSelection,
    async retryRuntime() {
      await getMobileLifecycleKernel().restartRuntimeGraph('reliability-recovery');
    },
    async selectStation(stationPeerId: string) {
      publish({ stationError: null });
      await commitStationScope(activateStationEntry(await readStationRegistryProjection(), stationPeerId));
    },
    async selectStationRoute(
      stationPeerId: string,
      route: MobileStationRouteCandidate,
    ) {
      publish({ stationError: null });
      await selectStationRouteRuntime(stationPeerId, route.routeId);
    },
    async removeStation(stationPeerId: string) {
      publish({ stationError: null });
      const current = await readStationRegistryProjection();
      const removing = current.entries.find(
        (entry) => entry.stationPeerId === stationPeerId,
      );
      const next = removeStationEntry(current, stationPeerId);
      if (next === current) return;
      await commitStationScope(next);
      await Promise.all((removing ? stationRoutes(removing) : []).map((route) => (
        removeStationRouteBinding({
          stationPeerId,
          routeId: route.routeId,
          sourceRef: route.sourceRef,
        })
      )));
    },
    login(input: Omit<StationLoginInput, 'stationPeerId' | 'stationUrl'>) {
      return submitGate(
        (station, attemptId, gate) => submitStationLoginGate({
          stationPeerId: station.stationPeerId, stationUrl: station.url, attemptId, gate, ...input,
        }),
        'mobile.auth.loginFailed', input.email,
      );
    },
    submitInviteCode(inviteCode: string) {
      return submitGate(
        (station, attemptId, gate) => submitStationInviteCodeGate({
          stationPeerId: station.stationPeerId, stationUrl: station.url, attemptId, gate, inviteCode,
        }),
        'mobile.auth.inviteCodeRejected',
      );
    },
    submitSchemaGate(values: Record<string, string | boolean | number>) {
      return submitGate(
        (station, attemptId, gate) => submitStationSchemaGate({
          stationPeerId: station.stationPeerId, stationUrl: station.url, attemptId, gate, values,
        }),
        'mobile.auth.gateUnavailable',
      );
    },
    async logout() {
      const completed = await runUserScopeTransition('logout', logoutSessionRuntime);
      if (!completed) return;
      const station = await selectedStation();
      if (station) await startAccessGateChainFor(station);
      else showStationSelection();
    },
    async refreshAccessGateDecision() {
      try {
        const decision = await refreshAccessDecisionForActiveStation();
        if (isAccessGranted(decision)) {
          await getMobileLifecycleKernel().reconcileLaunchState('access-granted');
        }
      } catch {
        // Access Runtime retains the attempt and publishes its recoverable error.
      }
    },
    async cancelAccessGateAttemptAndChangeStation() {
      accessRevision += 1;
      try {
        await cancelAccessAttemptForActiveStation();
        useAuthStore.getState().setLoading(false);
        showStationSelection();
      } catch {
        // The Access Runtime owns cancellation failure and retry.
      }
    },
    async retryDeviceLocalRecovery(state: DeviceLocalFlagState) {
      const kernel = getMobileLifecycleKernel();
      if (state.reason === 'session-expired') {
        await kernel.transitionScope('revocation', logoutSessionRuntime, { draftDisposition: 'retain' });
        const station = await selectedStation();
        if (station) await startAccessGateChainFor(station);
        else showStationSelection();
      } else {
        const station = await selectedStation();
        if (!station) throw new Error('mobile.auth.activeStationRequired');
        const verified = await verifyStationEntry(station);
        requireMatchingStationIdentity(station, verified.stationPeerId);
        await kernel.restartRuntimeGraph('app-resume');
      }
      getRecoveryProjection().clearDeviceLocalFlag(state.reason);
    },
    async reAuthenticateSessionMismatch(state: SessionMismatchState) {
      await reauthenticateStation(state.expectedStationPeerId);
      getRecoveryProjection().clearSessionMismatch();
    },
  };

  return {
    actions,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start() {
      if (releases.length) return;
      const synchronize = () => {
        void synchronizeSelection().catch((error: unknown) => {
          publish({ stationError: errorKey(error, 'mobile.launch.stationUnavailable') });
        });
      };
      releases = [
        getMobileLifecycleKernel().subscribe(synchronize),
        subscribeStationRegistryProjection(synchronize),
      ];
      synchronize();
    },
    stop() {
      releases.forEach((release) => release());
      releases = [];
      accessRevision += 1;
      selectionRevision += 1;
      accountRevision += 1;
      rememberedStationPeerId = null;
      selectionActive = false;
      verifiedSelectionKeys.clear();
      resolveStationIdentityReplacement(false);
    },
  };
}

const entryRuntime = createMobileEntryRuntime();
export const mobileEntryActions = entryRuntime.actions;

export function useMobileEntryProjection(): MobileEntryProjection {
  return useSyncExternalStore(entryRuntime.subscribe, entryRuntime.getSnapshot, entryRuntime.getSnapshot);
}

export function createEntryRuntimeDescriptor(): MobileRuntimeDescriptor {
  return {
    id: 'entry',
    title: 'Entry Runtime',
    responsibility: 'Owns Station selection probes, access submission and scope-exit decisions.',
    dependsOn: ['station', 'auth', 'access'],
    async bootstrap() { entryRuntime.start(); },
    async suspend() { /* Native system surfaces must retain pending entry decisions. */ },
    async resume() { entryRuntime.start(); },
    async teardown(context) {
      if (context.reason === 'app-unmount') entryRuntime.stop();
      return { runtimeId: 'entry', success: true, durationMs: 0 };
    },
  };
}
