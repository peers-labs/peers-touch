import { useRef } from 'react';
import { Button, Card, Typography } from 'antd';
import { LoaderCircle, ScanLine, ShieldCheck } from 'lucide-react';
import { useMobileI18n } from '../../app/mobileI18n';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { DeviceLinkState } from '../../gen/proto/domain/auth/device_link_pb';
import {
  cancelMobileDeviceLink,
  refreshMobileDeviceLink,
  submitMobileDeviceLink,
} from '../../runtimes/deviceLinkRuntime';
import { sanitizeAccessDecision } from '../../runtimes/accessRuntime';
import type { NativeAccessGateInput } from '../../services/mobileCommands';
import { secureRandomUuid } from '../../utils/randomIdentity';
import { AccessGateHost } from './AccessGateHost';
import { currentAccessGate, gateTypeNumber, isAccessGranted, schemaGateInput } from './authSession';
import { useDeviceLinkStore } from './deviceLinkStore';
import './deviceLink.css';

const { Text, Title } = Typography;

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
      <ShieldCheck size={24} aria-hidden="true" />
      <Text strong className="mobile-device-link-account">{projection.actorLabel}</Text>
      {projection.comparisonCode ? (
        <>
          <Text type="secondary">{t('mobile.deviceLink.compare')}</Text>
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
      <Card className="auth-gate-card" variant="borderless">
        <section className="auth-gate-brand">
          <ScanLine size={32} className="mobile-device-link-symbol" aria-hidden="true" />
          <div className="auth-gate-brand-copy">
            <Title level={1} className="auth-gate-title">{t('mobile.deviceLink.title')}</Title>
            <Text type="secondary">{t('mobile.deviceLink.subtitle')}</Text>
          </div>
        </section>
        {context}
        {phase !== 'failed' && !needsNewComparison ? (
          <div className="mobile-device-link-progress" role="status">
            <LoaderCircle size={18} aria-hidden="true" />
            <Text>{t(progressKey)}</Text>
          </div>
        ) : null}
        {errorKey ? <Text type="danger" role="alert">{t(errorKey)}</Text> : null}
        <div className="auth-actions">
          <Button disabled={phase === 'cancelling' && busy} onClick={() => void cancelMobileDeviceLink()}>
            {t('common.action.cancel')}
          </Button>
          {errorKey && !needsNewComparison ? (
            <Button type="primary" loading={busy} onClick={() => void refreshMobileDeviceLink()}>
              {t('common.action.retry')}
            </Button>
          ) : null}
        </div>
      </Card>
    </main>
  );
}
