import { useEffect, useRef, useState } from 'react';

import { AppProviders } from './app/AppProviders';
import { useMobileI18n } from './app/mobileI18n';
import { MobileShell } from './components/MobileShell';
import {
  startStationAccessAttempt,
  submitStationLoginGate,
  isAccessGranted,
  type MobileAuthSession,
  type StationLoginInput,
} from './features/auth/authSession';
import { AccessGateHost } from './features/auth/AccessGateHost';
import { useAuthStore } from './features/auth/authStore';
import { probeStation } from './features/station/stationConnection';
import { StationLaunchScreen } from './features/station/StationLaunchScreen';
import {
  activateStationEntry,
  addStationEntry,
  buildStationUrl,
  loadStationRegistry,
  persistStationRegistry,
  removeStationEntry,
  updateStationEntryStatus,
  type StationProtocol,
  type StoredStationRegistry,
} from './features/station/stationRegistry';

type LaunchState = 'station-selection' | 'access-gate-chain' | 'shell';

function MobileAppRoot() {
  const { t } = useMobileI18n();
  const [launchState, setLaunchState] = useState<LaunchState>('station-selection');
  const [stationRegistry, setStationRegistry] = useState<StoredStationRegistry>(() => loadStationRegistry());
  const [stationError, setStationError] = useState<string | null>(null);
  const [stationChecking, setStationChecking] = useState(false);
  const [verifyingStationUrls, setVerifyingStationUrls] = useState<string[]>([]);
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

  useEffect(() => {
    let mounted = true;

    restoreSession()
      .then((session) => {
        if (!mounted) return;
        if (session && stationRegistry.activeUrl === session.stationUrl) {
          startAccessGateChain(session);
        }
      })
      .catch(() => {
        if (mounted) setAuthSession(null);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!authSession || !stationRegistry.activeUrl || authSession.stationUrl === stationRegistry.activeUrl) return;

    clearSession().catch(() => setAuthSession(null));
  }, [authSession, clearSession, setAuthSession, stationRegistry.activeUrl]);

  useEffect(() => {
    if (launchState !== 'station-selection') return;

    for (const entry of stationRegistry.entries) {
      if (autoVerifiedStationUrls.current.has(entry.url)) continue;
      autoVerifiedStationUrls.current.add(entry.url);
      setVerifyingStationUrls((urls) => (urls.includes(entry.url) ? urls : [...urls, entry.url]));

      probeStation(entry.url)
        .then((probe) => {
          setStationRegistry((current) => {
            const next = updateStationEntryStatus(current, entry.url, {
              checkedAt: probe.checkedAt,
              label: probe.label,
              online: probe.online,
            });
            persistStationRegistry(next);
            return next;
          });
        })
        .finally(() => {
          setVerifyingStationUrls((urls) => urls.filter((url) => url !== entry.url));
        });
    }
  }, [launchState, stationRegistry.entries]);

  async function login(input: Omit<StationLoginInput, 'stationUrl'>) {
    if (!stationRegistry.activeUrl) {
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

      const { session, decision, persistenceError } = await submitStationLoginGate({
        stationUrl: stationRegistry.activeUrl,
        attemptId: accessDecision.attemptId,
        ...input,
      });
      setAuthSession(session);
      setAccessDecision(decision);
      if (persistenceError) setAuthError(persistenceError);
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
    setLaunchState('access-gate-chain');
  }

  async function startAccessGateChain(session?: MobileAuthSession | null) {
    if (!stationRegistry.activeUrl) return;

    setAuthLoading(true);
    setAuthError(null);
    try {
      const decision = await startStationAccessAttempt(stationRegistry.activeUrl, session?.sessionId);
      setAccessDecision(decision);
      if (isAccessGranted(decision)) {
        setLaunchState('shell');
        return;
      }
      setLaunchState('access-gate-chain');
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
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
    const activeStation = stationRegistry.entries.find((entry) => entry.url === stationRegistry.activeUrl);
    return (
      <AccessGateHost
        decision={accessDecision}
        stationLabel={activeStation?.label || stationRegistry.activeUrl || 'Station'}
        stationUrl={stationRegistry.activeUrl || ''}
        error={authError}
        loading={authLoading}
        onBack={() => {
          setAccessDecision(null);
          setLaunchState('station-selection');
        }}
        onLogin={login}
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
        const probe = await probeStation(normalizedUrl);
        if (!probe.online) {
          setStationChecking(false);
          setStationError(probe.error ?? t('mobile.launch.stationUnavailable'));
          return false;
        }

        const next = addStationEntry(
          stationRegistry,
          { protocol, address },
          { checkedAt: probe.checkedAt, label: probe.label, online: probe.online },
        );
        if (!next.ok) {
          setStationChecking(false);
          setStationError(next.error);
          return false;
        }
        setStationError(null);
        setStationRegistry(next.registry);
        persistStationRegistry(next.registry);
        setStationChecking(false);
        return true;
      }}
      onSelectStation={(url) => {
        setStationError(null);
        const next = activateStationEntry(stationRegistry, url);
        setStationRegistry(next);
        persistStationRegistry(next);
      }}
      onRemoveStation={(url) => {
        const next = removeStationEntry(stationRegistry, url);
        setStationError(null);
        setStationRegistry(next);
        persistStationRegistry(next);
      }}
      onContinue={async () => {
        if (!stationRegistry.activeUrl || stationChecking) return;

        setStationChecking(true);
        setStationError(null);
        const probe = await probeStation(stationRegistry.activeUrl);
        if (!probe.online) {
          setStationChecking(false);
          setStationError(probe.error ?? t('mobile.launch.stationUnavailable'));
          return;
        }
        const next = activateStationEntry(stationRegistry, stationRegistry.activeUrl, {
          checkedAt: probe.checkedAt,
          label: probe.label,
          online: probe.online,
        });
        setStationRegistry(next);
        persistStationRegistry(next);
        setStationChecking(false);
        await startAccessGateChain(authSession?.stationUrl === stationRegistry.activeUrl ? authSession : null);
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
