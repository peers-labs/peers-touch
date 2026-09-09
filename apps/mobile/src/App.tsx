import { useEffect, useRef, useState, type ReactNode } from 'react';

import { AppProviders } from './app/AppProviders';
import {
  getMobileLifecycleKernel,
  useLifecycleKernel,
} from './app/lifecycle';
import { useMobileI18n } from './app/mobileI18n';
import { MobileShell } from './components/MobileShell';
import { RecoveryOverlayHost } from './components/recovery';
import {
  submitStationLoginGate,
  submitStationInviteCodeGate,
  isAccessGranted,
  loadRememberedLoginAccounts,
  rememberLoginAccount,
  type MobileAuthSession,
  type RememberedLoginAccount,
  type StationLoginInput,
} from './features/auth/authSession';
import { AccessGateHost } from './features/auth/AccessGateHost';
import { useAuthStore } from './features/auth/authStore';
import { probeStation, verifyStationIdentity, type StationIdentityResult } from './features/station/stationConnection';
import { StationLaunchScreen } from './features/station/StationLaunchScreen';
import {
  logoutAuthRuntimeSession,
  startStationAccessAttemptWithRecovery,
} from './runtimes/authRuntime';
import {
  getRecoveryProjection,
  type DeviceLocalFlagState,
  type SessionMismatchState,
} from './runtimes/recoveryProjection';
import {
  activateStationEntry,
  activeStationEntry,
  addStationEntry,
  buildStationUrl,
  emptyStationRegistry,
  loadStationRegistry,
  persistStationRegistry,
  removeStationEntry,
  requireMatchingStationIdentity,
  updateStationEntryStatus,
  type StationProtocol,
  type MobileStationEntry,
  type StoredStationRegistry,
} from './features/station/stationRegistry';
import { purgeLegacyMobileIdentityStorage } from './storage/mobileClientStorage';

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
  const [stationRegistry, setStationRegistry] = useState<StoredStationRegistry>(() => emptyStationRegistry());
  const [stationError, setStationError] = useState<string | null>(null);
  const [stationChecking, setStationChecking] = useState(false);
  const [verifyingStationUrls, setVerifyingStationUrls] = useState<string[]>([]);
  const [rememberedAccounts, setRememberedAccounts] = useState<RememberedLoginAccount[]>([]);
  const stationRegistryRef = useRef(stationRegistry);
  const authSession = useAuthStore((state) => state.session);
  const authError = useAuthStore((state) => state.error);
  const authLoading = useAuthStore((state) => state.loading);
  const authRestored = useAuthStore((state) => state.restored);
  const accessDecision = useAuthStore((state) => state.accessDecision);
  const setAuthSession = useAuthStore((state) => state.setSession);
  const setAuthError = useAuthStore((state) => state.setError);
  const setAuthLoading = useAuthStore((state) => state.setLoading);
  const setAccessDecision = useAuthStore((state) => state.setAccessDecision);
  const autoVerifiedStationUrls = useRef<Set<string>>(new Set());
  const stationUrlsKey = stationRegistry.entries.map((entry) => entry.url).join('\n');
  const activeStation = activeStationEntry(stationRegistry);

  // The lifecycle-owned auth descriptor restores and revalidates credentials.
  // React only loads the device-local Station projection for rendering.
  useEffect(() => {
    if (lifecycle.phase !== 'ACTIVE') return;

    let mounted = true;
    purgeLegacyMobileIdentityStorage();

    loadStationRegistry()
      .catch(() => emptyStationRegistry())
      .then((registry) => {
        if (!mounted) return;
        replaceStationRegistry(registry);
        const kernel = getMobileLifecycleKernel();
        if (kernel.getState().launchState === 'app-boot') {
          kernel.transitionLaunchState('station-selection');
        }
      });

    return () => {
      mounted = false;
    };
  }, [lifecycle.generation, lifecycle.phase]);

  // --- Auto-start access gate chain when session matches station ---
  useEffect(() => {
    if (!authRestored) return;
    if (!activeStation) return;
    if (launchState !== 'station-selection') return;
    if (accessDecision) {
      if (
        authSession?.stationPeerId === activeStation.stationPeerId
        && isAccessGranted(accessDecision)
      ) {
        enterShell();
      } else {
        getMobileLifecycleKernel().transitionLaunchState('access-gate-chain');
      }
      return;
    }
    if (
      !authSession
      || authSession.stationPeerId !== activeStation.stationPeerId
    ) return;
    void startAccessGateChain(authSession);
  }, [accessDecision, activeStation, authRestored, authSession, launchState]);

  // --- Auto-probe station URLs ---
  useEffect(() => {
    if (launchState !== 'station-selection') return;

    const stationUrls = stationUrlsKey ? stationUrlsKey.split('\n') : [];
    for (const url of stationUrls) {
      autoProbeStation(url);
    }
  }, [launchState, stationUrlsKey]);

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

  function replaceStationRegistry(registry: StoredStationRegistry) {
    stationRegistryRef.current = registry;
    setStationRegistry(registry);
  }

  async function commitStationRegistry(registry: StoredStationRegistry) {
    replaceStationRegistry(registry);
    await persistStationRegistry(registry);
  }

  async function commitStationScope(registry: StoredStationRegistry) {
    const currentStationPeerId =
      stationRegistryRef.current.activeStationPeerId;
    if (
      !currentStationPeerId
      || currentStationPeerId === registry.activeStationPeerId
    ) {
      await commitStationRegistry(registry);
      return;
    }

    await getMobileLifecycleKernel().transitionScope(
      'station-replace',
      async () => {
        await logoutAuthRuntimeSession();
        await persistStationRegistry(registry);
        replaceStationRegistry(registry);
      },
    );
    showStationSelection();
  }

  function autoProbeStation(url: string) {
    if (autoVerifiedStationUrls.current.has(url)) return;
    autoVerifiedStationUrls.current.add(url);
    setVerifyingStationUrls((urls) => (urls.includes(url) ? urls : [...urls, url]));

    probeStation(url)
      .then((probe) => {
        setStationRegistry((current) => {
          const entry = current.entries.find((candidate) => candidate.url === url);
          if (!entry) return current;
          const next = updateStationEntryStatus(current, entry.stationPeerId, {
            checkedAt: probe.checkedAt,
            label: probe.label,
            online: probe.online,
          });
          if (next === current) return current;
          stationRegistryRef.current = next;
          void persistStationRegistry(next);
          return next;
        });
      })
      .finally(() => {
        setVerifyingStationUrls((urls) => urls.filter((entryUrl) => entryUrl !== url));
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

      const { session, decision } = await submitStationLoginGate({
        stationUrl: activeStation.url,
        stationPeerId: activeStation.stationPeerId,
        attemptId: accessDecision.attemptId,
        ...input,
      });
      await rememberLoginAccount(session, input.email).catch(() => undefined);
      setRememberedAccounts(await loadRememberedLoginAccounts(session.stationPeerId).catch(() => []));
      setAuthSession(session);
      setAccessDecision(decision);
      if (isAccessGranted(decision)) enterShell();
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      setAuthError(t(msg) !== msg ? t(msg) : (msg || t('mobile.auth.loginFailed')));
    } finally {
      setAuthLoading(false);
    }
  }

  async function logout() {
    const kernel = getMobileLifecycleKernel();
    await kernel.transitionScope('logout', logoutAuthRuntimeSession);
    const selectedStation = activeStationEntry(stationRegistryRef.current);
    if (!selectedStation) {
      showStationSelection();
      return;
    }
    await startAccessGateChainFor(selectedStation, null);
  }

  async function leaveCurrentStationForSelection() {
    await getMobileLifecycleKernel().transitionScope(
      'station-replace',
      logoutAuthRuntimeSession,
    );
    setAccessDecision(null);
    showStationSelection();
  }

  async function retryDeviceLocalRecovery(state: DeviceLocalFlagState) {
    if (state.reason === 'session-expired') {
      await getMobileLifecycleKernel().transitionScope(
        'revocation',
        logoutAuthRuntimeSession,
      );
      const selectedStation = activeStationEntry(stationRegistryRef.current);
      if (!selectedStation) {
        showStationSelection();
        return;
      }
      await startAccessGateChainFor(selectedStation, null);
      getRecoveryProjection().clearDeviceLocalFlag(state.reason);
      return;
    }

    const selectedStation = activeStationEntry(stationRegistryRef.current);
    if (!selectedStation) {
      throw new Error('mobile.auth.activeStationRequired');
    }
    const probe = await probeStation(selectedStation.url);
    if (!probe.online) {
      throw new Error('mobile.launch.stationUnavailable');
    }
    const verified = await verifyStationIdentity(selectedStation.url);
    requireMatchingStationIdentity(selectedStation, verified.stationPeerId);
    await getMobileLifecycleKernel().restartRuntimeGraph('app-resume');
    getRecoveryProjection().clearDeviceLocalFlag(state.reason);
  }

  async function reAuthenticateSessionMismatch(
    state: SessionMismatchState,
  ) {
    const selectedStation = activeStationEntry(stationRegistryRef.current);
    if (
      !selectedStation
      || selectedStation.stationPeerId !== state.expectedStationPeerId
    ) {
      throw new Error('mobile.launch.stationIdentityMismatch');
    }
    const verified = await verifyStationIdentity(selectedStation.url);
    requireMatchingStationIdentity(selectedStation, verified.stationPeerId);
    await getMobileLifecycleKernel().transitionScope(
      'revocation',
      logoutAuthRuntimeSession,
    );
    await startAccessGateChainFor(selectedStation, null);
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

    setAuthLoading(true);
    setAuthError(null);
    try {
      const decision = await submitStationInviteCodeGate({
        stationUrl: activeStation.url,
        attemptId: accessDecision.attemptId,
        inviteCode: code,
      });
      setAccessDecision(decision);
      if (isAccessGranted(decision)) enterShell();
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      setAuthError(t(msg) !== msg ? t(msg) : (msg || t('mobile.auth.inviteCodeRejected')));
    } finally {
      setAuthLoading(false);
    }
  }

  async function startAccessGateChain(session?: MobileAuthSession | null) {
    const selectedStation = activeStationEntry(stationRegistryRef.current);
    if (!selectedStation) return;
    await startAccessGateChainFor(selectedStation, session);
  }

  async function startAccessGateChainFor(station: MobileStationEntry, session?: MobileAuthSession | null) {
    getMobileLifecycleKernel().transitionLaunchState('station-handshake');
    setAuthLoading(true);
    setAuthError(null);
    let observedStationPeerId: string | null = null;
    try {
      const verified = await verifyStationIdentity(station.url);
      observedStationPeerId = verified.stationPeerId;
      requireMatchingStationIdentity(station, verified.stationPeerId);
      getRecoveryProjection().clearSessionMismatch();
      const decision = await startStationAccessAttemptWithRecovery(
        station.stationPeerId,
        station.url,
        session,
      );
      setAccessDecision(decision);
      if (isAccessGranted(decision)) {
        enterShell();
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

  function enterShell() {
    const kernel = getMobileLifecycleKernel();
    kernel.transitionLaunchState('runtime-critical');
    kernel.transitionLaunchState('shell');
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
      </>
    );
  }

  if (launchState === 'shell') {
    return renderWithRecovery(
      <MobileShell
        stationRegistry={stationRegistry}
        onChangeStation={showStationSelection}
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
        onBack={() => {
          setAccessDecision(null);
          showStationSelection();
        }}
        onLogin={login}
        onInviteCode={submitInviteCode}
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
        const normalizedUrl = buildStationUrl({ protocol, address });
        if (!normalizedUrl) {
          setStationError(t('mobile.launch.validAddressHint'));
          return false;
        }

        setStationChecking(true);
        setStationError(null);
        try {
          const probe = await probeStation(normalizedUrl);
          if (!probe.online) {
            setStationError(probe.error ?? t('mobile.launch.stationUnavailable'));
            return false;
          }

          const identity = await verifyStationIdentity(normalizedUrl);
          const next = addStationEntry(
            stationRegistryRef.current,
            { stationPeerId: identity.stationPeerId, url: normalizedUrl },
            { checkedAt: probe.checkedAt, label: probe.label, online: probe.online },
            identity.identityVerified,
          );
          if (!next.ok) {
            setStationError(t(next.error));
            return false;
          }
          autoVerifiedStationUrls.current.add(normalizedUrl);
          setStationError(null);
          await commitStationScope(next.registry);
          return true;
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
        const next = activateStationEntry(stationRegistryRef.current, stationPeerId);
        await commitStationScope(next);
      }}
      onRemoveStation={async (stationPeerId) => {
        setStationError(null);
        const next = removeStationEntry(stationRegistryRef.current, stationPeerId);
        if (next !== stationRegistryRef.current) await commitStationScope(next);
      }}
      onContinue={async () => {
        const selectedStation = activeStationEntry(stationRegistryRef.current);
        if (!selectedStation || stationChecking) return;

        setStationChecking(true);
        setStationError(null);
        try {
          const probe = await probeStation(selectedStation.url);
          if (!probe.online) {
            setStationError(probe.error ?? t('mobile.launch.stationUnavailable'));
            return;
          }
          const identity = await verifyStationIdentity(selectedStation.url);
          if (identity.identityVerified) {
            requireMatchingStationIdentity(selectedStation, identity.stationPeerId);
          }
          const next = activateStationEntry(stationRegistryRef.current, selectedStation.stationPeerId, {
            checkedAt: probe.checkedAt,
            label: probe.label,
            online: probe.online,
          });
          await commitStationRegistry(next);
          const nextStation = activeStationEntry(next);
          if (!nextStation) throw new Error('mobile.launch.stationIdentityInvalid');
          await startAccessGateChainFor(
            nextStation,
            authSession?.stationPeerId === nextStation.stationPeerId ? authSession : null,
          );
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
