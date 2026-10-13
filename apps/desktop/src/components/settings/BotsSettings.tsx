import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { Bot, Copy, KeyRound, Pause, Play, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';

import { api, type RegistryBot, type BotCreateResponse } from '../../services/desktop_api';
import { useSocialChatStore } from '../../store/socialChat';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import {
  SettingsContainer,
  SettingsSection,
  SettingsPanelHeader,
} from './SettingsLayout';

const { Text, Paragraph } = Typography;

// Mirrors model/domain/bot/bot.proto BotState.
const STATE = {
  ACTIVE: 2,
  DISABLED: 3,
  REVOKED: 4,
} as const;

const tr = (t: (k: string, o?: Record<string, unknown>) => string) =>
  (k: string, fallback: string, o?: Record<string, unknown>) =>
    t(k, { defaultValue: fallback, ...(o ?? {}) });

function BotAvatar({ bot }: { bot: RegistryBot }) {
  // Single source of truth: the bot avatar lives on the AGENT actor and is
  // projected into the social profile store. The realtime actor_profile_changed
  // wake force-refreshes it, so an owner editing the avatar converges here and
  // in chat immediately without a component-local fetch or bust counter.
  const profile = useSocialChatStore((s) => s.peerProfiles[bot.botPtid] ?? null);
  const loadPeerProfile = useSocialChatStore((s) => s.loadPeerProfile);
  useEffect(() => {
    void loadPeerProfile(bot.botPtid);
  }, [bot.botPtid, loadPeerProfile]);

  return <UserSquareAvatar remoteUrl={profile?.avatar || undefined} name={bot.name} size={36} />;
}

function CredentialReveal({
  open,
  title,
  response,
  onClose,
}: {
  open: boolean;
  title: string;
  response: BotCreateResponse | { secretPlaintext: string; webhookUrl?: string; bot?: RegistryBot };
  onClose: () => void;
}) {
  const { t } = useTranslation('settings');
  const tt = useMemo(() => tr(t), [t]);
  const secret = response.secretPlaintext;
  const webhookUrl = 'webhookUrl' in response ? response.webhookUrl : '';

  const curlSnippet = useMemo(() => {
    if (!webhookUrl) return '';
    return `curl -X POST "$STATION_ORIGIN${webhookUrl}" \\
  -H "Authorization: Bearer ${secret}" \\
  -H "Content-Type: application/json" \\
  --data '{"schema_version":"1","request_id":"<unique-id>","event_type":"BOT_EVENT_TYPE_TASK_COMPLETED","title":"Build passed"}'`;
  }, [secret, webhookUrl]);

  const copy = (value: string) => {
    navigator.clipboard?.writeText(value).then(
      () => message.success(tt('settings.bots.copied', 'Copied')),
      () => message.error(tt('settings.bots.copyFailed', 'Copy failed')),
    );
  };

  return (
    <Modal
      open={open}
      title={title}
      onCancel={onClose}
      width={560}
      footer={
        <Button type="primary" onClick={onClose}>
          {tt('settings.bots.savedDone', 'I saved it, done')}
        </Button>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        {webhookUrl && (
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {tt('settings.bots.webhookUrl', 'Webhook URL (path)')}
            </Text>
            <Space.Compact style={{ width: '100%' }}>
              <Input readOnly value={webhookUrl} />
              <Button icon={<Copy size={14} />} onClick={() => copy(webhookUrl)} />
            </Space.Compact>
          </div>
        )}
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {tt('settings.bots.secretOnce', 'Secret — shown only once')}
          </Text>
          <Space.Compact style={{ width: '100%' }}>
            <Input.Password readOnly value={secret} />
            <Button icon={<Copy size={14} />} onClick={() => copy(secret)} />
          </Space.Compact>
        </div>
        {curlSnippet && (
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {tt('settings.bots.curlSnippet', 'Quick test (curl)')}
            </Text>
            <pre
              style={{
                background: 'var(--ant-color-fill-quaternary)',
                padding: 10,
                borderRadius: 8,
                fontSize: 11,
                overflowX: 'auto',
                whiteSpace: 'pre',
              }}
            >
              {curlSnippet}
            </pre>
          </div>
        )}
      </Space>
    </Modal>
  );
}

export function BotsSettings() {
  const { t } = useTranslation('settings');
  const tt = useMemo(() => tr(t), [t]);

  const [bots, setBots] = useState<RegistryBot[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [avatarPath, setAvatarPath] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<BotCreateResponse | null>(null);

  const [rotatingFor, setRotatingFor] = useState<RegistryBot | null>(null);
  const [rotated, setRotated] = useState<{ secretPlaintext: string } | null>(null);
  const [busyPtid, setBusyPtid] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await api.botList();
      setBots(resp.bots ?? []);
    } catch (error) {
      message.error((error as Error)?.message || 'bot_list failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const pickAvatar = async () => {
    const path = await api.pickImageFile();
    if (path) setAvatarPath(path);
  };

  const submitCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      let avatarUrl: string | undefined;
      if (avatarPath) {
        const uploaded = await api.botUploadAvatar(avatarPath);
        avatarUrl = uploaded.url || undefined;
      }
      const resp = await api.botCreate(name.trim(), avatarUrl);
      setCreated(resp);
      setCreateOpen(false);
      setName('');
      setAvatarPath('');
      await refresh();
    } catch (error) {
      message.error((error as Error)?.message || 'bot_create failed');
    } finally {
      setCreating(false);
    }
  };

  const changeState = async (bot: RegistryBot, target: number) => {
    setBusyPtid(bot.botPtid);
    try {
      await api.botSetState(bot.botPtid, target);
      await refresh();
    } catch (error) {
      message.error((error as Error)?.message || 'bot_set_state failed');
    } finally {
      setBusyPtid(null);
    }
  };

  const rotate = async () => {
    if (!rotatingFor) return;
    setBusyPtid(rotatingFor.botPtid);
    try {
      const resp = await api.botRotateSecret(rotatingFor.botPtid);
      setRotated(resp);
      setRotatingFor(null);
    } catch (error) {
      message.error((error as Error)?.message || 'bot_rotate_secret failed');
    } finally {
      setBusyPtid(null);
    }
  };

  const changeAvatar = async (bot: RegistryBot) => {
    const path = await api.pickImageFile();
    if (!path) return;
    setBusyPtid(bot.botPtid);
    try {
      const uploaded = await api.botUploadAvatar(path);
      await api.botSetProfile(bot.botPtid, uploaded.url);
      // The post-commit actor_profile_changed wake refreshes the single
      // peerProfiles projection (here and in chat); no local cache busting.
      message.success(tt('settings.bots.avatarUpdated', 'Avatar updated'));
    } catch (error) {
      message.error((error as Error)?.message || 'bot_set_profile failed');
    } finally {
      setBusyPtid(null);
    }
  };

  const stateTag = (state: number) => {
    if (state === STATE.ACTIVE) return <Tag color="success">{tt('settings.bots.stateActive', 'Active')}</Tag>;
    if (state === STATE.DISABLED) return <Tag>{tt('settings.bots.stateDisabled', 'Disabled')}</Tag>;
    if (state === STATE.REVOKED) return <Tag color="error">{tt('settings.bots.stateRevoked', 'Revoked')}</Tag>;
    return <Tag>{state}</Tag>;
  };

  const columns = [
    {
      title: tt('settings.bots.colBot', 'Bot'),
      dataIndex: 'name',
      render: (_: unknown, bot: RegistryBot) => (
        <Space>
          <BotAvatar bot={bot} />
          <Space direction="vertical" size={0}>
            <Text strong>{bot.name}</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>{bot.webhookId}</Text>
          </Space>
        </Space>
      ),
    },
    { title: tt('settings.bots.colState', 'State'), dataIndex: 'state', render: (s: number) => stateTag(s) },
    {
      title: tt('settings.bots.colRate', 'Rate/min'),
      dataIndex: 'rateLimitPerMinute',
      width: 90,
    },
    {
      title: tt('settings.bots.colActions', 'Actions'),
      key: 'actions',
      width: 170,
      render: (_: unknown, bot: RegistryBot) => {
        const revoked = bot.state === STATE.REVOKED;
        const active = bot.state === STATE.ACTIVE;
        return (
          <Space size={4}>
            <Tooltip title={tt('settings.bots.changeAvatar', 'Change avatar')}>
              <Button
                size="small"
                type="text"
                disabled={revoked || busyPtid === bot.botPtid}
                icon={<Upload size={15} />}
                onClick={() => changeAvatar(bot)}
              />
            </Tooltip>
            <Tooltip title={tt('settings.bots.rotateSecret', 'Rotate secret')}>
              <Button
                size="small"
                type="text"
                disabled={revoked || busyPtid === bot.botPtid}
                icon={<KeyRound size={15} />}
                onClick={() => setRotatingFor(bot)}
              />
            </Tooltip>
            {active ? (
              <Tooltip title={tt('settings.bots.disable', 'Disable')}>
                <Button
                  size="small"
                  type="text"
                  disabled={revoked || busyPtid === bot.botPtid}
                  icon={<Pause size={15} />}
                  onClick={() => changeState(bot, STATE.DISABLED)}
                />
              </Tooltip>
            ) : (
              !revoked && (
                <Tooltip title={tt('settings.bots.enable', 'Enable')}>
                  <Button
                    size="small"
                    type="text"
                    disabled={busyPtid === bot.botPtid}
                    icon={<Play size={15} />}
                    onClick={() => changeState(bot, STATE.ACTIVE)}
                  />
                </Tooltip>
              )
            )}
            {!revoked && (
              <Popconfirm
                title={tt('settings.bots.revokeConfirm', 'Revoke this bot? Its secret is cleared and this cannot be undone.')}
                okText={tt('settings.bots.revoke', 'Revoke')}
                okButtonProps={{ danger: true }}
                cancelText={tt('common.cancel', 'Cancel')}
                onConfirm={() => changeState(bot, STATE.REVOKED)}
              >
                <Button size="small" type="text" danger icon={<Trash2 size={15} />} disabled={busyPtid === bot.botPtid} />
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <SettingsContainer>
      <SettingsPanelHeader
        icon={<Bot size={20} />}
        title={tt('settings.bots.title', 'Bots')}
        actions={
          <Space>
            <Button icon={<RefreshCw size={14} />} onClick={refresh}>
              {tt('common.refresh', 'Refresh')}
            </Button>
            <Button
              type="primary"
              icon={<Plus size={14} />}
              onClick={() => {
                setCreated(null);
                setCreateOpen(true);
              }}
            >
              {tt('settings.bots.create', 'Create bot')}
            </Button>
          </Space>
        }
      />

      <SettingsSection
        icon={<Bot size={18} />}
        title={tt('settings.bots.sectionTitle', 'Your bots')}
      >
        <Paragraph type="secondary" style={{ marginTop: 0 }}>
          {tt(
            'settings.bots.intro',
            'Bots are automated actors that push webhook events into a private conversation with you.',
          )}
        </Paragraph>
        <Spin spinning={loading}>
          {bots.length === 0 && !loading ? (
            <Empty description={tt('settings.bots.empty', 'No bots yet')} />
          ) : (
            <Table
              rowKey="botPtid"
              size="middle"
              columns={columns}
              dataSource={bots}
              pagination={false}
            />
          )}
        </Spin>
      </SettingsSection>

      <Modal
        open={createOpen}
        title={tt('settings.bots.createTitle', 'Create a bot')}
        onCancel={() => setCreateOpen(false)}
        confirmLoading={creating}
        okText={tt('settings.bots.generate', 'Generate webhook & secret')}
        okButtonProps={{ disabled: !name.trim() }}
        onOk={submitCreate}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Input
            autoFocus
            placeholder={tt('settings.bots.namePlaceholder', 'Bot name, e.g. Claude Code')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Space>
            <Button icon={<Upload size={14} />} onClick={pickAvatar}>
              {avatarPath
                ? tt('settings.bots.avatarSelected', 'Avatar selected')
                : tt('settings.bots.optionalAvatar', 'Avatar (optional)')}
            </Button>
            {avatarPath && <Text type="success" style={{ fontSize: 12 }}>{avatarPath.split(/[\\/]/).pop()}</Text>}
          </Space>
        </Space>
      </Modal>

      {created && (
        <CredentialReveal
          open
          title={tt('settings.bots.credentialsTitle', 'Bot credentials')}
          response={created}
          onClose={() => setCreated(null)}
        />
      )}

      <Modal
        open={!!rotatingFor}
        title={tt('settings.bots.rotateTitle', 'Rotate secret')}
        onCancel={() => setRotatingFor(null)}
        confirmLoading={busyPtid === rotatingFor?.botPtid}
        okText={tt('settings.bots.rotateConfirm', 'Rotate now')}
        okButtonProps={{ danger: true }}
        onOk={rotate}
      >
        <Text>
          {tt('settings.bots.rotateWarn', 'This invalidates the current secret immediately.')}
          {rotatingFor ? ` (${rotatingFor.name})` : ''}
        </Text>
      </Modal>

      {rotated && (
        <CredentialReveal
          open
          title={tt('settings.bots.newSecretTitle', 'New secret')}
          response={{ secretPlaintext: rotated.secretPlaintext }}
          onClose={() => setRotated(null)}
        />
      )}
    </SettingsContainer>
  );
}
