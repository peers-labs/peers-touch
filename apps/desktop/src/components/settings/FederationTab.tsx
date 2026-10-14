import { useEffect, useRef, useState } from 'react';
import { Button } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import {
  Alert,
  Modal,
  Segmented,
  Select,
  Spin,
  Switch,
  Tag,
  Typography,
  message,
  theme,
} from 'antd';
import {
  Clock,
  Copy,
  Globe,
  LogOut,
  MonitorSmartphone,
  Network,
  Plus,
  Server,
} from 'lucide-react';

import { ActorDeviceStatus } from '../../gen/proto/domain/actor/actor_pb';
import { identityRuntime } from '../../kernel/identityRuntime';
import {
  selectFederationVisibility,
  type FederationVisibilityLabel,
} from '../../store/federation';
import {
  useActiveFederationSlice,
  useActiveSettingsSlice,
} from './useActiveSettingsStores';
import {
  SettingsContainer,
  SettingsItemCard,
  SettingsRow,
  SettingsSection,
} from './SettingsLayout';
import { FederatedHandle } from '../FederatedHandle';

const { Text } = Typography;

const VISIBILITY_OPTIONS: FederationVisibilityLabel[] = [
  'hidden',
  'by_handle',
  'indexed',
];

type ReachPolicy = 'anyone' | 'federations' | 'nobody';

function PendingBackendBadge({ title }: { title: string }) {
  const { token } = theme.useToken();
  const { t } = useTranslation('settings');

  return (
    <Tag
      icon={<Clock size={11} />}
      title={title}
      data-pending-backend
      style={{
        alignItems: 'center',
        borderColor: token.colorPrimaryBorder,
        color: token.colorPrimary,
        display: 'inline-flex',
        fontSize: 11,
        gap: 4,
        marginInlineEnd: 0,
      }}
    >
      {t('settings.network.pendingBackend')}
    </Tag>
  );
}

function deviceStatusLabel(status: ActorDeviceStatus, t: (key: string) => string) {
  switch (status) {
    case ActorDeviceStatus.ACTIVE:
      return t('settings.network.device.status.active');
    case ActorDeviceStatus.ENROLLING:
      return t('settings.network.device.status.enrolling');
    case ActorDeviceStatus.REVOKE_PENDING:
      return t('settings.network.device.status.revokePending');
    case ActorDeviceStatus.REVOKED:
      return t('settings.network.device.status.revoked');
    default:
      return t('settings.network.device.status.unknown');
  }
}

export function YourStationTab() {
  const { t } = useTranslation('settings');
  const { token } = theme.useToken();
  const { self, lastError } = useActiveFederationSlice((state) => ({
    self: state.self,
    lastError: state.lastError,
  }));
  const {
    devices,
    currentDeviceId,
    devicesLoading,
    devicesError,
    deviceRevokingId,
    revokeDevice,
  } = useActiveSettingsSlice((state) => ({
    devices: state.devices,
    currentDeviceId: state.currentDeviceId,
    devicesLoading: state.devicesLoading,
    devicesError: state.devicesError,
    deviceRevokingId: state.deviceRevokingId,
    revokeDevice: state.revokeDevice,
  }));
  const [switching, setSwitching] = useState(false);

  const handleRevokeDevice = (
    deviceId: string,
    deviceLabel: string,
    observedProfileVersion: bigint,
  ) => {
    Modal.confirm({
      title: t('settings.network.devices.revokeConfirmTitle', { name: deviceLabel }),
      content: t('settings.network.devices.revokeConfirmBody'),
      okText: t('settings.network.devices.revokeAction'),
      cancelText: t('settings.network.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await revokeDevice(deviceId, observedProfileVersion);
          message.success(t('settings.network.devices.revokeSuccess'));
        } catch (error) {
          message.error(
            error instanceof Error
              ? error.message
              : t('settings.network.devices.revokeFailed'),
          );
          throw error;
        }
      },
    });
  };

  const handleSwitchStation = () => {
    Modal.confirm({
      title: t('settings.network.switchStation.confirmTitle'),
      content: t('settings.network.switchStation.confirmBody'),
      okText: t('settings.network.switchStation.confirmAction'),
      cancelText: t('settings.network.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setSwitching(true);
        try {
          await identityRuntime.switchStation();
        } catch (error) {
          message.error(
            error instanceof Error
              ? error.message
              : t('settings.network.switchStation.failed'),
          );
          throw error;
        } finally {
          setSwitching(false);
        }
      },
    });
  };

  return (
    <SettingsContainer>
      {lastError ? (
        <Alert
          type="warning"
          showIcon
          message={t('settings.federation.error.title')}
          description={lastError}
        />
      ) : null}

      <SettingsSection
        icon={<Server size={18} />}
        title={t('settings.network.station.title')}
        subtitle={t('settings.network.station.subtitle')}
      >
        <SettingsItemCard>
          <Flexbox
            horizontal
            align="center"
            gap={14}
            data-station-binding
          >
            <Flexbox
              align="center"
              justify="center"
              style={{
                background: token.colorPrimaryBg,
                border: `1px solid ${token.colorPrimaryBorder}`,
                borderRadius: 8,
                color: token.colorPrimary,
                flex: '0 0 44px',
                height: 44,
              }}
            >
              <Server size={21} />
            </Flexbox>
            <Flexbox gap={2} style={{ flex: 1, minWidth: 0 }}>
              <Text strong ellipsis style={{ fontSize: 14 }}>
                {self?.home_station_domain || t('settings.network.station.unavailable')}
              </Text>
              <Text type="secondary" ellipsis style={{ fontSize: 11 }}>
                {self?.home_station_peer_id || t('settings.network.station.peerIdUnavailable')}
              </Text>
            </Flexbox>
          </Flexbox>

          <div
            style={{
              borderTop: `1px solid ${token.colorBorderSecondary}`,
              marginTop: 14,
              paddingTop: 12,
            }}
          >
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('settings.network.station.operatorNote')}
            </Text>
          </div>
        </SettingsItemCard>
      </SettingsSection>

      <SettingsSection
        icon={<MonitorSmartphone size={18} />}
        title={t('settings.network.devices.title')}
        subtitle={t('settings.network.devices.subtitle')}
      >
        {devicesError ? (
          <Alert
            type="warning"
            showIcon
            message={t('settings.network.devices.failed')}
            description={devicesError}
          />
        ) : null}

        {devicesLoading ? (
          <Flexbox horizontal align="center" gap={8}>
            <Spin size="small" />
            <Text type="secondary">{t('settings.network.devices.loading')}</Text>
          </Flexbox>
        ) : devices.length === 0 ? (
          <Text type="secondary">{t('settings.network.devices.empty')}</Text>
        ) : (
          <Flexbox gap={8}>
            {devices.map((device) => {
              const deviceId = device.ref?.deviceId ?? '';
              const current = deviceId !== '' && deviceId === currentDeviceId;
              const canRevoke = (
                !current
                && device.status === ActorDeviceStatus.ACTIVE
                && deviceId !== ''
              );
              const deviceLabel = device.label || t('settings.network.device.unnamed');
              return (
                <SettingsItemCard key={deviceId || device.signingKeyId}>
                  <Flexbox horizontal align="center" justify="space-between" gap={12}>
                    <Flexbox gap={2} style={{ minWidth: 0 }}>
                      <Text strong ellipsis>
                        {deviceLabel}
                      </Text>
                      <Text type="secondary" ellipsis style={{ fontSize: 11 }}>
                        {deviceStatusLabel(device.status, t)}
                      </Text>
                    </Flexbox>
                    <Flexbox horizontal align="center" gap={8} style={{ flexShrink: 0 }}>
                      {current ? (
                        <Tag color="processing">
                          {t('settings.network.device.current')}
                        </Tag>
                      ) : null}
                      {canRevoke ? (
                        <Button
                          danger
                          size="small"
                          loading={deviceRevokingId === deviceId}
                          disabled={
                            deviceRevokingId !== null
                            && deviceRevokingId !== deviceId
                          }
                          onClick={() => handleRevokeDevice(
                            deviceId,
                            deviceLabel,
                            device.profileVersion,
                          )}
                          data-device-revoke={deviceId}
                        >
                          {t('settings.network.devices.revokeAction')}
                        </Button>
                      ) : null}
                    </Flexbox>
                  </Flexbox>
                </SettingsItemCard>
              );
            })}
          </Flexbox>
        )}
      </SettingsSection>

      <SettingsSection
        icon={<LogOut size={18} />}
        title={t('settings.network.switchStation.title')}
        subtitle={t('settings.network.switchStation.subtitle')}
      >
        <Button
          danger
          loading={switching}
          icon={<LogOut size={14} />}
          onClick={handleSwitchStation}
          data-switch-station
          style={{ alignSelf: 'flex-start' }}
        >
          {t('settings.network.switchStation.action')}
        </Button>
      </SettingsSection>
    </SettingsContainer>
  );
}

export function DiscoveryTab() {
  const { t } = useTranslation('settings');
  const { token } = theme.useToken();
  const {
    self,
    lastError,
    visibility,
    setVisibility,
    setContactPolicy,
    setFederationVisibility,
    federations,
  } = useActiveFederationSlice((state) => ({
    self: state.self,
    lastError: state.lastError,
    visibility: selectFederationVisibility(state),
    setVisibility: state.setVisibility,
    setContactPolicy: state.setContactPolicy,
    setFederationVisibility: state.setFederationVisibility,
    federations: state.federations,
  }));
  const [saving, setSaving] = useState(false);
  const [savingContactPolicy, setSavingContactPolicy] = useState(false);
  const [savingFederationId, setSavingFederationId] = useState<string | null>(null);
  const lastVisibleRef = useRef<FederationVisibilityLabel>(
    visibility === 'hidden' ? 'by_handle' : visibility,
  );

  useEffect(() => {
    if (visibility !== 'hidden') {
      lastVisibleRef.current = visibility;
    }
  }, [visibility]);

  const handleVisibilityChange = async (next: FederationVisibilityLabel) => {
    if (saving || next === visibility) return;
    setSaving(true);
    try {
      await setVisibility(next);
    } catch {
      // The Federation store owns the durable error projection rendered above.
    } finally {
      setSaving(false);
    }
  };

  const handleDiscoverableChange = (checked: boolean) => {
    void handleVisibilityChange(
      checked ? lastVisibleRef.current : 'hidden',
    );
  };

  const visibilityOptions = VISIBILITY_OPTIONS.map((label) => ({
    value: label,
    label: t(`settings.federation.visibility.${label}.label`),
  }));
  const homeStation = self?.home_station_domain ?? '';
  const username = self?.username ?? '';
  const handle = self?.federated_handle || (
    username && homeStation ? `@${username}@${homeStation}` : ''
  );
  const reachValue: ReachPolicy = self?.contact_policy ?? 'anyone';
  const directoryEnabled = federations.length === 0
    || federations.some((federation) => federation.localDirectoryEnabled);

  const handleContactPolicyChange = async (next: ReachPolicy) => {
    if (savingContactPolicy || next === reachValue) return;
    setSavingContactPolicy(true);
    try {
      await setContactPolicy(next);
    } catch {
      // The Federation store owns the durable error projection rendered above.
    } finally {
      setSavingContactPolicy(false);
    }
  };

  const handleFederationVisibilityChange = async (
    federationId: string,
    checked: boolean,
  ) => {
    if (savingFederationId) return;
    setSavingFederationId(federationId);
    try {
      await setFederationVisibility(
        federationId,
        checked ? 'indexed' : 'by_handle',
      );
    } catch {
      // The Federation store owns the durable error projection rendered above.
    } finally {
      setSavingFederationId(null);
    }
  };

  const copyHandle = async () => {
    if (!handle) return;
    try {
      await navigator.clipboard.writeText(handle);
      message.success(t('settings.network.discovery.handleCopied'));
    } catch {
      message.error(t('settings.network.discovery.handleCopyFailed'));
    }
  };

  return (
    <SettingsContainer>
      {lastError ? (
        <Alert
          type="warning"
          showIcon
          message={t('settings.federation.error.title')}
          description={lastError}
        />
      ) : null}

      <SettingsSection
        icon={<Globe size={18} />}
        title={t('settings.network.discovery.title')}
        subtitle={t('settings.network.discovery.subtitle')}
      >
        <SettingsRow
          label={t('settings.network.discovery.discoverable')}
          description={t(
            visibility === 'hidden'
              ? 'settings.network.discovery.hiddenHint'
              : 'settings.network.discovery.visibleHint',
          )}
        >
          <Switch
            checked={visibility !== 'hidden'}
            loading={saving}
            disabled={!self}
            onChange={handleDiscoverableChange}
            aria-label={t('settings.network.discovery.discoverable')}
          />
        </SettingsRow>

        <SettingsRow
          label={t('settings.federation.visibility.label')}
          description={t(`settings.federation.visibility.${visibility}.hint`)}
        >
          <Select<FederationVisibilityLabel>
            value={visibility}
            options={visibilityOptions}
            onChange={handleVisibilityChange}
            disabled={!self || saving}
            loading={saving}
            style={{ minWidth: 160 }}
            popupMatchSelectWidth={false}
          />
        </SettingsRow>

        <div
          data-discovery-federations
          style={{
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            marginTop: 4,
            paddingTop: 12,
          }}
        >
          <Flexbox horizontal align="center" gap={8} style={{ marginBottom: 8 }}>
            <Text strong style={{ fontSize: 13 }}>
              {t('settings.network.discovery.perFederation')}
            </Text>
          </Flexbox>
          <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
            {t('settings.network.discovery.perFederationHint')}
          </Text>
          {!directoryEnabled ? (
            <Alert
              type="info"
              showIcon
              message={t('settings.network.discovery.directoryDisabledTitle')}
              description={t('settings.network.discovery.directoryDisabledDescription')}
              style={{ marginBottom: 8 }}
            />
          ) : null}
          {federations.length === 0 ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('settings.federation.contexts.empty')}
            </Text>
          ) : (
            <Flexbox gap={6}>
              {federations.map((federation) => (
                <SettingsRow
                  key={federation.federationId}
                  label={federation.name || federation.federationId}
                  description={federation.federationId}
                >
                  <Switch
                    checked={
                      visibility === 'indexed'
                      && self?.federation_visibility[federation.federationId] === 'indexed'
                    }
                    loading={savingFederationId === federation.federationId}
                    disabled={
                      !self
                      || visibility === 'hidden'
                      || !directoryEnabled
                      || saving
                      || (
                        savingFederationId !== null
                        && savingFederationId !== federation.federationId
                      )
                    }
                    onChange={(checked) => {
                      void handleFederationVisibilityChange(
                        federation.federationId,
                        checked,
                      );
                    }}
                    aria-label={t('settings.network.discovery.federationVisibility', {
                      name: federation.name || federation.federationId,
                    })}
                  />
                </SettingsRow>
              ))}
            </Flexbox>
          )}
        </div>

        <SettingsRow
          label={t('settings.network.discovery.handle')}
          description={t('settings.network.discovery.handleHint')}
        >
          <Flexbox horizontal align="center" gap={6}>
            {handle ? (
              <FederatedHandle
                localPart={username}
                home={homeStation}
                fontSize={13}
              />
            ) : (
              <Text type="secondary">-</Text>
            )}
            <Button
              type="text"
              icon={<Copy size={14} />}
              disabled={!handle}
              onClick={copyHandle}
              aria-label={t('settings.network.discovery.copyHandle')}
              title={t('settings.network.discovery.copyHandle')}
            />
          </Flexbox>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        icon={<Network size={18} />}
        title={t('settings.network.contact.title')}
        subtitle={t('settings.network.contact.subtitle')}
      >
        <Segmented<ReachPolicy>
          block
          disabled={!self || savingContactPolicy}
          value={reachValue}
          options={[
            {
              value: 'anyone',
              label: t('settings.network.contact.anyone'),
            },
            {
              value: 'federations',
              label: t('settings.network.contact.federations'),
            },
            {
              value: 'nobody',
              label: t('settings.network.contact.nobody'),
            },
          ]}
          onChange={(next) => {
            void handleContactPolicyChange(next);
          }}
          aria-label={t('settings.network.contact.title')}
        />
      </SettingsSection>
    </SettingsContainer>
  );
}

export function FederationTab() {
  const { t } = useTranslation('settings');
  const { federations } = useActiveFederationSlice((state) => ({
    federations: state.federations,
  }));

  return (
    <SettingsContainer>
      <SettingsSection
        icon={<Network size={18} />}
        title={t('settings.network.federation.title')}
        subtitle={t('settings.network.federation.subtitle')}
        extra={(
          <Flexbox horizontal align="center" gap={8}>
            <PendingBackendBadge title={t('settings.network.federation.joinPending')} />
            <Button
              type="primary"
              icon={<Plus size={14} />}
              disabled
              data-join-federation
            >
              {t('settings.network.federation.join')}
            </Button>
          </Flexbox>
        )}
      >
        {federations.length === 0 ? (
          <Text type="secondary">{t('settings.federation.contexts.empty')}</Text>
        ) : (
          <Flexbox gap={8}>
            {federations.map((federation) => {
              const active = federation.status === 'active';
              return (
                <SettingsItemCard
                  key={federation.federationId}
                  data-federation-context-id={federation.federationId}
                >
                  <Flexbox horizontal align="center" justify="space-between" gap={12}>
                    <Flexbox gap={2} style={{ minWidth: 0 }}>
                      <Text strong ellipsis>
                        {federation.name || federation.federationId}
                      </Text>
                      <Text type="secondary" ellipsis style={{ fontSize: 11 }}>
                        {federation.federationId}
                      </Text>
                    </Flexbox>
                    <Flexbox horizontal align="center" gap={8} style={{ flexShrink: 0 }}>
                      <Tag color={active ? 'success' : 'default'}>
                        {t(
                          active
                            ? 'settings.network.federation.status.active'
                            : 'settings.network.federation.status.inactive',
                        )}
                      </Tag>
                      {active ? (
                        <>
                          <PendingBackendBadge
                            title={t('settings.network.federation.leavePending')}
                          />
                          <Button danger disabled data-leave-federation>
                            {t('settings.network.federation.leave')}
                          </Button>
                        </>
                      ) : null}
                    </Flexbox>
                  </Flexbox>
                </SettingsItemCard>
              );
            })}
          </Flexbox>
        )}
      </SettingsSection>

      <Alert
        type="info"
        showIcon
        message={t('settings.network.federation.dashboardTitle')}
        description={t('settings.network.federation.dashboardDescription')}
      />
    </SettingsContainer>
  );
}
