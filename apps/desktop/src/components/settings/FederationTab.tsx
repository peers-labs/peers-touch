import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Alert, Select, Tag, Tooltip, Typography, theme } from 'antd';
import { Globe, Info, Server } from 'lucide-react';

import {
  selectFederationVisibility,
  type FederationVisibilityLabel,
} from '../../store/federation';
import { useActiveFederationSlice } from './useActiveSettingsStores';
import {
  SettingsContainer,
  SettingsItemCard,
  SettingsSection,
} from './SettingsLayout';
import { FederatedHandle } from '../FederatedHandle';

const { Text } = Typography;

const VISIBILITY_OPTIONS: FederationVisibilityLabel[] = [
  'hidden',
  'by_handle',
  'indexed',
];

export function FederationTab() {
  const { t } = useTranslation('settings');
  const { token } = theme.useToken();
  const {
    self,
    lastError,
    visibility,
    setVisibility,
    federations,
  } = useActiveFederationSlice((state) => ({
    self: state.self,
    lastError: state.lastError,
    visibility: selectFederationVisibility(state),
    setVisibility: state.setVisibility,
    federations: state.federations,
  }));
  const [saving, setSaving] = useState(false);

  const handleVisibilityChange = async (next: FederationVisibilityLabel) => {
    if (saving || next === visibility) return;
    setSaving(true);
    try {
      await setVisibility(next);
    } finally {
      setSaving(false);
    }
  };

  const visibilityOptions = VISIBILITY_OPTIONS.map((label) => ({
    value: label,
    label: t(`settings.federation.visibility.${label}.label`),
  }));
  const homeStation = self?.home_station_domain ?? '';
  const username = self?.username ?? '';

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
        title={t('settings.federation.basicInfo.title')}
        subtitle={t('settings.federation.basicInfo.subtitle')}
      >
        <SettingsItemCard>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: 13 }}>
            <div>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t('settings.federation.identity.handle')}
              </Text>
              <div>
                {username && homeStation ? (
                  <FederatedHandle localPart={username} home={homeStation} fontSize={13} />
                ) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>-</Text>
                )}
              </div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t('settings.federation.identity.homeStation')}
              </Text>
              <div><Text style={{ fontSize: 13 }}>{homeStation || '-'}</Text></div>
            </div>
          </div>

          <Flexbox
            horizontal
            align="center"
            justify="space-between"
            style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${token.colorBorderSecondary}` }}
          >
            <Flexbox gap={2} align="flex-end">
              <Flexbox horizontal align="center" gap={6}>
                <Text strong style={{ fontSize: 13 }}>
                  {t('settings.federation.visibility.label')}
                </Text>
                <Tooltip title={t('settings.federation.visibility.tooltip')} placement="right">
                  <Info size={13} style={{ color: token.colorTextTertiary }} />
                </Tooltip>
              </Flexbox>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t(`settings.federation.visibility.${visibility}.hint`)}
              </Text>
            </Flexbox>
            <Select<FederationVisibilityLabel>
              value={visibility}
              options={visibilityOptions}
              onChange={handleVisibilityChange}
              disabled={!self || saving}
              loading={saving}
              style={{ minWidth: 140 }}
              popupMatchSelectWidth={false}
            />
          </Flexbox>
        </SettingsItemCard>
      </SettingsSection>

      <SettingsSection
        icon={<Server size={18} />}
        title={t('settings.federation.contexts.title')}
        subtitle={t('settings.federation.contexts.subtitle')}
      >
        <SettingsItemCard>
          {federations.length === 0 ? (
            <Text type="secondary">{t('settings.federation.contexts.empty')}</Text>
          ) : (
            <Flexbox gap={10}>
              {federations.map((federation) => (
                <Flexbox
                  key={federation.federationId}
                  horizontal
                  align="center"
                  justify="space-between"
                  data-federation-context-id={federation.federationId}
                >
                  <Flexbox gap={2} style={{ minWidth: 0 }}>
                    <Text strong ellipsis>{federation.name || federation.federationId}</Text>
                    <Text type="secondary" ellipsis style={{ fontSize: 11 }}>
                      {federation.federationId}
                    </Text>
                  </Flexbox>
                  <Tag color={federation.status === 'active' ? 'success' : 'default'}>
                    {federation.status || 'active'}
                  </Tag>
                </Flexbox>
              ))}
            </Flexbox>
          )}
        </SettingsItemCard>
      </SettingsSection>
    </SettingsContainer>
  );
}
