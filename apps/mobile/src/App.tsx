import { useEffect, useRef, useState } from 'react';

import { AppProviders } from './app/AppProviders';
import { useMobileI18n } from './app/mobileI18n';
import { MobileShell } from './components/MobileShell';
import {
  startStationAccessAttempt,
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
import { probeStation, verifyStationIdentity } from './features/station/stationConnection';
import { StationLaunchScreen } from './features/station/StationLaunchScreen';
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

type LaunchState = 'station-selection' | 'access-gate-chain' | 'shell';

function MobileAppRoot() {
  const { t } = useMobileI18n();
  const [launchState, setLaunchState] = useState<LaunchState>('station-selection');
  const [stationRegistry, setStationRegistry] = useState<StoredStationRegistry>(() => emptyStationRegistry());
  const [stationError, setStationError] = useState<string | null>(null);
  const [stationChecking, setStationChecking] = useState(false);
  const [verifyingStationUrls, setVerifyingStationUrls] = useState<string[]>([]);
  const [rememberedAccounts, setRememberedAccounts] = useState<RememberedLoginAccount[]>([]);
  const stationRegistryRef = useRef(stationRegistry);
  const authSession = useAuthStore((state) => state.session);
  const authError = useAuthStore((state) => state.error);
  const authLoading = useAuthStore((state) => state.loading);
  const accessDecision = useAuthStore((state) => state.accessDecision);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const clearSession = useAuthStore((state) => state.clearSession);
  const setAuthSession = useAuthStore((state) => state.setSession);
  const setAuthError = useAuthStore((state) => state.setError);
  const setAuthLoading = useAuthStore((state) => state.setLoading);
  const setAccessDecision = useAuthStore((state) => state.setAccessDecision);
  const autoVerifiedStationUrls = useRef<Set<string>>(new Set());
  const stationUrlsKey = stationRegistry.entries.map((entry) => entry.url).join('\n');
  const activeStation = activeStationEntry(stationRegistry);

  useEffect(() => {
    let mounted = true;
    purgeLegacyMobileIdentityStorage();

    Promise.all([
      loadStationRegistry().catch(() => emptyStationRegistry()),
      restoreSession().catch(() => {
        if (mounted) setAuthSession(null);
        return null;
      }),
    ])
      .then(([registry, session]) => {
        if (!mounted) return;
        replaceStationRegistry(registry);
        const selectedStation = activeStationEntry(registry);
        if (session && selectedStation?.stationPeerId === session.stationPeerId) {
          void startAccessGateChainFor(selectedStation, session);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!authSession || !activeStation || authSession.stationPeerId === activeStation.stationPeerId) return;

    clearSession().catch(() => setAuthSession(null));
  }, [activeStation, authSession, clearSession, setAuthSession]);

  useEffect(() => {
    if (!authSession || !activeStation || authSession.stationPeerId !== activeStation.stationPeerId) return;
    if (launchState !== 'station-selection') return;
    void startAccessGateChain(authSession);
  }, [activeStation, authSession, launchState]);

  useEffect(() => {
    if (launchState !== 'station-selection') return;

    const stationUrls = stationUrlsKey ? stationUrlsKey.split('\n') : [];
    for (const url of stationUrls) {
      autoProbeStation(url);
    }
  }, [launchState, stationUrlsKey]);

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
      if (isAccessGranted(decision)) setLaunchState('shell');
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      setAuthError(t(msg) !== msg ? t(msg) : (msg || t('mobile.auth.loginFailed')));
    } finally {
      setAuthLoading(false);
    }
  }

  async function logout() {
    await clearSession();
    setAccessDecision(null);
    const selectedStation = activeStationEntry(stationRegistryRef.current);
    if (!selectedStation) {
      setLaunchState('station-selection');
      return;
    }
    await startAccessGateChainFor(selectedStation, null);
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
      if (isAccessGranted(decision)) setLaunchState('shell');
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
    setAuthLoading(true);
    setAuthError(null);
    try {
      const verified = await verifyStationIdentity(station.url);
      requireMatchingStationIdentity(station, verified.stationPeerId);
      const decision = await startStationAccessAttempt(
        station.stationPeerId,
        station.url,
        session?.sessionId,
      );
      setAccessDecision(decision);
      if (isAccessGranted(decision)) {
        setLaunchState('shell');
        return;
      }
      setLaunchState('access-gate-chain');
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (session && isRevokedSessionError(msg)) {
        await clearSession();
        setAuthSession(null);
        setAccessDecision(null);
        try {
          const decision = await startStationAccessAttempt(station.stationPeerId, station.url);
          setAccessDecision(decision);
          setLaunchState(isAccessGranted(decision) ? 'shell' : 'access-gate-chain');
          return;
        } catch (retryError) {
          const retryMsg = retryError instanceof Error ? retryError.message : '';
          setStationError(t(retryMsg) !== retryMsg ? t(retryMsg) : (retryMsg || t('mobile.launch.stationUnavailable')));
          setLaunchState('station-selection');
          return;
        }
      }
      setStationError(t(msg) !== msg ? t(msg) : (msg || t('mobile.launch.stationUnavailable')));
      setLaunchState('station-selection');
    } finally {
      setAuthLoading(false);
    }
  }

  if (launchState === 'shell') {
    return (
      <MobileShell
        stationRegistry={stationRegistry}
        onChangeStation={() => setLaunchState('station-selection')}
        onLogout={logout}
      />
    );
  }

  if (launchState === 'access-gate-chain') {
    return (
      <AccessGateHost
        decision={accessDecision}
        stationLabel={activeStation?.label || t('mobile.launch.station')}
        stationUrl={activeStation?.url || ''}
        error={authError}
        loading={authLoading}
        rememberedAccounts={rememberedAccounts}
        onBack={() => {
          setAccessDecision(null);
          setLaunchState('station-selection');
        }}
        onLogin={login}
        onInviteCode={submitInviteCode}
      />
    );
  }

  return (
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
          );
          if (!next.ok) {
            setStationError(t(next.error));
            return false;
          }
          autoVerifiedStationUrls.current.add(normalizedUrl);
          setStationError(null);
          await commitStationRegistry(next.registry);
          return true;
        } catch (error) {
          const msg = error instanceof Error ? error.message : '';
          setStationError(t(msg) !== msg ? t(msg) : (msg || t('mobile.launch.stationUnavailable')));
          return false;
        } finally {
          setStationChecking(false);
        }
      }}
      onSelectStation={(stationPeerId) => {
        setStationError(null);
        const next = activateStationEntry(stationRegistryRef.current, stationPeerId);
        void commitStationRegistry(next);
      }}
      onRemoveStation={(stationPeerId) => {
        setStationError(null);
        const next = removeStationEntry(stationRegistryRef.current, stationPeerId);
        if (next !== stationRegistryRef.current) void commitStationRegistry(next);
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
          requireMatchingStationIdentity(selectedStation, identity.stationPeerId);
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
    />
  );
}

export function App() {
  return (
    <AppProviders>
      <MobileAppRoot />
    </AppProviders>
  );
}

function isRevokedSessionError(message: string): boolean {
  return /session\s+(invalid|revoked|expired)|invalid\s+session|revoked/i.test(message);
}
