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
import { probeStation } from './features/station/stationConnection';
import { StationLaunchScreen } from './features/station/StationLaunchScreen';
import {
  activateStationEntry,
  addStationEntry,
  buildStationUrl,
  emptyStationRegistry,
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

  useEffect(() => {
    let mounted = true;

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
        if (session?.actor?.email) {
          void rememberLoginAccount(session, session.actor.email)
            .then(() => loadRememberedLoginAccounts(session.stationUrl))
            .then((accounts) => {
              if (mounted) setRememberedAccounts(accounts);
            })
            .catch(() => undefined);
        }
        if (session && registry.activeUrl === session.stationUrl) {
          void startAccessGateChainFor(registry.activeUrl, session);
        }
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
    if (!authSession || !stationRegistry.activeUrl || authSession.stationUrl !== stationRegistry.activeUrl) return;
    if (launchState !== 'station-selection') return;
    void startAccessGateChain(authSession);
  }, [authSession, launchState, stationRegistry.activeUrl]);

  useEffect(() => {
    if (launchState !== 'station-selection') return;

    const stationUrls = stationUrlsKey ? stationUrlsKey.split('\n') : [];
    for (const url of stationUrls) {
      autoProbeStation(url);
    }
  }, [launchState, stationUrlsKey]);

  useEffect(() => {
    const activeUrl = stationRegistry.activeUrl;
    if (!activeUrl) {
      setRememberedAccounts([]);
      return;
    }

    let mounted = true;
    loadRememberedLoginAccounts(activeUrl)
      .then((accounts) => {
        if (mounted) setRememberedAccounts(accounts);
      })
      .catch(() => {
        if (mounted) setRememberedAccounts([]);
      });
    return () => {
      mounted = false;
    };
  }, [stationRegistry.activeUrl]);

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
          const next = updateStationEntryStatus(current, url, {
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
      await rememberLoginAccount(session, input.email).catch(() => undefined);
      setRememberedAccounts(await loadRememberedLoginAccounts(session.stationUrl).catch(() => []));
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
    const activeUrl = stationRegistryRef.current.activeUrl;
    if (!activeUrl) {
      setLaunchState('station-selection');
      return;
    }
    await startAccessGateChainFor(activeUrl, null);
  }

  async function submitInviteCode(code: string) {
    if (!stationRegistry.activeUrl) {
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
        stationUrl: stationRegistry.activeUrl,
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
    await startAccessGateChainFor(stationRegistryRef.current.activeUrl, session);
  }

  async function startAccessGateChainFor(stationUrl: string, session?: MobileAuthSession | null) {
    if (!stationUrl) return;

    setAuthLoading(true);
    setAuthError(null);
    try {
      const decision = await startStationAccessAttempt(stationUrl, session?.sessionId);
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
          const decision = await startStationAccessAttempt(stationUrl);
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
    const activeStation = stationRegistry.entries.find((entry) => entry.url === stationRegistry.activeUrl);
    return (
      <AccessGateHost
        decision={accessDecision}
        stationLabel={activeStation?.label || stationRegistry.activeUrl || 'Station'}
        stationUrl={stationRegistry.activeUrl || ''}
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

          const next = addStationEntry(
            stationRegistryRef.current,
            { protocol, address },
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
      onSelectStation={(url) => {
        setStationError(null);
        const next = activateStationEntry(stationRegistryRef.current, url);
        void commitStationRegistry(next);
      }}
      onRemoveStation={(url) => {
        setStationError(null);
        const next = removeStationEntry(stationRegistryRef.current, url);
        if (next !== stationRegistryRef.current) void commitStationRegistry(next);
      }}
      onContinue={async () => {
        const activeUrl = stationRegistryRef.current.activeUrl;
        if (!activeUrl || stationChecking) return;

        setStationChecking(true);
        setStationError(null);
        try {
          const probe = await probeStation(activeUrl);
          if (!probe.online) {
            setStationError(probe.error ?? t('mobile.launch.stationUnavailable'));
            return;
          }
          const next = activateStationEntry(stationRegistryRef.current, activeUrl, {
            checkedAt: probe.checkedAt,
            label: probe.label,
            online: probe.online,
          });
          await commitStationRegistry(next);
          await startAccessGateChainFor(next.activeUrl, authSession?.stationUrl === next.activeUrl ? authSession : null);
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
