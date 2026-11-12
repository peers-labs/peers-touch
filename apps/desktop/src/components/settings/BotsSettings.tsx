import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  ConfirmAction,
  DataTable,
  Dialog,
  Empty,
  Icon,
  IconButton,
  Select,
  Spin,
  Switch,
  Tag,
  Text,
  TextField,
  Tooltip,
  type TableColumn,
} from '@peers-touch/ui';

import {
  api,
  type Agent,
  type RegistryBot,
  type BotCreateResponse,
} from '../../services/desktop_api';
import { useSocialChatStore } from '../../store/socialChat';
import { canonicalProfileAvatar } from '../../store/socialProfileProjection';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import {
  SettingsContainer,
  SettingsSection,
  SettingsPanelHeader,
} from './SettingsLayout';
import { notifyError, notifySuccess } from '../../ui/feedback';

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
  // projected into the social profile store.
  const profile = useSocialChatStore((s) => s.peerProfiles[bot.botPtid] ?? null);
  const loadPeerProfile = useSocialChatStore((s) => s.loadPeerProfile);
  useEffect(() => {
    void loadPeerProfile(bot.botPtid);
  }, [bot.botPtid, loadPeerProfile]);

  return (
    <UserSquareAvatar
      remoteUrl={profile ? canonicalProfileAvatar(profile) || undefined : undefined}
      actorPtid={bot.botPtid}
      name={bot.name}
      size={36}
    />
  );
}

function CredentialReveal({
  open,
  title,
  response,
  onClose,
}: {
  open: boolean;
  title: string;
  response: BotCreateResponse | { secret: string; ingressUrl?: string; bot?: RegistryBot };
  onClose: () => void;
}) {
  const { t } = useTranslation('settings');
  const tt = useMemo(() => tr(t), [t]);
  const secret = response.secret;
  const ingressUrl = 'ingressUrl' in response ? response.ingressUrl : '';

  const curlSnippet = useMemo(() => {
    if (!ingressUrl) return '';
    return `curl -X POST "$STATION_ORIGIN${ingressUrl}" \\
  -H "Authorization: Bearer ${secret}" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: <unique-id>" \\
  --data '{"content":{"text":{"text":"Build passed"}},"source_context":{"program":"ci"}}'`;
  }, [ingressUrl, secret]);

  const copy = (value: string) => {
    navigator.clipboard?.writeText(value).then(
      () => notifySuccess(tt('settings.bots.copied', 'Copied')),
      () => notifyError(tt('settings.bots.copyFailed', 'Copy failed')),
    );
  };

  return (
    <Dialog
      open={open}
      onDismiss={onClose}
      title={title}
      width={560}
      footer={
        <Button
          actionId="bot-credential-done"
          emphasis="primary"
          label={tt('settings.bots.savedDone', 'I saved it, done')}
          onActivate={onClose}
        />
      }
    >
      <div className="sc-bots-credential">
        {ingressUrl && (
          <div className="sc-bots-credential__field">
            <Text tone="secondary" style={{ fontSize: 12 }}>
              {tt('settings.bots.ingressUrl', 'Message ingress URL (path)')}
            </Text>
            <div className="sc-bots-copy-row">
              <TextField readOnly value={ingressUrl} />
              <IconButton
                actionId="bot-copy-ingress"
                iconId="copy"
                iconSize={14}
                density="compact"
                label={tt('settings.bots.copy', 'Copy')}
                onActivate={() => copy(ingressUrl)}
              />
            </div>
          </div>
        )}
        <div className="sc-bots-credential__field">
          <Text tone="secondary" style={{ fontSize: 12 }}>
            {tt('settings.bots.secretOnce', 'Secret — shown only once')}
          </Text>
          <div className="sc-bots-copy-row">
            <TextField type="password" readOnly value={secret} />
            <IconButton
              actionId="bot-copy-secret"
              iconId="copy"
              iconSize={14}
              density="compact"
              label={tt('settings.bots.copy', 'Copy')}
              onActivate={() => copy(secret)}
            />
          </div>
        </div>
        {curlSnippet && (
          <div className="sc-bots-credential__field">
            <Text tone="secondary" style={{ fontSize: 12 }}>
              {tt('settings.bots.curlSnippet', 'Quick test (curl)')}
            </Text>
            <pre className="sc-bots-curl">{curlSnippet}</pre>
          </div>
        )}
      </div>
    </Dialog>
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
  const [rotated, setRotated] = useState<{ secret: string } | null>(null);
  const [busyPtid, setBusyPtid] = useState<string | null>(null);
  const [rotateOpen, setRotateOpen] = useState(false);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [bindingBot, setBindingBot] = useState<RegistryBot | null>(null);
  const [draftAgentId, setDraftAgentId] = useState<string>('');
  const [draftEnabled, setDraftEnabled] = useState(true);
  const [bindingSaving, setBindingSaving] = useState(false);

  const agentNameById = useCallback(
    (agentId: string) => {
      const match = agents.find((item) => item.id === agentId);
      return match?.title || match?.name || agentId;
    },
    [agents],
  );

  useEffect(() => {
    api.listAgents().then(setAgents).catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await api.botList();
      setBots(resp.bots ?? []);
    } catch (error) {
      notifyError((error as Error)?.message || 'bot_list failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
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
      notifyError((error as Error)?.message || 'bot_create failed');
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
      notifyError((error as Error)?.message || 'bot_set_state failed');
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
      setRotateOpen(false);
    } catch (error) {
      notifyError((error as Error)?.message || 'bot_rotate_secret failed');
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
      notifySuccess(tt('settings.bots.avatarUpdated', 'Avatar updated'));
    } catch (error) {
      notifyError((error as Error)?.message || 'bot_set_profile failed');
    } finally {
      setBusyPtid(null);
    }
  };

  const openBinding = (bot: RegistryBot) => {
    setBindingBot(bot);
    setDraftAgentId(bot.agentBinding?.agentId ?? '');
    setDraftEnabled(bot.agentBinding?.enabled ?? true);
  };

  const closeBinding = () => {
    if (bindingSaving) return;
    setBindingBot(null);
  };

  const saveBinding = async () => {
    if (!bindingBot || !draftAgentId.trim() || bindingSaving) return;
    setBindingSaving(true);
    try {
      await api.botAgentBindingSet(
        bindingBot.botPtid,
        draftAgentId.trim(),
        draftEnabled,
        bindingBot.agentBinding?.version ?? 0,
      );
      notifySuccess(tt('settings.bots.bindingSaved', 'Binding saved'));
      setBindingBot(null);
      await refresh();
    } catch (error) {
      notifyError((error as Error)?.message || 'bot_agent_binding_set failed');
    } finally {
      setBindingSaving(false);
    }
  };

  const unbind = async () => {
    if (!bindingBot?.agentBinding || bindingSaving) return;
    setBindingSaving(true);
    try {
      await api.botAgentBindingDelete(
        bindingBot.botPtid,
        bindingBot.agentBinding.version,
      );
      notifySuccess(tt('settings.bots.bindingDeleted', 'Binding removed'));
      setBindingBot(null);
      await refresh();
    } catch (error) {
      notifyError((error as Error)?.message || 'bot_agent_binding_delete failed');
    } finally {
      setBindingSaving(false);
    }
  };

  const stateTag = (state: number) => {
    if (state === STATE.ACTIVE) return <Tag tone="success">{tt('settings.bots.stateActive', 'Active')}</Tag>;
    if (state === STATE.DISABLED) return <Tag>{tt('settings.bots.stateDisabled', 'Disabled')}</Tag>;
    if (state === STATE.REVOKED) return <Tag tone="danger">{tt('settings.bots.stateRevoked', 'Revoked')}</Tag>;
    return <Tag>{state}</Tag>;
  };

  const columns: TableColumn<RegistryBot>[] = [
    {
      id: 'name',
      label: tt('settings.bots.colBot', 'Bot'),
      renderCell: (bot) => (
        <span className="sc-bots-cell">
          <BotAvatar bot={bot} />
          <span className="sc-bots-cell__stack">
            <Text strong>{bot.name}</Text>
            <Text tone="muted" className="sc-bots-cell__sub">{bot.publishingId}</Text>
          </span>
        </span>
      ),
    },
    {
      id: 'state',
      label: tt('settings.bots.colState', 'State'),
      renderCell: (bot) => stateTag(bot.state),
    },
    {
      // This is the enforced publishing rate-limit ceiling, not observed traffic.
      id: 'rateLimitPerMinute',
      label: tt('settings.bots.colRateLimit', 'Rate limit/min'),
      width: 120,
      renderCell: (bot) => bot.rateLimitPerMinute,
    },
    {
      id: 'agentBinding',
      label: tt('settings.bots.colAgent', 'Agent'),
      width: 220,
      renderCell: (bot) => {
        const binding = bot.agentBinding;
        return (
          <span className="sc-bots-cell">
            {binding ? (
              <span className="sc-bots-cell__stack">
                <Text style={{ fontSize: 13 }}>{agentNameById(binding.agentId)}</Text>
                {binding.enabled ? (
                  <Text tone="muted" className="sc-bots-cell__sub">
                    {tt('settings.bots.bindingActive', 'Auto-reply on')}
                  </Text>
                ) : (
                  <Tag>{tt('settings.bots.bindingPaused', 'Paused')}</Tag>
                )}
              </span>
            ) : (
              <Text tone="secondary" style={{ fontSize: 12 }}>
                {tt('settings.bots.bindingNone', 'Receive only')}
              </Text>
            )}
            <Tooltip label={tt('settings.bots.configureBinding', 'Configure Agent binding')}>
              <IconButton
                actionId={`bot-bind-${bot.botPtid}`}
                iconId="link-2"
                iconSize={15}
                density="compact"
                emphasis="quiet"
                label={tt('settings.bots.configureBinding', 'Configure Agent binding')}
                availability={bot.state === STATE.REVOKED || busyPtid === bot.botPtid
                  ? { kind: 'disabled', reason: '' }
                  : undefined}
                onActivate={() => openBinding(bot)}
              />
            </Tooltip>
          </span>
        );
      },
    },
    {
      id: 'actions',
      label: tt('settings.bots.colActions', 'Actions'),
      width: 170,
      renderCell: (bot) => {
        const revoked = bot.state === STATE.REVOKED;
        const active = bot.state === STATE.ACTIVE;
        const rowBusy = busyPtid === bot.botPtid;
        const unavailable = revoked || rowBusy;
        const availability = unavailable
          ? { kind: 'disabled' as const, reason: '' }
          : undefined;
        return (
          <span className="sc-bots-actions">
            <Tooltip label={tt('settings.bots.changeAvatar', 'Change avatar')}>
              <IconButton
                actionId={`bot-avatar-${bot.botPtid}`}
                iconId="camera"
                iconSize={15}
                density="compact"
                emphasis="quiet"
                label={tt('settings.bots.changeAvatar', 'Change avatar')}
                availability={availability}
                onActivate={() => void changeAvatar(bot)}
              />
            </Tooltip>
            <Tooltip label={tt('settings.bots.rotateSecret', 'Rotate secret')}>
              <IconButton
                actionId={`bot-rotate-open-${bot.botPtid}`}
                iconId="key-round"
                iconSize={15}
                density="compact"
                emphasis="quiet"
                label={tt('settings.bots.rotateSecret', 'Rotate secret')}
                availability={availability}
                onActivate={() => { setRotatingFor(bot); setRotateOpen(true); }}
              />
            </Tooltip>
            {active ? (
              <Tooltip label={tt('settings.bots.disable', 'Disable')}>
                <IconButton
                  actionId={`bot-disable-${bot.botPtid}`}
                  iconId="pause"
                  iconSize={15}
                  density="compact"
                  emphasis="quiet"
                  label={tt('settings.bots.disable', 'Disable')}
                  availability={availability}
                  onActivate={() => void changeState(bot, STATE.DISABLED)}
                />
              </Tooltip>
            ) : (
              !revoked && (
                <Tooltip label={tt('settings.bots.enable', 'Enable')}>
                  <IconButton
                    actionId={`bot-enable-${bot.botPtid}`}
                    iconId="play"
                    iconSize={15}
                    density="compact"
                    emphasis="quiet"
                    label={tt('settings.bots.enable', 'Enable')}
                    availability={rowBusy ? { kind: 'disabled' as const, reason: '' } : undefined}
                    onActivate={() => void changeState(bot, STATE.ACTIVE)}
                  />
                </Tooltip>
              )
            )}
            {!revoked && (
              <ConfirmAction
                actionId={`bot-revoke-${bot.botPtid}`}
                title={tt('settings.bots.revokeConfirm', 'Revoke this bot? Its secret is cleared and this cannot be undone.')}
                confirmLabel={tt('settings.bots.revoke', 'Revoke')}
                cancelLabel={tt('common.cancel', 'Cancel')}
                onConfirm={() => changeState(bot, STATE.REVOKED)}
              >
                <IconButton
                  actionId={`bot-revoke-trigger-${bot.botPtid}`}
                  iconId="delete"
                  iconSize={15}
                  density="compact"
                  emphasis="quiet"
                  className="sc-bots-actions__danger"
                  label={tt('settings.bots.revoke', 'Revoke')}
                  availability={rowBusy ? { kind: 'disabled' as const, reason: '' } : undefined}
                />
              </ConfirmAction>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <SettingsContainer fullHeight tier="wide">
      <SettingsPanelHeader
        icon={<Icon iconId="bot" size={20} />}
        title={tt('settings.bots.title', 'Bots')}
        actions={
          <span className="sc-bots-header-actions">
            <Button
              actionId="bots-refresh"
              leading={<Icon iconId="refresh-cw" size={14} />}
              execution={loading ? 'pending' : 'idle'}
              label={tt('common.refresh', 'Refresh')}
              onActivate={() => void refresh()}
            />
            <Button
              actionId="bots-create-open"
              emphasis="primary"
              leading={<Icon iconId="plus" size={14} />}
              label={tt('settings.bots.create', 'Create bot')}
              onActivate={() => {
                setCreated(null);
                setCreateOpen(true);
              }}
            />
          </span>
        }
      />

      <SettingsSection
        icon={<Icon iconId="bot" size={18} />}
        title={tt('settings.bots.sectionTitle', 'Your bots')}
      >
        <Text tone="secondary" className="sc-bots-intro">
          {tt(
            'settings.bots.intro',
            'Bots are automated actors backed by the common message publishing channel.',
          )}
        </Text>
        {bots.length === 0 && !loading ? (
          <div className="sc-bots-empty">
            <Empty
              icon={<Icon iconId="bot" size={40} />}
              description={tt('settings.bots.empty', 'No bots yet')}
            />
          </div>
        ) : (
          <Spin active={loading}>
            <DataTable
              rows={bots}
              columns={columns}
              rowKey="botPtid"
            />
          </Spin>
        )}
      </SettingsSection>

      <Dialog
        open={createOpen}
        onDismiss={() => setCreateOpen(false)}
        title={tt('settings.bots.createTitle', 'Create a bot')}
        footer={
          <>
            <Button
              actionId="bots-create-cancel"
              label={tt('common.cancel', 'Cancel')}
              onActivate={() => setCreateOpen(false)}
            />
            <Button
              actionId="bots-create-submit"
              emphasis="primary"
              execution={creating ? 'pending' : 'idle'}
              label={tt('settings.bots.generate', 'Generate channel & secret')}
              availability={!name.trim()
                ? { kind: 'disabled', reason: tt('settings.bots.namePlaceholder', 'Bot name, e.g. Claude Code') }
                : undefined}
              onActivate={() => void submitCreate()}
            />
          </>
        }
      >
        <div className="sc-bots-form">
          <TextField
            autoFocus
            placeholder={tt('settings.bots.namePlaceholder', 'Bot name, e.g. Claude Code')}
            value={name}
            onValueChange={setName}
            onEnter={() => void submitCreate()}
          />
          <div className="sc-bots-form__avatar">
            <Button
              actionId="bots-pick-avatar"
              leading={<Icon iconId="upload" size={14} />}
              label={avatarPath
                ? tt('settings.bots.avatarSelected', 'Avatar selected')
                : tt('settings.bots.optionalAvatar', 'Avatar (optional)')}
              onActivate={() => void pickAvatar()}
            />
            {avatarPath && (
              <Text tone="success" style={{ fontSize: 12 }}>{avatarPath.split(/[\\/]/).pop()}</Text>
            )}
          </div>
        </div>
      </Dialog>

      {created && (
        <CredentialReveal
          open
          title={tt('settings.bots.credentialsTitle', 'Bot credentials')}
          response={created}
          onClose={() => setCreated(null)}
        />
      )}

      <Dialog
        open={rotateOpen}
        onDismiss={() => { setRotateOpen(false); setRotatingFor(null); }}
        title={tt('settings.bots.rotateTitle', 'Rotate secret')}
        footer={
          <>
            <Button
              actionId="bots-rotate-cancel"
              label={tt('common.cancel', 'Cancel')}
              onActivate={() => { setRotateOpen(false); setRotatingFor(null); }}
            />
            <Button
              actionId="bots-rotate-confirm"
              tone="danger"
              emphasis="primary"
              execution={busyPtid === rotatingFor?.botPtid ? 'pending' : 'idle'}
              label={tt('settings.bots.rotateConfirm', 'Rotate now')}
              onActivate={() => void rotate()}
            />
          </>
        }
      >
        <Text>
          {tt('settings.bots.rotateWarn', 'This invalidates the current secret immediately.')}
          {rotatingFor ? ` (${rotatingFor.name})` : ''}
        </Text>
      </Dialog>

      {rotated && (
        <CredentialReveal
          open
          title={tt('settings.bots.newSecretTitle', 'New secret')}
          response={{ secret: rotated.secret }}
          onClose={() => setRotated(null)}
        />
      )}

      <Dialog
        open={!!bindingBot}
        onDismiss={closeBinding}
        title={tt('settings.bots.bindingTitle', 'Bind Agent')}
        footer={
          <div className="sc-bots-binding-footer">
            <span>
              {bindingBot?.agentBinding && (
                <ConfirmAction
                  actionId="bots-unbind-confirm"
                  title={tt(
                    'settings.bots.unbindConfirm',
                    'Unbind this Agent? Inbound messages will no longer trigger replies.',
                  )}
                  confirmLabel={tt('settings.bots.unbind', 'Unbind')}
                  cancelLabel={tt('common.cancel', 'Cancel')}
                  onConfirm={() => void unbind()}
                >
                  <Button
                    actionId="bots-unbind-trigger"
                    tone="danger"
                    leading={<Icon iconId="unplug" size={14} />}
                    execution={bindingSaving ? 'pending' : 'idle'}
                    label={tt('settings.bots.unbind', 'Unbind')}
                  />
                </ConfirmAction>
              )}
            </span>
            <span className="sc-bots-binding-footer__right">
              <Button
                actionId="bots-bind-cancel"
                label={tt('common.cancel', 'Cancel')}
                onActivate={closeBinding}
              />
              <Button
                actionId="bots-bind-save"
                emphasis="primary"
                execution={bindingSaving ? 'pending' : 'idle'}
                label={tt('settings.bots.save', 'Save')}
                availability={!draftAgentId.trim()
                  ? { kind: 'disabled', reason: tt('settings.bots.bindingAgentPlaceholder', 'Select an Agent') }
                  : undefined}
                onActivate={() => void saveBinding()}
              />
            </span>
          </div>
        }
      >
        {bindingBot && (
          <div className="sc-bots-binding">
            <Text tone="secondary" style={{ fontSize: 12 }}>
              {tt(
                'settings.bots.bindingIntro',
                'Inbound publishing messages run the selected Agent; its reply is published as this bot. No binding means the bot only receives messages.',
              )}
            </Text>
            <div className="sc-bots-binding__field">
              <Text tone="secondary" style={{ fontSize: 12 }}>
                {tt('settings.bots.bindingAgent', 'Agent')}
              </Text>
              <Select
                searchable
                style={{ width: '100%' }}
                placeholder={tt('settings.bots.bindingAgentPlaceholder', 'Select an Agent')}
                value={draftAgentId || undefined}
                options={agents.map((agent) => ({
                  label: agent.title || agent.name || agent.id,
                  value: agent.id,
                }))}
                onValueChange={(value) => {
                  if (typeof value === 'string') setDraftAgentId(value);
                }}
              />
            </div>
            <div className="sc-bots-binding__field">
              <span className="sc-bots-binding__switch">
                <Switch checked={draftEnabled} onCheckedChange={setDraftEnabled} />
                <Text>{tt('settings.bots.bindingEnabled', 'Automatic replies')}</Text>
              </span>
              <Text tone="secondary" style={{ fontSize: 12 }}>
                {tt(
                  'settings.bots.bindingEnabledHint',
                  'Pause the switch to keep the binding but stop replies immediately.',
                )}
              </Text>
            </div>
          </div>
        )}
      </Dialog>
    </SettingsContainer>
  );
}
