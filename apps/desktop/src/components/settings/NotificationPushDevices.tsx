import { Button } from '@lobehub/ui';
import { Alert, Empty, Spin, Typography, theme } from 'antd';
import { RefreshCw, Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { PushChannel, PushEnvironment } from '../../gen/proto/domain/notification/notification_pb';
import { usePushDevicesStore } from '../../store/pushDevices';
import { SettingsSection } from './SettingsLayout';

const { Text } = Typography;

const CHANNEL_LABELS: Partial<Record<PushChannel, string>> = {
  [PushChannel.APNS]: 'APNs',
  [PushChannel.FCM]: 'FCM',
  [PushChannel.UNIFIED_PUSH]: 'UnifiedPush',
};

export function NotificationPushDevices() {
  const { t, i18n } = useTranslation('settings');
  const { token } = theme.useToken();
  const registrations = usePushDevicesStore((state) => state.registrations);
  const loading = usePushDevicesStore((state) => state.loading);
  const error = usePushDevicesStore((state) => state.error);
  const formatDate = (value: string | null) => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleString(i18n.language) : '—';
  };
  return (
    <SettingsSection icon={<Smartphone size={18} />}
      title={t('settings.notifications.devices.title')}
      subtitle={t('settings.notifications.devices.description')}>
      <Flexbox horizontal justify="flex-end">
        <Button size="small" icon={RefreshCw} loading={loading}
          onClick={() => usePushDevicesStore.getState().refresh()}>
          {t('settings.notifications.devices.refresh')}
        </Button>
      </Flexbox>
      {error && <Alert type="warning" showIcon message={t(error)} />}
      {loading && !registrations.length ? <Spin size="small" />
        : !registrations.length ? !error && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('settings.notifications.devices.empty')} />
          : <Flexbox gap={0} data-notification-push-devices>
            {registrations.map((registration) => (
              <Flexbox key={registration.registrationId} gap={4}
                data-push-registration={registration.registrationId}
                style={{ paddingBlock: 12, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
                <Text strong style={{ overflowWrap: 'anywhere' }}>{registration.deviceId || '—'}</Text>
                <Text type="secondary">
                  {CHANNEL_LABELS[registration.channel as PushChannel] || t('settings.notifications.devices.unknownChannel')}
                  {' · '}
                  {t(`settings.notifications.devices.${registration.environment === PushEnvironment.PRODUCTION
                    ? 'production' : registration.environment === PushEnvironment.DEVELOPMENT
                      ? 'development' : 'unknownEnvironment'}`)}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('settings.notifications.devices.updated', { date: formatDate(registration.updatedAt) })}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('settings.notifications.devices.lastDelivery', { date: formatDate(registration.lastSuccessAt) })}
                </Text>
              </Flexbox>
            ))}
          </Flexbox>}
    </SettingsSection>
  );
}
