import { useRef } from 'react';
import { Button, Icon, Spin, Text } from '@peers-touch/ui';
import { useMobileI18n } from '../../app/mobileI18n';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { DeviceLinkState } from '../../gen/proto/domain/auth/device_link_pb';
import {
  cancelMobileDeviceLink,
  refreshMobileDeviceLink,
  retryMobileDeviceLink,
  submitMobileDeviceLink,
} from '../../runtimes/deviceLinkRuntime';
import { sanitizeAccessDecision } from '../../runtimes/accessRuntime';
import type { NativeAccessGateInput } from '../../services/mobileCommands';
import { secureRandomUuid } from '../../utils/randomIdentity';
import { AccessGateHost } from './AccessGateHost';
import { currentAccessGate, gateTypeNumber, isAccessGranted, schemaGateInput } from './authSession';
import { useDeviceLinkStore } from './deviceLinkStore';
import './deviceLink.css';

export function DeviceLinkScreen() {
  const { t } = useMobileI18n();
  const { phase, projection, busy, errorKey } = useDeviceLinkStore();
  const cameraOverlay = phase === 'scanning' || phase === 'cancelling';
  const needsNewComparison = errorKey === 'mobile.deviceLink.comparisonChanged';
  const pending = useRef<{ key: string; id: string } | null>(null);
  const decision = projection?.accessDecision
    ? sanitizeAccessDecision(projection.accessDecision) : null;
  const gate = currentAccessGate(decision);
  const context = projection ? (
    <section className="mobile-device-link-identity">
      <Icon iconId="shield-check" size={24} />
      <Text strong className="mobile-device-link-account">{projection.actorLabel}</Text>
      {projection.comparisonCode ? (
        <>
          <Text tone="secondary">{t('mobile.deviceLink.compare')}</Text>
          <output className="mobile-device-link-code" aria-label={t('mobile.deviceLink.code')}>
            {projection.comparisonCode}
          </output>
        </>
      ) : null}
    </section>
  ) : null;

  async function submit(input: NativeAccessGateInput) {
    if (!projection || !decision || !gate || busy) return;
    const key = `${decision.attemptId}:${gate.actionId}:${gate.schemaRevision}:${gate.schemaDigest}`;
    if (pending.current?.key !== key) {
      pending.current = { key, id: secureRandomUuid('mobile.auth.submissionIdentityUnavailable') };
    }
    await submitMobileDeviceLink({
      stationPeerId: projection.stationPeerId,
      stationOrigin: projection.stationOrigin,
      attemptId: decision.attemptId,
      gateId: gate.gateId,
      gateType: gateTypeNumber(gate.type),
      actionId: gate.actionId,
      schemaRevision: gate.schemaRevision,
      schemaDigest: gate.schemaDigest,
      submissionId: pending.current.id,
      input,
    });
  }

  if (projection?.state === DeviceLinkState.ACCESS_PENDING && decision && !isAccessGranted(decision)) {
    return <AccessGateHost
      decision={decision}
      stationLabel={t('mobile.launch.station')}
      stationUrl={projection.stationOrigin}
      error={errorKey}
      loading={busy}
      rememberedAccounts={[]}
      deviceLinkContext={context}
      onBack={cancelMobileDeviceLink}
      onRefresh={refreshMobileDeviceLink}
      onLogin={async ({ email, password }) => submit({ kind: 'login', email, password })}
      onInviteCode={async (inviteCode) => submit({ kind: 'invite_code', inviteCode })}
      onSchemaSubmit={async (values) => {
        if (gate) await submit(schemaGateInput(gate, values));
      }}
    />;
  }

  const progressKey = phase === 'scanning' ? 'mobile.deviceLink.scanning'
    : phase === 'cancelling' ? 'mobile.deviceLink.cancelling'
      : phase === 'committed' ? 'mobile.deviceLink.committed'
        : projection?.state === DeviceLinkState.CLAIMS_PENDING ? 'mobile.deviceLink.waiting'
          : 'mobile.deviceLink.connecting';
  return (
    <main
      className={`auth-gate-screen${cameraOverlay ? ' mobile-device-link-scanner' : ''}`}
      data-product-surface="entry.device-link"
    >
      <div className="auth-gate-toolbar"><LanguageSwitcher /></div>
      <div className="auth-gate-card">
        <div className="auth-gate-card-body">
          <section className="auth-gate-brand">
            <Icon iconId="scan-line" size={32} className="mobile-device-link-symbol" />
            <div className="auth-gate-brand-copy">
              <h1 className="auth-gate-title">{t('mobile.deviceLink.title')}</h1>
              <Text tone="secondary">{t('mobile.deviceLink.subtitle')}</Text>
            </div>
          </section>
          {context}
          {phase !== 'failed' && !needsNewComparison ? (
            <div className="mobile-device-link-progress" role="status">
              <Spin active size="small" />
              <Text>{t(progressKey)}</Text>
            </div>
          ) : null}
          {errorKey ? <Text tone="danger" role="alert">{t(errorKey)}</Text> : null}
          <div className="auth-actions">
            <Button
              actionId="device-link-cancel"
              emphasis="secondary"
              availability={phase === 'cancelling' && busy
                ? { kind: 'disabled', reason: t('common.action.cancel') }
                : undefined}
              onActivate={() => void cancelMobileDeviceLink()}
            >
              {t('common.action.cancel')}
            </Button>
            {errorKey && !needsNewComparison ? (
              <Button
                actionId="device-link-retry"
                emphasis="primary"
                execution={busy ? 'pending' : 'idle'}
                onActivate={() => void retryMobileDeviceLink()}
              >
                {t('common.action.retry')}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
