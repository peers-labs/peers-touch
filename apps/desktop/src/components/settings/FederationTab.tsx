import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Icon, Segmented, Tag, Text, Tooltip } from '@peers-touch/ui';

import {
  selectFederationVisibility,
  type FederationVisibilityLabel,
} from '../../store/federation';
import { useActiveFederationSlice } from './useActiveSettingsStores';
import {
  SettingsContainer,
  SettingsSection,
  SettingsRow,
} from './SettingsLayout';
import { FederatedHandle } from '../FederatedHandle';

const VISIBILITY_OPTIONS: FederationVisibilityLabel[] = [
  'hidden',
  'by_handle',
  'indexed',
];

export function FederationTab() {
  const { t } = useTranslation('settings');
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
          tone="warning"
          title={t('settings.federation.error.title')}
          description={lastError}
        />
      ) : null}

      <SettingsSection
        icon={<Icon iconId="globe" size={18} />}
        title={t('settings.federation.basicInfo.title')}
        subtitle={t('settings.federation.basicInfo.subtitle')}
      >
        <SettingsRow label={t('settings.federation.identity.handle')}>
          <span className="sk-handle">
            {username && homeStation ? (
              <FederatedHandle localPart={username} home={homeStation} fontSize={13} />
            ) : (
              <Text>-</Text>
            )}
          </span>
        </SettingsRow>
        <SettingsRow label={t('settings.federation.identity.homeStation')}>
          <code className="sk-mono">{homeStation || '-'}</code>
        </SettingsRow>

        <SettingsRow
          label={
            <span className="sc-fed-visibility__label">
              <span className="sc-fed-visibility__title-row">
                <Text strong>{t('settings.federation.visibility.label')}</Text>
                <Tooltip label={t('settings.federation.visibility.tooltip')} placement="right">
                  <Icon iconId="circle-question-mark" size={13} className="sc-fed-visibility__info" />
                </Tooltip>
              </span>
              <Text tone="muted" className="sc-fed-visibility__hint">
                {t(`settings.federation.visibility.${visibility}.hint`)}
              </Text>
            </span>
          }
        >
          <Segmented<FederationVisibilityLabel>
            data-federation-visibility
            aria-label={t('settings.federation.visibility.label')}
            value={visibility}
            options={visibilityOptions}
            disabled={!self || saving}
            onValueChange={(value) => {
              if (value) void handleVisibilityChange(value);
            }}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        icon={<Icon iconId="server" size={18} />}
        title={t('settings.federation.contexts.title')}
        subtitle={t('settings.federation.contexts.subtitle')}
      >
        {federations.length === 0 ? (
          <p className="sk-field-hint">{t('settings.federation.contexts.empty')}</p>
        ) : (
          <div className="sk-federation-list">
            {federations.map((federation) => (
              <div
                key={federation.federationId}
                className="sk-settings-item"
                data-federation-context-id={federation.federationId}
              >
                <div className="sk-federation-row">
                  <div className="sk-federation-id">
                    <strong>{federation.name || federation.federationId}</strong>
                    <i data-active={federation.status === 'active' ? '1' : '0'} />
                  </div>
                  <Tag tone={federation.status === 'active' ? 'success' : 'neutral'}>
                    {federation.status || 'active'}
                  </Tag>
                </div>
                <p className="sk-federation-desc">{federation.federationId}</p>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
    </SettingsContainer>
  );
}
