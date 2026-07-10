// FederationTab — Settings panel for federation identity & visibility (A4).
//
// Shape:
//   ┌────────────────────────────────────────────────────────────────┐
//   │  Federation                                                    │
//   │  ┌──────────────────────────────────────────────────────────┐  │
//   │  │  Identity                                                │  │
//   │  │   @user@host        ← FederatedHandle                    │  │
//   │  │   Home station      station.example.com                  │  │
//   │  │   Locator seq       12                                   │  │
//   │  └──────────────────────────────────────────────────────────┘  │
//   │  ┌──────────────────────────────────────────────────────────┐  │
//   │  │  Visibility   ⓘ                       [ Indexed   ▼ ]    │  │
//   │  │   Hint about each label                                  │  │
//   │  └──────────────────────────────────────────────────────────┘  │
//   │  ┌──────────────────────────────────────────────────────────┐  │
//   │  │  Routing health                                          │  │
//   │  │   ● ready=true (peers_in_routing_table=12, …)            │  │
//   │  └──────────────────────────────────────────────────────────┘  │
//   └────────────────────────────────────────────────────────────────┘
//
// Architecture notes:
//   * Reads are pure projections from `useFederationStore`. The store
//     is owned by FederationRuntime; this tab never calls
//     `api.federation*` for reads.
//   * Writes go through `useFederationStore.setVisibility(label)` which
//     does the optimistic update + rollback dance internally.
//   * `lastError` is surfaced as an inline alert; it is NOT a modal
//     because every federation failure is non-blocking (the rest of
//     the app still works).

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Alert, Select, Tag, Tooltip, Typography, theme } from 'antd';
import { Globe, Info, Network, Wifi, WifiOff } from 'lucide-react';

import {
  selectFederationReady,
  selectFederationVisibility,
  type FederationVisibilityLabel,
} from '../../store/federation';
import { useActiveFederationSlice } from './useActiveSettingsStores';
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

export function FederationTab() {
  const { t } = useTranslation('settings');
  const { token } = theme.useToken();

  const { self, health, lastError, ready, visibility, setVisibility } = useActiveFederationSlice((s) => ({
    self: s.self,
    health: s.health,
    lastError: s.lastError,
    ready: selectFederationReady(s),
    visibility: selectFederationVisibility(s),
    setVisibility: s.setVisibility,
  }));

  const [saving, setSaving] = useState(false);

  const handleVisibilityChange = async (next: FederationVisibilityLabel) => {
    if (saving || next === visibility) return;
    setSaving(true);
    try {
      await setVisibility(next);
    } catch {
      // Store handles rollback + lastError surface; nothing to do here.
    } finally {
      setSaving(false);
    }
  };

  const visibilityOptions = VISIBILITY_OPTIONS.map((label) => ({
    value: label,
    label: (
      <Flexbox horizontal align="center" gap={6}>
        <Text strong style={{ fontSize: 13 }}>
          {t(`settings.federation.visibility.${label}.label`)}
        </Text>
      </Flexbox>
    ),
  }));

  const visibilityHint = t(`settings.federation.visibility.${visibility}.hint`);

  const peersInRoutingTable = health?.peersInRoutingTable ?? 0;
  const minDhtPeers = health?.minDhtPeers ?? 0;
  const seedsConnected = health?.seedsConnected ?? 0;
  const seedsConfigured = health?.seedsConfigured ?? 0;
  const homeStation = self?.homeStationDomain ?? '';
  const username = self?.preferredUsername ?? '';
  const locatorSeq = self ? Number(self.locatorSeq) : 0;
  // Tier B2 — relay-mount labels the next signed locator publish will
  // carry. Empty when relay-client is disabled (single-station deploy)
  // or hasn't yet finished register; the runtime polls /me on each
  // tick so this rerenders without manual refresh once available.
  const relayMounts = self?.inboxRelayMounts ?? [];

  return (
    <SettingsContainer>
      {lastError && (
        <Alert
          type="warning"
          showIcon
          message={t('settings.federation.error.title')}
          description={lastError}
        />
      )}

      <SettingsSection
        icon={<Network size={18} />}
        title={t('settings.federation.identity.title')}
        subtitle={t('settings.federation.identity.subtitle')}
      >
        <SettingsItemCard>
          <Flexbox gap={12}>
            <SettingsRow label={t('settings.federation.identity.handle')}>
              {username ? (
                <FederatedHandle
                  localPart={username}
                  home={homeStation}
                  fontSize={13}
                />
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('settings.federation.identity.empty')}
                </Text>
              )}
            </SettingsRow>
            <SettingsRow
              label={t('settings.federation.identity.homeStation')}
              description={t('settings.federation.identity.homeStationHint')}
            >
              <Text style={{ fontSize: 12, color: token.colorTextSecondary }}>
                {homeStation || '—'}
              </Text>
            </SettingsRow>
            <SettingsRow
              label={t('settings.federation.identity.locatorSeq')}
              description={t('settings.federation.identity.locatorSeqHint')}
            >
              <Text style={{ fontSize: 12, color: token.colorTextSecondary }}>
                {locatorSeq || '—'}
              </Text>
            </SettingsRow>
            <SettingsRow
              label={t('settings.federation.identity.relayMounts')}
              description={t('settings.federation.identity.relayMountsHint')}
              vertical
            >
              {relayMounts.length > 0 ? (
                <Flexbox horizontal wrap="wrap" gap={6}>
                  {relayMounts.map((mount) => (
                    <Tag
                      key={mount}
                      icon={<Network size={11} style={{ marginRight: 2 }} />}
                      style={{ fontSize: 12 }}
                    >
                      {mount}
                    </Tag>
                  ))}
                </Flexbox>
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('settings.federation.identity.relayMountsEmpty')}
                </Text>
              )}
            </SettingsRow>
          </Flexbox>
        </SettingsItemCard>
      </SettingsSection>

      <SettingsSection
        icon={<Globe size={18} />}
        title={t('settings.federation.visibility.title')}
        subtitle={t('settings.federation.visibility.subtitle')}
      >
        <SettingsItemCard>
          <Flexbox gap={12}>
            <Flexbox horizontal align="center" justify="space-between" gap={12}>
              <Flexbox horizontal align="center" gap={6}>
                <Text strong style={{ fontSize: 13 }}>
                  {t('settings.federation.visibility.label')}
                </Text>
                <Tooltip
                  title={t('settings.federation.visibility.tooltip')}
                  placement="right"
                >
                  <Info size={13} style={{ color: token.colorTextTertiary }} />
                </Tooltip>
              </Flexbox>
              <Select<FederationVisibilityLabel>
                value={visibility}
                options={visibilityOptions}
                onChange={handleVisibilityChange}
                disabled={!self || saving}
                loading={saving}
                style={{ minWidth: 160 }}
                popupMatchSelectWidth={false}
              />
            </Flexbox>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {visibilityHint}
            </Text>
          </Flexbox>
        </SettingsItemCard>
      </SettingsSection>

      <SettingsSection
        icon={ready ? <Wifi size={18} /> : <WifiOff size={18} />}
        title={t('settings.federation.health.title')}
        subtitle={t('settings.federation.health.subtitle')}
        extra={
          <Tag color={ready ? 'success' : 'warning'}>
            {ready
              ? t('settings.federation.health.ready')
              : t('settings.federation.health.joining')}
          </Tag>
        }
      >
        <SettingsItemCard>
          <Flexbox gap={8}>
            <SettingsRow
              label={t('settings.federation.health.peersInRoutingTable')}
              description={t('settings.federation.health.peersHint', {
                min: minDhtPeers,
              })}
            >
              <Text strong style={{ fontSize: 13 }}>
                {peersInRoutingTable}
              </Text>
            </SettingsRow>
            <SettingsRow
              label={t('settings.federation.health.seedsConnected')}
              description={t('settings.federation.health.seedsHint')}
            >
              <Text strong style={{ fontSize: 13 }}>
                {seedsConnected} / {seedsConfigured}
              </Text>
            </SettingsRow>
          </Flexbox>
        </SettingsItemCard>
      </SettingsSection>
    </SettingsContainer>
  );
}
