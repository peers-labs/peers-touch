import { Button } from '@lobehub/ui';
import { Alert, Space, Spin, Typography, theme } from 'antd';
import {
  CircleAlert,
  KeyRound,
  LockKeyhole,
  RefreshCcw,
  ShieldAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  PrivatePublishState,
  PrivateReadState,
} from '../../../services/privateMomentsNative';

const { Text } = Typography;

type SocialPrivateStateValue = PrivatePublishState | PrivateReadState;

export interface SocialPrivateStateProps {
  state: SocialPrivateStateValue;
  compact?: boolean;
  onRetry?: () => void;
  onRecover?: () => void;
}

const PROGRESS_STATES = new Set<SocialPrivateStateValue>([
  'CHECKING_PRIVATE_READINESS',
  'CHECKING_REMOTE_READINESS',
  'PUBLISHING',
  'UNKNOWN_COMMIT',
  'LOADING_AUTHORIZED_RESOURCE',
  'WAITING_FOR_PRIVATE_KEY',
  'DECRYPTING',
]);

const ERROR_STATES = new Set<SocialPrivateStateValue>([
  'PUBLISH_FAILED',
  'INTEGRITY_FAILURE',
]);

const WARNING_STATES = new Set<SocialPrivateStateValue>([
  'PRIVATE_UNSUPPORTED',
  'RECIPIENT_KEY_UNAVAILABLE',
  'AUDIENCE_TOO_LARGE',
  'RECOVERY_REQUIRED',
  'RECOVERY_KEY_UNAVAILABLE',
  'AUTHENTICATION_REQUIRED',
  'NOT_FOUND_OR_NOT_AUTHORIZED',
  'PRIVATE_UNSUPPORTED_ON_DEVICE',
  'DELETED_OR_REVOKED',
]);

function StateIcon({ state }: { state: SocialPrivateStateValue }) {
  const { token } = theme.useToken();
  if (PROGRESS_STATES.has(state)) return <Spin size="small" />;
  if (state === 'RECOVERY_REQUIRED' || state === 'RECOVERY_KEY_UNAVAILABLE') {
    return <KeyRound size={16} color={token.colorWarning} />;
  }
  if (state === 'INTEGRITY_FAILURE') {
    return <ShieldAlert size={16} color={token.colorError} />;
  }
  if (WARNING_STATES.has(state)) {
    return <CircleAlert size={16} color={token.colorWarning} />;
  }
  return <LockKeyhole size={16} color={token.colorPrimary} />;
}

function canRetry(state: SocialPrivateStateValue): boolean {
  return [
    'RECIPIENT_KEY_UNAVAILABLE',
    'UNKNOWN_COMMIT',
    'PUBLISH_FAILED',
    'WAITING_FOR_PRIVATE_KEY',
    'RECOVERY_KEY_UNAVAILABLE',
    'INTEGRITY_FAILURE',
  ].includes(state);
}

export function SocialPrivateState({
  state,
  compact = false,
  onRetry,
  onRecover,
}: SocialPrivateStateProps) {
  const { t } = useTranslation('moments');
  const { token } = theme.useToken();
  if (state === 'IDLE' || state === 'CONTENT_READY' || state === 'PUBLISHED') {
    return null;
  }

  const type = ERROR_STATES.has(state)
    ? 'error'
    : WARNING_STATES.has(state)
      ? 'warning'
      : 'info';
  const action = state === 'RECOVERY_REQUIRED' && onRecover
    ? (
        <Button size="small" onClick={onRecover}>
          {t('moments.private.action.recover')}
        </Button>
      )
    : canRetry(state) && onRetry
      ? (
          <Button
            size="small"
            type="text"
            icon={<RefreshCcw size={13} />}
            onClick={onRetry}
          >
            {t('moments.private.action.retry')}
          </Button>
        )
      : undefined;

  return (
    <Alert
      data-private-moment-state={state}
      type={type}
      showIcon={false}
      action={action}
      style={{
        marginTop: compact ? 8 : 10,
        borderRadius: token.borderRadiusLG,
        padding: compact ? '7px 10px' : '10px 12px',
      }}
      message={(
        <Space size={8} align="start">
          <StateIcon state={state} />
          <span>
            <Text strong style={{ fontSize: 13 }}>
              {t(`moments.private.state.${state}.title`)}
            </Text>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t(`moments.private.state.${state}.description`)}
            </Text>
          </span>
        </Space>
      )}
    />
  );
}
