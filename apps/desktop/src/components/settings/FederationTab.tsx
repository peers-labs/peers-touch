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
import { Alert, Button, Card, Input, Modal, Select, Tag, Tooltip, Typography, message, theme } from 'antd';
import { Copy, Globe, Info, Link2, Plus, Server, Trash2, UserPlus } from 'lucide-react';

import {
  selectFederationReady,
  selectFederationVisibility,
  type FederationVisibilityLabel,
} from '../../store/federation';
import type { FederationSummary } from '../../services/desktop_api';
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

const INVITE_LINK_PREFIX = 'peers-touch://federation/join';

function buildInviteLink(federationId: string, name: string, stationDomain: string): string {
  const params = new URLSearchParams();
  params.set('id', federationId);
  if (name) params.set('name', name);
  if (stationDomain) params.set('endpoint', stationDomain);
  return `${INVITE_LINK_PREFIX}?${params.toString()}`;
}

function parseInviteLink(raw: string): { endpoint: string; federationId: string; name: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.startsWith('peers-touch://') ? trimmed : `peers-touch://x?${trimmed}`);
    const id = url.searchParams.get('id') || '';
    const endpoint = url.searchParams.get('endpoint') || '';
    const name = url.searchParams.get('name') || '';
    if (!id && !endpoint) return null;
    return { endpoint, federationId: id, name };
  } catch {
    return null;
  }
}

export function FederationTab() {
  const { t } = useTranslation('settings');
  const { token } = theme.useToken();

  const {
    self, health, lastError, ready, visibility, setVisibility,
    federations, createFederation, joinFederation, leaveFederation, deleteFederation,
  } = useActiveFederationSlice((s) => ({
    self: s.self,
    health: s.health,
    lastError: s.lastError,
    ready: selectFederationReady(s),
    visibility: selectFederationVisibility(s),
    setVisibility: s.setVisibility,
    federations: s.federations,
    createFederation: s.createFederation,
    joinFederation: s.joinFederation,
    leaveFederation: s.leaveFederation,
    deleteFederation: s.deleteFederation,
  }));

  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [joinEndpoint, setJoinEndpoint] = useState('');
  const [joinFedId, setJoinFedId] = useState('');
  const [joinMsg, setJoinMsg] = useState('');
  const [joinInviteLink, setJoinInviteLink] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

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

  const FEDERATION_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9 \-]{0,62}[a-zA-Z0-9]$/;

  const handleCreate = async () => {
    const name = createName.trim();
    if (!name || actionLoading) return;
    if (!FEDERATION_NAME_RE.test(name)) {
      message.error(t('settings.federation.create.invalidName', { defaultValue: 'Name must be 2-64 characters: letters, numbers, spaces, and hyphens only' }));
      return;
    }
    if (federations.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      message.error(t('settings.federation.create.duplicateName', { defaultValue: 'A federation with this name already exists' }));
      return;
    }
    setActionLoading(true);
    try {
      await createFederation(createName.trim(), createDesc.trim());
      message.success(t('settings.federation.myFederations.created'));
      setShowCreate(false);
      setCreateName('');
      setCreateDesc('');
    } catch (e: unknown) {
      message.error((e as { message?: string })?.message || 'Failed to create federation');
    } finally {
      setActionLoading(false);
    }
  };

  const handleJoin = async () => {
    if ((!joinEndpoint.trim() && !joinFedId.trim()) || actionLoading) return;
    setActionLoading(true);
    try {
      await joinFederation({
        federationEndpoint: joinEndpoint.trim(),
        federationId: joinFedId.trim(),
        message: joinMsg.trim(),
      });
      message.success(t('settings.federation.myFederations.joined'));
      setShowJoin(false);
      setJoinEndpoint('');
      setJoinFedId('');
      setJoinMsg('');
    } catch (e: unknown) {
      message.error((e as { message?: string })?.message || 'Failed to join federation');
    } finally {
      setActionLoading(false);
    }
  };

  const handleLeave = (fed: FederationSummary) => {
    Modal.confirm({
      title: t('settings.federation.myFederations.leave'),
      content: t('settings.federation.myFederations.leaveConfirm', { name: fed.name }),
      okType: 'danger',
      onOk: async () => {
        try {
          await leaveFederation(fed.federationId);
          message.success(t('settings.federation.myFederations.left'));
        } catch (e: unknown) {
          message.error((e as { message?: string })?.message || 'Failed to leave federation');
        }
      },
    });
  };

  const handleDelete = (fed: FederationSummary) => {
    Modal.confirm({
      title: t('settings.federation.myFederations.delete', { defaultValue: 'Delete Federation' }),
      content: t('settings.federation.myFederations.deleteConfirm', { name: fed.name, defaultValue: `Are you sure you want to permanently delete "${fed.name}"? This action cannot be undone.` }),
      okType: 'danger',
      onOk: async () => {
        try {
          await deleteFederation(fed.federationId);
          message.success(t('settings.federation.myFederations.deleted', { defaultValue: 'Federation deleted' }));
        } catch (e: unknown) {
          message.error((e as { message?: string })?.message || 'Failed to delete federation');
        }
      },
    });
  };

  const handleCopyInvite = (fed: FederationSummary) => {
    const link = buildInviteLink(fed.federationId, fed.name, self?.homeStationDomain ?? '');
    navigator.clipboard.writeText(link);
    message.success(t('settings.federation.invite.copied'));
  };

  const handleInviteLinkChange = (value: string) => {
    setJoinInviteLink(value);
    const parsed = parseInviteLink(value);
    if (parsed) {
      setJoinEndpoint(parsed.endpoint);
      setJoinFedId(parsed.federationId);
    }
  };

  const peersInRoutingTable = health?.peersInRoutingTable ?? 0;
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

      {/* ─── Basic Info (identity + health + discovery merged) ───── */}
      <SettingsSection
        icon={<Globe size={18} />}
        title={t('settings.federation.basicInfo.title', { defaultValue: 'Basic Info' })}
        subtitle={t('settings.federation.basicInfo.subtitle', { defaultValue: 'Your federation identity, routing status, and discovery settings.' })}
      >
        <SettingsItemCard>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: 13 }}>
            <div>
              <Text type="secondary" style={{ fontSize: 11 }}>{t('settings.federation.identity.handle')}</Text>
              <div>
                {username ? (
                  <FederatedHandle localPart={username} home={homeStation} fontSize={13} />
                ) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>—</Text>
                )}
              </div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 11 }}>{t('settings.federation.identity.homeStation')}</Text>
              <div><Text style={{ fontSize: 13 }}>{homeStation || '—'}</Text></div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 11 }}>{t('settings.federation.identity.locatorSeq')}</Text>
              <div><Text code style={{ fontSize: 12 }}>{locatorSeq || '—'}</Text></div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 11 }}>{t('settings.federation.identity.relayMounts')}</Text>
              <Flexbox horizontal wrap="wrap" gap={4} style={{ marginTop: 2 }}>
                {relayMounts.length > 0 ? relayMounts.map((mount) => (
                  <Tag key={mount} style={{ fontSize: 11 }}>{mount}</Tag>
                )) : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>}
              </Flexbox>
            </div>
          </div>

          {/* Health status line */}
          <Flexbox
            horizontal
            align="center"
            gap={16}
            style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${token.colorBorderSecondary}`, fontSize: 13 }}
          >
            <Tag color={ready ? 'success' : 'warning'} style={{ margin: 0 }}>
              {ready ? t('settings.federation.health.ready') : t('settings.federation.health.joining')}
            </Tag>
            <Text type="secondary">
              <Text strong>{peersInRoutingTable}</Text> {t('settings.federation.health.peersInRoutingTable')}
            </Text>
            <Text type="secondary">
              {t('settings.federation.health.seedsConnected')} <Text strong>{seedsConnected}/{seedsConfigured}</Text>
            </Text>
          </Flexbox>

          {/* Discovery select */}
          <Flexbox
            horizontal
            align="center"
            justify="space-between"
            style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${token.colorBorderSecondary}` }}
          >
            <Flexbox gap={2}>
              <Flexbox horizontal align="center" gap={6}>
                <Text strong style={{ fontSize: 13 }}>{t('settings.federation.visibility.label')}</Text>
                <Tooltip title={t('settings.federation.visibility.tooltip')} placement="right">
                  <Info size={13} style={{ color: token.colorTextTertiary }} />
                </Tooltip>
              </Flexbox>
              <Text type="secondary" style={{ fontSize: 11 }}>{visibilityHint}</Text>
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

      {/* ─── My Federations ─────────────────────────────────────────── */}
      <SettingsSection
        icon={<Server size={18} />}
        title={t('settings.federation.myFederations.title')}
        subtitle={t('settings.federation.myFederations.subtitle')}
        extra={
          <Flexbox horizontal gap={6}>
            <Button
              type="text"
              size="small"
              icon={<Plus size={14} />}
              onClick={() => setShowCreate(true)}
            >
              {t('settings.federation.create.title')}
            </Button>
            <Button
              type="text"
              size="small"
              icon={<UserPlus size={14} />}
              onClick={() => setShowJoin(true)}
            >
              {t('settings.federation.join.title')}
            </Button>
          </Flexbox>
        }
      >
        {federations.length === 0 ? (
          <SettingsItemCard>
            <Text type="secondary" style={{ textAlign: 'center', padding: 16, display: 'block' }}>
              {t('settings.federation.myFederations.empty')}
            </Text>
          </SettingsItemCard>
        ) : (
          <Flexbox gap={8}>
            {federations.map((fed) => (
              <Card
                key={fed.federationId}
                size="small"
                style={{ borderColor: token.colorBorderSecondary }}
              >
                <Flexbox horizontal align="center" justify="space-between">
                  <Flexbox gap={2}>
                    <Flexbox horizontal align="center" gap={8}>
                      <Text strong style={{ fontSize: 13 }}>{fed.name}</Text>
                      <Tag color={fed.status === 'active' ? 'success' : 'warning'} style={{ fontSize: 11 }}>
                        {fed.status || 'active'}
                      </Tag>
                      {fed.myRole && (
                        <Tag style={{ fontSize: 11 }}>{fed.myRole}</Tag>
                      )}
                    </Flexbox>
                    <Flexbox horizontal gap={12}>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {t('settings.federation.myFederations.members', { count: fed.memberStationCount })}
                      </Text>
                      {fed.description && (
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {fed.description}
                        </Text>
                      )}
                    </Flexbox>
                  </Flexbox>
                  <Flexbox horizontal gap={4}>
                    <Tooltip title={t('settings.federation.invite.copy')}>
                      <Button
                        type="text"
                        size="small"
                        icon={<Copy size={13} />}
                        onClick={() => handleCopyInvite(fed)}
                      />
                    </Tooltip>
                    {fed.myRole === 'federation_owner' ? (
                      <Tooltip title={t('settings.federation.myFederations.delete', { defaultValue: 'Delete Federation' })}>
                        <Button
                          type="text"
                          danger
                          size="small"
                          icon={<Trash2 size={13} />}
                          onClick={() => handleDelete(fed)}
                        />
                      </Tooltip>
                    ) : (
                      <Button
                        type="text"
                        danger
                        size="small"
                        onClick={() => handleLeave(fed)}
                      >
                        {t('settings.federation.myFederations.leave')}
                      </Button>
                    )}
                  </Flexbox>
                </Flexbox>
              </Card>
            ))}
          </Flexbox>
        )}
      </SettingsSection>

      {/* Create Federation Modal */}
      <Modal
        title={t('settings.federation.create.title')}
        open={showCreate}
        onCancel={() => setShowCreate(false)}
        onOk={handleCreate}
        okText={t('settings.federation.create.submit')}
        confirmLoading={actionLoading}
        okButtonProps={{ disabled: !createName.trim() }}
        destroyOnHidden
      >
        <Flexbox gap={12} style={{ paddingTop: 8 }}>
          <Input
            placeholder={t('settings.federation.create.namePlaceholder')}
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onPressEnter={handleCreate}
            maxLength={64}
            showCount
          />
          <Input.TextArea
            placeholder={t('settings.federation.create.descriptionPlaceholder')}
            value={createDesc}
            onChange={(e) => setCreateDesc(e.target.value)}
            rows={2}
          />
        </Flexbox>
      </Modal>

      {/* Join Federation Modal */}
      <Modal
        title={t('settings.federation.join.title')}
        open={showJoin}
        onCancel={() => { setShowJoin(false); setJoinInviteLink(''); }}
        onOk={handleJoin}
        okText={t('settings.federation.join.submit')}
        confirmLoading={actionLoading}
        okButtonProps={{ disabled: !joinEndpoint.trim() && !joinFedId.trim() }}
        destroyOnHidden
      >
        <Flexbox gap={12} style={{ paddingTop: 8 }}>
          <Input
            placeholder={t('settings.federation.invite.pastePlaceholder')}
            value={joinInviteLink}
            onChange={(e) => handleInviteLinkChange(e.target.value)}
            prefix={<Link2 size={13} style={{ color: token.colorTextQuaternary }} />}
            allowClear
          />
          {!joinInviteLink && (
            <Text type="secondary" style={{ fontSize: 11, textAlign: 'center' }}>
              {t('settings.federation.invite.orManual')}
            </Text>
          )}
          <Input
            placeholder={t('settings.federation.join.endpointPlaceholder')}
            value={joinEndpoint}
            onChange={(e) => setJoinEndpoint(e.target.value)}
            addonBefore={t('settings.federation.join.endpoint')}
          />
          <Input
            placeholder={t('settings.federation.join.federationIdPlaceholder')}
            value={joinFedId}
            onChange={(e) => setJoinFedId(e.target.value)}
            addonBefore={t('settings.federation.join.federationId')}
          />
          <Input.TextArea
            placeholder={t('settings.federation.join.messagePlaceholder')}
            value={joinMsg}
            onChange={(e) => setJoinMsg(e.target.value)}
            rows={2}
          />
        </Flexbox>
      </Modal>
    </SettingsContainer>
  );
}
