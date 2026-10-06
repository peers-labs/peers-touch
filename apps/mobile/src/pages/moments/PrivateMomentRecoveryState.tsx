import { Button, Space, Typography } from 'antd';
import { ArrowLeft, KeyRound, RotateCcw, ShieldAlert } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import type { PrivateMomentReadProjection } from '../../services/mobileCommands';

import './PrivateMomentRecoveryState.css';

const { Text, Title } = Typography;

type BlockingPrivateMomentState = Extract<
  PrivateMomentReadProjection['state'],
  'RECOVERY_REQUIRED' | 'INTEGRITY_FAILURE'
>;

interface PrivateMomentRecoveryStateProps {
  readonly projection: PrivateMomentReadProjection & {
    readonly state: BlockingPrivateMomentState;
  };
  readonly busy: boolean;
  readonly error: boolean;
  readonly onBack: () => void;
  readonly onRecover: () => void;
  readonly onRetryVerification: () => void;
}

export function PrivateMomentRecoveryState({
  projection,
  busy,
  error,
  onBack,
  onRecover,
  onRetryVerification,
}: PrivateMomentRecoveryStateProps) {
  const { t } = useMobileI18n();
  const recoveryRequired = projection.state === 'RECOVERY_REQUIRED';
  const Icon = recoveryRequired ? KeyRound : ShieldAlert;

  return (
    <section
      className="private-moment-recovery"
      data-private-moment-state={projection.state}
      data-private-moment-post-id={projection.postId}
      role="alert"
      aria-busy={busy}
    >
      <Icon size={36} strokeWidth={1.5} aria-hidden="true" />
      <Title level={5}>
        {t(`mobile.moments.private.state.${projection.state}.title`)}
      </Title>
      <Text type="secondary">
        {t(`mobile.moments.private.state.${projection.state}.description`)}
      </Text>
      <Text className="private-moment-recovery__identity" code title={projection.postId}>
        {projection.postId}
      </Text>
      {error ? (
        <Text type="danger">{t('mobile.moments.private.recovery.failed')}</Text>
      ) : null}
      <Space className="private-moment-recovery__actions" wrap>
        <Button icon={<ArrowLeft size={14} />} disabled={busy} onClick={onBack}>
          {t('common.action.back')}
        </Button>
        {recoveryRequired ? (
          <Button
            type="primary"
            icon={<KeyRound size={14} />}
            loading={busy}
            onClick={onRecover}
          >
            {t('mobile.moments.private.recovery.action')}
          </Button>
        ) : (
          <Button
            icon={<RotateCcw size={14} />}
            loading={busy}
            onClick={onRetryVerification}
          >
            {t('mobile.moments.private.integrity.retry')}
          </Button>
        )}
      </Space>
    </section>
  );
}
