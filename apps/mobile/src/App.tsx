import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Typography } from 'antd';

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
  type AccessDecision,
  type RememberedLoginAccount,
  type StationLoginInput,
} from './features/auth/authSession';
import { AccessGateHost, authStationLabel } from './features/auth/AccessGateHost';
import { useAuthStore } from './features/auth/authStore';
import {
  setEntrySurfaceFixture,
  useEntrySurfaceFixture,
  type EntrySurfaceFixtureId,
} from './acceptance/entrySurfaceFixture';
import {
  setRecoverySurfaceFixture,
  useRecoverySurfaceFixture,
} from './acceptance/recoverySurfaceFixture';
import { probeStation, verifyStationIdentity } from './features/station/stationConnection';
import { EntryProgressScreen } from './features/station/EntryProgressScreen';
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
  activeStationEntry,
  addStationEntry,
  buildStationUrl,
  emptyStationRegistry,
  removeStationEntry,
  replaceStationEntryIdentity,
  requireMatchingStationIdentity,
  stationEntryAtUrl,
  updateStationEntryStatus,
  type StationProtocol,
  type MobileStationEntry,
  type StoredStationRegistry,
} from './features/station/stationRegistry';
import type { AuthRuntimeSnapshot } from './runtimes/authRuntime';
import {
  readStationRegistryProjection,
  replaceStationRegistryProjection,
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

const { Text, Title } = Typography;

interface PendingScopeExitRequest {
  readonly reason: ScopeExitDecisionReason;
  readonly draftCount: number;
  readonly committedDisposition: DraftDisposition | null;
  readonly run: (disposition: DraftDisposition) => Promise<void>;
  readonly cancel: () => Promise<void>;
  readonly canCancel: boolean;
}

interface PendingStationIdentityReplacement {
  readonly station: MobileStationEntry;
  readonly resolve: (replace: boolean) => void;
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
  const [pendingIdentityReplacement, setPendingIdentityReplacement] =
    useState<PendingStationIdentityReplacement | null>(null);
  const entryFixture = useEntrySurfaceFixture();
  const recoveryFixture = useRecoverySurfaceFixture();
  const stationUrlsKey = stationRegistry.entries.map((entry) => entry.url).join('\n');
  const activeStation = activeStationEntry(stationRegistry);
  const renderedLaunchState = fixtureLaunchState(entryFixture.surfaceId) ?? launchState;
  const renderedStationRegistry = fixtureStationRegistry(
    entryFixture.surfaceId,
    stationRegistry,
  );
  const renderedAccessDecision = fixtureAccessDecision(entryFixture.surfaceId, t)
    ?? accessDecision;
  const renderedStationError = fixtureStationError(entryFixture.surfaceId, t)
    ?? stationError;
  const renderedAuthError = entryFixture.surfaceId === 'entry.login-failed'
    ? t('mobile.auth.loginFailed')
    : authError;
  const renderedOAuth = fixtureOAuthProjection(entryFixture.surfaceId);
  const friendlyStationLabel = authStationLabel(
    activeStation?.label ?? '',
    activeStation?.url ?? '',
    t('common.stationPicker.fallbackLabel'),
  );

  // The lifecycle-owned auth descriptor restores and revalidates credentials.
  // React only loads the device-local Station projection for rendering.
  useEffect(() => {
    if (lifecycle.phase !== 'ACTIVE') return;


  }, [lifecycle.generation, lifecycle.phase]);


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
      setPendingIdentityReplacement({
        station,
        resolve,
      });
    });
  }

  function resolveStationIdentityReplacement(replace: boolean) {
    if (pendingIdentityReplacement) {
      pendingIdentityReplacement.resolve(replace);
      setPendingIdentityReplacement(null);
      return;
    }
    if (entryFixture.surfaceId === 'entry.station-identity-mismatch') {
      setEntrySurfaceFixture('entry.station-selection');
    }
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

  function autoProbeStation(url: string) {
    if (autoVerifiedStationUrls.current.has(url)) return;
    autoVerifiedStationUrls.current.add(url);
    setVerifyingStationUrls((urls) => (urls.includes(url) ? urls : [...urls, url]));

    probeStation(url)
      .then(async (probe) => {
        await updateStationRegistryProjection((current) => {
          const entry = current.entries.find((candidate) => candidate.url === url);
          if (!entry) return current;
          const next = updateStationEntryStatus(current, entry.stationPeerId, {
            checkedAt: probe.checkedAt,
            label: probe.label,
            online: probe.online,
          });
          if (next === current) return current;
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
    const selectedStation = activeStationEntry(
      await readStationRegistryProjection(),
    );
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
      const verified = await verifyStationIdentity(station.url);
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
    const replacementStation = pendingIdentityReplacement?.station
      ?? (
        entryFixture.surfaceId === 'entry.station-identity-mismatch'
          ? activeStation
          : null
      );
    const replacementStationLabel = replacementStation
      ? authStationLabel(
          replacementStation.label,
          replacementStation.url,
          t('common.stationPicker.fallbackLabel'),
        )
      : t('common.stationPicker.fallbackLabel');
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
        {!pendingScopeExit
          && recoveryFixture.surfaceId === 'recovery.scope-exit'
          && (
            <ScopeExitDraftDecisionOverlay
              key={recoveryFixture.revision}
              reason="logout"
              draftCount={2}
              committedDisposition={null}
              t={t}
              onDecision={async () => {
                setRecoverySurfaceFixture(null);
              }}
              onCancel={async () => {
                setRecoverySurfaceFixture(null);
              }}
              canCancel
            />
          )}
        <Modal
          open={replacementStation !== null}
          footer={null}
          closable={false}
          onCancel={() => resolveStationIdentityReplacement(false)}
          destroyOnClose
        >
          <section
            className="entry-confirmation entry-trust-confirmation"
            data-product-surface="entry.station-identity-mismatch"
          >
            <Title level={1}>
              {t('mobile.launch.stationReplaceConfirmTitle')}
            </Title>
            <Text type="secondary">
              {t('mobile.launch.stationReplaceConfirmBody', {
                station: replacementStationLabel,
              })}
            </Text>
            <div className="entry-confirmation-actions">
              <button
                type="button"
                className="entry-confirmation-button"
                onClick={() => resolveStationIdentityReplacement(false)}
              >
                {t('common.action.cancel')}
              </button>
              <button
                type="button"
                className="entry-confirmation-button danger"
                onClick={() => resolveStationIdentityReplacement(true)}
              >
                {t('mobile.launch.stationReplace')}
              </button>
            </div>
          </section>
        </Modal>
      </>
    );
  }

  if (
    renderedLaunchState === 'shell'
    || renderedLaunchState === 'background'
    || renderedLaunchState === 'resume'
  ) {
    return renderWithRecovery(
      <MobileShell
        stationRegistry={stationRegistry}
        onChangeStation={leaveCurrentStationForSelection}
        onLogout={logout}
      />,
    );
  }

  if (renderedLaunchState === 'app-boot') {
    return renderWithRecovery(
      <EntryProgressScreen
        kind="boot"
        onRetry={async () => {
          await getMobileLifecycleKernel().restartRuntimeGraph('reliability-recovery');
        }}
      />,
    );
  }

  if (renderedLaunchState === 'station-handshake') {
    return renderWithRecovery(
      <EntryProgressScreen
        kind="station-handshake"
        stationLabel={friendlyStationLabel}
        onBack={showStationSelection}
      />,
    );
  }

  if (renderedLaunchState === 'runtime-critical') {
    const runtimeFailed = entryFixture.surfaceId === 'entry.runtime-critical'
      || Array.from(lifecycle.runtimes.values()).some(
        (runtime) => runtime.status === 'failed' || runtime.readiness?.status === 'failed',
      );
    return renderWithRecovery(
      <EntryProgressScreen
        kind="runtime"
        stationLabel={friendlyStationLabel}
        failed={runtimeFailed}
        onBack={leaveCurrentStationForSelection}
        onRetry={async () => {
          await getMobileLifecycleKernel().restartRuntimeGraph('reliability-recovery');
        }}
      />,
    );
  }

  if (renderedLaunchState === 'access-gate-chain') {
    return renderWithRecovery(
      <AccessGateHost
        decision={renderedAccessDecision}
        stationLabel={activeStation?.label || t('mobile.launch.station')}
        stationUrl={activeStation?.url || ''}
        error={renderedAuthError}
        loading={authLoading}
        rememberedAccounts={rememberedAccounts}
        oauthOverride={renderedOAuth ?? undefined}
        forceSessionExpired={entryFixture.surfaceId === 'entry.session-expired'}
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
      key={`station-launch-${entryFixture.revision}`}
      registry={renderedStationRegistry}
      error={renderedStationError}
      checking={stationChecking}
      verifyingUrls={
        entryFixture.surfaceId === 'entry.station-verifying'
          ? renderedStationRegistry.entries.map((entry) => entry.url)
          : verifyingStationUrls
      }
      surfaceFixture={fixtureStationSelectorSurface(entryFixture.surfaceId)}
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
          const current = await readStationRegistryProjection();
          const next = addStationEntry(
            current,
            { stationPeerId: identity.stationPeerId, url: normalizedUrl },
            { checkedAt: probe.checkedAt, label: probe.label, online: probe.online },
            identity.identityVerified,
          );
          if (!next.ok) {
            const conflictingStation = stationEntryAtUrl(current, normalizedUrl);
            if (
              next.error === 'mobile.launch.stationIdentityMismatch'
              && conflictingStation
              && await confirmStationIdentityReplacement(conflictingStation)
            ) {
              const replacement = replaceStationEntryIdentity(
                current,
                conflictingStation.stationPeerId,
                {
                  stationPeerId: identity.stationPeerId,
                  url: normalizedUrl,
                },
                {
                  checkedAt: probe.checkedAt,
                  label: probe.label,
                  online: probe.online,
                },
              );
              if (!replacement.ok) {
                setStationError(t(replacement.error));
                return false;
              }
              autoVerifiedStationUrls.current.add(normalizedUrl);
              setStationError(null);
              await commitStationScope(replacement.registry);
              return true;
            }
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
        const current = await readStationRegistryProjection();
        const next = activateStationEntry(current, stationPeerId);
        await commitStationScope(next);
      }}
      onRemoveStation={async (stationPeerId) => {
        setStationError(null);
        const current = await readStationRegistryProjection();
        const next = removeStationEntry(current, stationPeerId);
        if (next !== current) await commitStationScope(next);
      }}
      onContinue={async () => {
        const current = await readStationRegistryProjection();
        const selectedStation = activeStationEntry(current);
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
                checkedAt: probe.checkedAt,
                label: probe.label,
                online: probe.online,
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
            checkedAt: probe.checkedAt,
            label: probe.label,
            online: probe.online,
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

function fixtureLaunchState(
  surfaceId: EntrySurfaceFixtureId | null,
) {
  if (!surfaceId) return null;
  if (surfaceId === 'entry.app-boot') return 'app-boot' as const;
  if (surfaceId === 'entry.station-handshake') return 'station-handshake' as const;
  if (surfaceId.startsWith('entry.station-')) return 'station-selection' as const;
  if (
    surfaceId.startsWith('entry.access-')
    || surfaceId === 'entry.login-failed'
    || surfaceId === 'entry.session-expired'
    || surfaceId.startsWith('entry.oauth-')
  ) {
    return 'access-gate-chain' as const;
  }
  if (surfaceId.startsWith('entry.runtime-')) return 'runtime-critical' as const;
  return null;
}

function fixtureStationRegistry(
  surfaceId: EntrySurfaceFixtureId | null,
  registry: StoredStationRegistry,
): StoredStationRegistry {
  if (
    surfaceId === 'entry.station-empty'
    || surfaceId === 'entry.station-address'
    || surfaceId === 'entry.station-address-invalid'
  ) {
    return emptyStationRegistry();
  }
  if (surfaceId === 'entry.station-selection') {
    return { ...registry, activeStationPeerId: '' };
  }
  if (surfaceId === 'entry.station-unavailable') {
    return {
      ...registry,
      entries: registry.entries.map((entry) => ({ ...entry, online: false })),
    };
  }
  if (surfaceId === 'entry.station-verifying') {
    return {
      ...registry,
      entries: registry.entries.map((entry) => ({ ...entry, online: undefined })),
    };
  }
  return registry;
}

function fixtureStationSelectorSurface(
  surfaceId: EntrySurfaceFixtureId | null,
): 'address' | 'address-invalid' | 'remove-confirm' | undefined {
  if (surfaceId === 'entry.station-address') return 'address';
  if (surfaceId === 'entry.station-address-invalid') return 'address-invalid';
  if (surfaceId === 'entry.station-remove-confirm') return 'remove-confirm';
  return undefined;
}

function fixtureStationError(
  surfaceId: EntrySurfaceFixtureId | null,
  t: (key: string) => string,
): string | null {
  if (surfaceId === 'entry.station-address-invalid') {
    return t('mobile.launch.validAddressHint');
  }
  if (surfaceId === 'entry.station-unavailable') {
    return t('mobile.launch.stationUnavailable');
  }
  return null;
}

function fixtureAccessDecision(
  surfaceId: EntrySurfaceFixtureId | null,
  t: (key: string) => string,
): AccessDecision | null {
  if (surfaceId === 'entry.access-pending') {
    return {
      state: 'ACCESS_DECISION_STATE_PENDING',
      attemptId: 'entry-fixture-attempt',
      gates: [],
    };
  }
  if (surfaceId === 'entry.access-failed') {
    return {
      state: 'ACCESS_DECISION_STATE_FAILED',
      attemptId: 'entry-fixture-attempt',
      gates: [],
    };
  }

  const actionRequired = [
    'entry.access-login',
    'entry.login-failed',
    'entry.session-expired',
    'entry.access-oauth',
    'entry.oauth-progress',
    'entry.oauth-failed',
    'entry.access-schema',
    'entry.access-unavailable',
  ].includes(surfaceId ?? '');
  if (!actionRequired) return null;

  if (surfaceId === 'entry.access-schema') {
    return {
      state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED',
      attemptId: 'entry-fixture-attempt',
      currentGateId: 'terms.acceptance',
      gates: [{
        gateId: 'terms.acceptance',
        type: 'ACCESS_GATE_TYPE_TERMS_ACCEPTANCE',
        state: 'ACCESS_GATE_STATE_ACTION_REQUIRED',
        title: t('mobile.auth.termsTitle'),
        description: t('mobile.auth.termsSubtitle'),
        actionId: 'terms.acceptance',
        submitAction: 'submit_schema',
        inputSchemaJson: JSON.stringify({
          fields: [{
            name: 'accepted',
            type: 'checkbox',
            label: t('mobile.auth.termsAccept'),
            required: true,
          }],
        }),
        alternativeActions: [],
        schemaRevision: 1,
        schemaDigest: 'a'.repeat(64),
      }],
    };
  }

  if (surfaceId === 'entry.access-unavailable') {
    return {
      state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED',
      attemptId: 'entry-fixture-attempt',
      currentGateId: 'device.trust',
      gates: [{
        gateId: 'device.trust',
        type: 'ACCESS_GATE_TYPE_DEVICE_TRUST',
        state: 'ACCESS_GATE_STATE_ACTION_REQUIRED',
        title: t('mobile.auth.deviceApprovalTitle'),
        description: t('mobile.auth.deviceApprovalSubtitle'),
        actionId: 'device.trust',
        submitAction: 'approve_device',
        alternativeActions: [],
        schemaRevision: 1,
        schemaDigest: 'a'.repeat(64),
      }],
    };
  }

  const oauthOnly = [
    'entry.access-oauth',
    'entry.oauth-progress',
    'entry.oauth-failed',
  ].includes(surfaceId ?? '');
  return {
    state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED',
    attemptId: 'entry-fixture-attempt',
    currentGateId: 'auth.login',
    gates: [{
      gateId: 'auth.login',
      type: 'ACCESS_GATE_TYPE_AUTH_LOGIN',
      state: 'ACCESS_GATE_STATE_ACTION_REQUIRED',
      title: t('mobile.auth.signInTitle'),
      description: t('mobile.auth.subtitle'),
      actionId: oauthOnly ? 'auth.oauth' : 'auth.password',
      submitAction: oauthOnly ? 'start_oauth' : 'submit_login',
      alternativeActions: [{
        actionId: oauthOnly ? 'auth.oauth' : 'auth.password',
        type: oauthOnly
          ? 'ACCESS_GATE_TYPE_AUTH_OAUTH'
          : 'ACCESS_GATE_TYPE_AUTH_LOGIN',
        submitAction: oauthOnly ? 'start_oauth' : 'submit_login',
        schemaRevision: 1,
        schemaDigest: 'a'.repeat(64),
      }],
      schemaRevision: 1,
      schemaDigest: 'a'.repeat(64),
    }],
  };
}

function fixtureOAuthProjection(
  surfaceId: EntrySurfaceFixtureId | null,
): Partial<AuthRuntimeSnapshot> | null {
  if (surfaceId === 'entry.oauth-progress') {
    return {
      phase: 'awaiting_provider',
      provider: 'github',
      errorKey: null,
      recovery: 'none',
    };
  }
  if (surfaceId === 'entry.oauth-failed') {
    return {
      phase: 'failed',
      provider: 'github',
      errorKey: 'mobile.auth.oauthExpired',
      recovery: 'restart',
    };
  }
  return null;
}

export function App() {
  return (
    <AppProviders>
      <MobileAppRoot />
    </AppProviders>
  );
}
