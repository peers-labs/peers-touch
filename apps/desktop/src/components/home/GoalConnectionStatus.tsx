import { Alert, Button, Tag } from 'antd';
import { CheckCircle2, RefreshCw, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { refreshHomeProjection } from '../../runtimes/homeRuntime';
import { useHomeStore } from '../../store/home';

export function GoalConnectionStatus() {
  const { t } = useTranslation('agent');
  const connectionState = useHomeStore((state) => state.connectionState);
  const retryable = useHomeStore((state) => state.retryable);
  const loading = useHomeStore((state) => state.loading);

  if (connectionState === 'fresh') {
    return (
      <Tag
        bordered={false}
        color="success"
        data-pt-home-connection-state="fresh"
        icon={<CheckCircle2 aria-hidden size={13} />}
      >
        {t('agent.home.connectionFresh')}
      </Tag>
    );
  }

  const retry = retryable ? (
    <Button
      aria-label={t('agent.home.retry')}
      data-pt-home-connection-retry=""
      icon={<RefreshCw aria-hidden size={14} />}
      loading={loading}
      onClick={() => void refreshHomeProjection()}
      size="small"
      type="text"
    />
  ) : undefined;
  const presentation = {
    reconnecting: {
      message: t('agent.home.connectionReconnecting'),
      type: 'warning' as const,
    },
    resyncing: {
      message: t('agent.home.connectionResyncing'),
      type: 'info' as const,
    },
    stale: {
      message: t('agent.home.connectionStale'),
      type: 'warning' as const,
    },
    unauthorized: {
      message: t('agent.home.connectionUnauthorized'),
      type: 'error' as const,
    },
  }[connectionState];

  return (
    <Alert
      action={retry}
      data-pt-home-connection-state={connectionState}
      icon={
        connectionState === 'reconnecting'
          ? <WifiOff aria-hidden size={15} />
          : <RefreshCw aria-hidden size={15} />
      }
      message={presentation.message}
      showIcon
      type={presentation.type}
    />
  );
}
