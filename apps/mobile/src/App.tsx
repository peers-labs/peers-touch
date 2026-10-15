import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Modal, Typography } from 'antd';

import { AppProviders } from './app/AppProviders';
import { useLifecycleKernel } from './app/lifecycle';
import { useMobileI18n } from './app/mobileI18n';
import { MobileShell } from './components/MobileShell';
import { NativePinHost } from './components/NativePinHost';
import { RecoveryOverlayHost, ScopeExitDraftDecisionOverlay } from './components/recovery';
import { AccessGateHost, authStationLabel } from './features/auth/AccessGateHost';
import { useAuthStore } from './features/auth/authStore';
import type { AccessDecision } from './features/auth/authSession';
import {
  setEntrySurfaceFixture,
  useEntrySurfaceFixture,
  type EntrySurfaceFixtureId,
} from './acceptance/entrySurfaceFixture';
import { setRecoverySurfaceFixture, useRecoverySurfaceFixture } from './acceptance/recoverySurfaceFixture';
import { EntryProgressScreen } from './features/station/EntryProgressScreen';
import { StationLaunchScreen } from './features/station/StationLaunchScreen';
import { activeStationEntry, emptyStationRegistry, type StoredStationRegistry } from './features/station/stationRegistry';
import type { AuthRuntimeSnapshot } from './runtimes/authRuntime';
import { mobileEntryActions, useMobileEntryProjection } from './runtimes/entryRuntime';
import { useStationRegistryProjection } from './runtimes/stationRuntime';

const { Text, Title } = Typography;

function MobileApplicationSurface({
  blocked,
  children,
}: {
  readonly blocked: boolean;
  readonly children: ReactNode;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (surfaceRef.current) {
      surfaceRef.current.inert = blocked;
    }
  }, [blocked]);

  return (
    <div
      ref={surfaceRef}
      className="mobile-application-surface"
      data-mobile-application-surface
      data-application-blocked={blocked ? 'true' : 'false'}
      aria-hidden={blocked ? true : undefined}
    >
      {children}
    </div>
  );
}

/** Root rendering is passive; Lifecycle and Entry Runtime own all transitions. */
function MobileAppRoot() {
  const { t } = useMobileI18n();
  const lifecycle = useLifecycleKernel();
  const stationRegistry = useStationRegistryProjection();
  const entry = useMobileEntryProjection();
  const authError = useAuthStore((state) => state.error);
  const authLoading = useAuthStore((state) => state.loading);
  const accessDecision = useAuthStore((state) => state.accessDecision);
  const entryFixture = useEntrySurfaceFixture();
  const recoveryFixture = useRecoverySurfaceFixture();
  const [recoveryBlocking, setRecoveryBlocking] = useState(false);
  const activeStation = activeStationEntry(stationRegistry);
  const renderedLaunchState = fixtureLaunchState(entryFixture.surfaceId) ?? lifecycle.launchState;
  const renderedStationRegistry = fixtureStationRegistry(entryFixture.surfaceId, stationRegistry);
  const renderedAccessDecision = fixtureAccessDecision(entryFixture.surfaceId, t) ?? accessDecision;
  const translateError = (value: string | null) => value ? t(value) : null;
  const renderedStationError = fixtureStationError(entryFixture.surfaceId, t)
    ?? translateError(entry.stationError);
  const renderedAuthError = entryFixture.surfaceId === 'entry.login-failed'
    ? t('mobile.auth.loginFailed') : translateError(authError);
  const renderedOAuth = fixtureOAuthProjection(entryFixture.surfaceId);
  const friendlyStationLabel = authStationLabel(
    activeStation?.label ?? '', activeStation?.url ?? '', t('common.stationPicker.fallbackLabel'),
  );
  const resolveStationIdentityReplacement = (replace: boolean) => {
    if (entry.pendingIdentityReplacement) {
      mobileEntryActions.resolveStationIdentityReplacement(replace);
    } else if (entryFixture.surfaceId === 'entry.station-identity-mismatch') {
      setEntrySurfaceFixture('entry.station-selection');
    }
  };

  function renderWithRecovery(content: ReactNode) {
    const replacementStation = entry.pendingIdentityReplacement
      ?? (entryFixture.surfaceId === 'entry.station-identity-mismatch' ? activeStation : null);
    const replacementStationLabel = replacementStation
      ? authStationLabel(replacementStation.label, replacementStation.url, t('common.stationPicker.fallbackLabel'))
      : t('common.stationPicker.fallbackLabel');
    const scopeExitVisible = entry.pendingScopeExit !== null
      || recoveryFixture.surfaceId === 'recovery.scope-exit';
    const applicationBlocked = recoveryBlocking
      || scopeExitVisible
      || replacementStation !== null;
    return (
      <>
        <MobileApplicationSurface blocked={applicationBlocked}>
          {content}
        </MobileApplicationSurface>
        <RecoveryOverlayHost
          onReAuthenticate={mobileEntryActions.reAuthenticateSessionMismatch}
          onSwitchStation={mobileEntryActions.leaveCurrentStationForSelection}
          onRetryDeviceLocal={mobileEntryActions.retryDeviceLocalRecovery}
          onBlockingChange={setRecoveryBlocking}
        />
        {entry.pendingScopeExit && (
          <ScopeExitDraftDecisionOverlay
            {...entry.pendingScopeExit}
            t={t}
            onDecision={entry.pendingScopeExit.run}
            onCancel={entry.pendingScopeExit.cancel}
          />
        )}
        {!entry.pendingScopeExit && recoveryFixture.surfaceId === 'recovery.scope-exit' && (
          <ScopeExitDraftDecisionOverlay
            key={recoveryFixture.revision}
            reason="logout"
            draftCount={2}
            committedDisposition={null}
            t={t}
            onDecision={async () => { setRecoverySurfaceFixture(null); }}
            onCancel={async () => { setRecoverySurfaceFixture(null); }}
            canCancel
          />
        )}
        <Modal open={replacementStation !== null} footer={null} closable={false} destroyOnHidden>
          <section className="entry-confirmation entry-trust-confirmation" data-product-surface="entry.station-identity-mismatch">
            <Title level={1}>{t('mobile.launch.stationReplaceConfirmTitle')}</Title>
            <Text type="secondary">{t('mobile.launch.stationReplaceConfirmBody', { station: replacementStationLabel })}</Text>
            <div className="entry-confirmation-actions">
              <button type="button" className="entry-confirmation-button" onClick={() => resolveStationIdentityReplacement(false)}>
                {t('common.action.cancel')}
              </button>
              <button type="button" className="entry-confirmation-button danger" onClick={() => resolveStationIdentityReplacement(true)}>
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
        onChangeStation={mobileEntryActions.leaveCurrentStationForSelection}
        onLogout={mobileEntryActions.logout}
      />,
    );
  }
  if (renderedLaunchState === 'app-boot') {
    return renderWithRecovery(<EntryProgressScreen kind="boot" onRetry={mobileEntryActions.retryRuntime} />);
  }
  if (renderedLaunchState === 'station-handshake') {
    return renderWithRecovery(
      <EntryProgressScreen
        kind="station-handshake"
        stationLabel={friendlyStationLabel}
        onBack={mobileEntryActions.showStationSelection}
      />,
    );
  }
  if (renderedLaunchState === 'runtime-critical') {
    const runtimeFailed = entryFixture.surfaceId === 'entry.runtime-critical'
      || Array.from(lifecycle.runtimes.values()).some((runtime) => (
        runtime.status === 'failed' || runtime.readiness?.status === 'failed'
      ));
    return renderWithRecovery(
      <EntryProgressScreen
        kind="runtime"
        stationLabel={friendlyStationLabel}
        failed={runtimeFailed}
        onBack={mobileEntryActions.leaveCurrentStationForSelection}
        onRetry={mobileEntryActions.retryRuntime}
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
        rememberedAccounts={entry.rememberedAccounts}
        oauthOverride={renderedOAuth ?? undefined}
        forceSessionExpired={entryFixture.surfaceId === 'entry.session-expired'}
        onBack={mobileEntryActions.cancelAccessGateAttemptAndChangeStation}
        onRefresh={mobileEntryActions.refreshAccessGateDecision}
        onLogin={mobileEntryActions.login}
        onInviteCode={mobileEntryActions.submitInviteCode}
        onSchemaSubmit={mobileEntryActions.submitSchemaGate}
      />,
    );
  }
  return renderWithRecovery(
    <StationLaunchScreen
      key={`station-launch-${entryFixture.revision}`}
      registry={renderedStationRegistry}
      error={renderedStationError}
      checking={entry.stationChecking}
      verifyingUrls={entryFixture.surfaceId === 'entry.station-verifying'
        ? renderedStationRegistry.entries.map((station) => station.url) : [...entry.verifyingStationUrls]}
      checkedUrls={entryFixture.surfaceId === 'entry.station-unavailable'
        ? renderedStationRegistry.entries.map((station) => station.url) : [...entry.checkedStationUrls]}
      surfaceFixture={fixtureStationSelectorSurface(entryFixture.surfaceId)}
      onAddStation={mobileEntryActions.addStation}
      onSelectStation={mobileEntryActions.selectStation}
      onRemoveStation={mobileEntryActions.removeStation}
      onContinue={mobileEntryActions.continueStation}
    />,
  );
}

function fixtureLaunchState(surfaceId: EntrySurfaceFixtureId | null) {
  if (!surfaceId) return null;
  if (surfaceId === 'entry.app-boot') return 'app-boot' as const;
  if (surfaceId === 'entry.station-handshake') return 'station-handshake' as const;
  if (surfaceId.startsWith('entry.station-')) return 'station-selection' as const;
  if (
    surfaceId.startsWith('entry.access-') || surfaceId === 'entry.login-failed'
    || surfaceId === 'entry.session-expired' || surfaceId.startsWith('entry.oauth-')
  ) return 'access-gate-chain' as const;
  if (surfaceId.startsWith('entry.runtime-')) return 'runtime-critical' as const;
  return null;
}

function fixtureStationRegistry(
  surfaceId: EntrySurfaceFixtureId | null,
  registry: StoredStationRegistry,
): StoredStationRegistry {
  if (surfaceId === 'entry.station-empty' || surfaceId === 'entry.station-address' || surfaceId === 'entry.station-address-invalid') {
    return emptyStationRegistry();
  }
  if (surfaceId === 'entry.station-selection') return { ...registry, activeStationPeerId: '' };
  if (surfaceId === 'entry.station-unavailable') {
    return { ...registry, entries: registry.entries.map((entry) => ({ ...entry, online: false })) };
  }
  if (surfaceId === 'entry.station-verifying') {
    return { ...registry, entries: registry.entries.map((entry) => ({ ...entry, online: undefined })) };
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

function fixtureStationError(surfaceId: EntrySurfaceFixtureId | null, t: (key: string) => string) {
  if (surfaceId === 'entry.station-address-invalid') return t('mobile.launch.validAddressHint');
  if (surfaceId === 'entry.station-unavailable') return t('mobile.launch.stationUnavailable');
  return null;
}

function fixtureAccessDecision(
  surfaceId: EntrySurfaceFixtureId | null,
  t: (key: string) => string,
): AccessDecision | null {
  if (surfaceId === 'entry.access-pending' || surfaceId === 'entry.access-failed') {
    return {
      state: surfaceId === 'entry.access-pending' ? 'ACCESS_DECISION_STATE_PENDING' : 'ACCESS_DECISION_STATE_FAILED',
      attemptId: 'entry-fixture-attempt', gates: [],
    };
  }
  if (![
    'entry.access-login', 'entry.login-failed', 'entry.session-expired', 'entry.access-oauth',
    'entry.oauth-progress', 'entry.oauth-failed', 'entry.access-schema', 'entry.access-unavailable',
  ].includes(surfaceId ?? '')) return null;
  if (surfaceId === 'entry.access-schema') {
    return {
      state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED', attemptId: 'entry-fixture-attempt', currentGateId: 'terms.acceptance',
      gates: [{
        gateId: 'terms.acceptance', type: 'ACCESS_GATE_TYPE_TERMS_ACCEPTANCE', state: 'ACCESS_GATE_STATE_ACTION_REQUIRED',
        title: t('mobile.auth.termsTitle'), description: t('mobile.auth.termsSubtitle'), actionId: 'terms.acceptance',
        submitAction: 'submit_schema',
        inputSchemaJson: JSON.stringify({ fields: [{
          name: 'accepted', type: 'checkbox', label: t('mobile.auth.termsAccept'), required: true,
        }] }),
        alternativeActions: [], schemaRevision: 1, schemaDigest: 'a'.repeat(64),
      }],
    };
  }
  if (surfaceId === 'entry.access-unavailable') {
    return {
      state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED', attemptId: 'entry-fixture-attempt', currentGateId: 'device.trust',
      gates: [{
        gateId: 'device.trust', type: 'ACCESS_GATE_TYPE_DEVICE_TRUST', state: 'ACCESS_GATE_STATE_ACTION_REQUIRED',
        title: t('mobile.auth.deviceApprovalTitle'), description: t('mobile.auth.deviceApprovalSubtitle'),
        actionId: 'device.trust', submitAction: 'approve_device', alternativeActions: [],
        schemaRevision: 1, schemaDigest: 'a'.repeat(64),
      }],
    };
  }
  const oauthOnly = ['entry.access-oauth', 'entry.oauth-progress', 'entry.oauth-failed'].includes(surfaceId ?? '');
  return {
    state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED', attemptId: 'entry-fixture-attempt', currentGateId: 'auth.login',
    gates: [{
      gateId: 'auth.login', type: 'ACCESS_GATE_TYPE_AUTH_LOGIN', state: 'ACCESS_GATE_STATE_ACTION_REQUIRED',
      title: t('mobile.auth.signInTitle'), description: t('mobile.auth.subtitle'),
      actionId: oauthOnly ? 'auth.oauth' : 'auth.password', submitAction: oauthOnly ? 'start_oauth' : 'submit_login',
      alternativeActions: [{
        actionId: oauthOnly ? 'auth.oauth' : 'auth.password',
        type: oauthOnly ? 'ACCESS_GATE_TYPE_AUTH_OAUTH' : 'ACCESS_GATE_TYPE_AUTH_LOGIN',
        submitAction: oauthOnly ? 'start_oauth' : 'submit_login', schemaRevision: 1, schemaDigest: 'a'.repeat(64),
      }],
      schemaRevision: 1, schemaDigest: 'a'.repeat(64),
    }],
  };
}

function fixtureOAuthProjection(surfaceId: EntrySurfaceFixtureId | null): Partial<AuthRuntimeSnapshot> | null {
  if (surfaceId === 'entry.oauth-progress') {
    return { phase: 'awaiting_provider', provider: 'github', errorKey: null, recovery: 'none' };
  }
  if (surfaceId === 'entry.oauth-failed') {
    return { phase: 'failed', provider: 'github', errorKey: 'mobile.auth.oauthExpired', recovery: 'restart' };
  }
  return null;
}

export function App() {
  return <AppProviders><NativePinHost><MobileAppRoot /></NativePinHost></AppProviders>;
}
