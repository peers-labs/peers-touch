import { useMemo, useRef, useState } from 'react';
import { Button, Dialog, IconButton, Select, TextArea } from '@peers-touch/ui';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  FileKey,
  HeartPulse,
  MessageSquareText,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Route,
  Settings2,
  ShieldCheck,
  Trash2,
  UserRound,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { channelActions } from '../../../services/channelActions';
import type {
  Agent,
  ChannelBindingInfo,
  ChannelMessageDelivery,
} from '../../../services/desktop_api';
import { useChannelStore } from '../../../store/channel';
import { useSettingsStore } from '../../../store/settings';
import {
  ChannelManagementPanels,
  type ChannelManagementPanel,
} from './ChannelManagementPanels';
import {
  ChannelAgentMark,
  ChannelStatus,
} from './ChannelPrimitives';
import { channelAgentLabel } from './channelLabels';
import { ChannelProvisioningPanel } from './ChannelProvisioningPanel';
import {
  newChannelCreationDraft,
  useChannelDrafts,
} from './channelDrafts';
import './LarkChannelsSettings.css';

function IntentRow({
  icon: Icon,
  title,
  description,
  value,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  value?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="pt-channel-intent-row" onClick={onClick}>
      <span className="pt-channel-row-icon"><Icon size={17} /></span>
      <span className="pt-channel-row-copy">
        <b>{title}</b>
        <small>{description}</small>
      </span>
      {value ? <span className="pt-channel-row-value">{value}</span> : null}
      <ChevronRight size={17} aria-hidden="true" />
    </button>
  );
}

function Collection({
  bindings,
  agents,
  loading,
  error,
  onSelect,
  onCreate,
  onRetry,
}: {
  bindings: ChannelBindingInfo[];
  agents: Agent[];
  loading: boolean;
  error: string | null;
  onSelect: (bindingId: string) => void;
  onCreate: (source: HTMLElement) => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation('channels');
  const errorMessage = error === 'channels.binding.listFailed'
    ? t(error, {
      defaultValue: "Couldn't load connections. Retrying automatically.",
    })
    : error ?? '';
  if (loading && bindings.length === 0) {
    return (
      <main className="pt-channel-main pt-channel-loading">
        <RefreshCw className="is-spinning" size={20} />
        <span>{t('channels.v2.loading')}</span>
      </main>
    );
  }
  if (error && bindings.length === 0) {
    return (
      <main className="pt-channel-main pt-channel-load-error">
        <CircleAlert size={24} />
        <h2>{t('channels.v2.loadError.title')}</h2>
        <p>{errorMessage}</p>
        <Button
          actionId="channel-load-retry"
          emphasis="primary"
          density="compact"
          leading={<RefreshCw size={15} />}
          label={t('channels.v2.loadError.retry')}
          onActivate={onRetry}
        />
      </main>
    );
  }
  if (bindings.length === 0) {
    return (
      <main className="pt-channel-main pt-channel-empty">
        <span className="pt-channel-lark-mark"><MessageSquareText size={28} /></span>
        <h2>{t('channels.v2.empty.title')}</h2>
        <p>{t('channels.v2.empty.description')}</p>
        <Button
          actionId="channel-create"
          emphasis="primary"
          density="compact"
          trailing={<ArrowRight size={16} />}
          label={t('channels.v2.empty.action')}
          onActivate={(event) => onCreate(event.currentTarget)}
        />
        {error ? <p className="pt-channel-error" role="alert">{errorMessage}</p> : null}
      </main>
    );
  }
  return (
    <main className="pt-channel-main">
      <header className="pt-channel-collection-title">
        <div>
          <span className="pt-channel-kicker">{t('channels.v2.collection.kicker')}</span>
          <h2>{t('channels.v2.collection.title', { count: bindings.length })}</h2>
          <p>{t('channels.v2.collection.description')}</p>
        </div>
      </header>
      {error ? (
        <div className="pt-channel-notice is-warning" role="alert">
          <CircleAlert size={16} />
          <span>{errorMessage}</span>
        </div>
      ) : null}
      <div className="pt-channel-connections">
        {bindings.map((binding) => (
          <button
            type="button"
            className="pt-channel-connection-row"
            key={binding.bindingId}
            onClick={() => onSelect(binding.bindingId)}
          >
            <span className="pt-channel-lark-mark is-row">
              <MessageSquareText size={18} />
            </span>
            <span className="pt-channel-row-copy">
              <span>
                <b>{binding.name}</b>
                {binding.isDefault ? <em>{t('channels.v2.default')}</em> : null}
              </span>
              <small>
                {binding.appMode === 'custom'
                  ? t('channels.v2.customApp')
                  : t('channels.v2.managedApp')}
                {' · '}
                {binding.agentId
                  ? t('channels.v2.collection.responder', {
                    name: channelAgentLabel(agents, binding.agentId),
                  })
                  : t('channels.v2.collection.noResponder')}
              </small>
            </span>
            <ChannelStatus binding={binding} />
            <ChevronRight size={17} aria-hidden="true" />
          </button>
        ))}
      </div>
    </main>
  );
}

function ConfirmDeleteDialog({
  binding,
  onCancel,
  onDeleted,
}: {
  binding: ChannelBindingInfo;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation('channels');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onDismiss={() => {
        if (!busy) onCancel();
      }}
      title={t('channels.v2.delete.title')}
      description={t('channels.v2.delete.description', { name: binding.name })}
      width={440}
      closeLabel={t('channels.v2.cancel')}
      footer={
        <>
          <Button
            actionId="channel-delete-cancel"
            density="compact"
            label={t('channels.v2.cancel')}
            onActivate={onCancel}
          />
          <Button
            actionId="channel-delete-confirm"
            tone="danger"
            density="compact"
            execution={busy ? 'pending' : 'idle'}
            label={t('channels.v2.delete.action')}
            onActivate={async () => {
              setBusy(true);
              try {
                await channelActions.deleteBinding(binding.bindingId);
                onDeleted();
              } finally {
                setBusy(false);
              }
            }}
          />
        </>
      }
    />
  );
}

// Peers Select forwards the id prop to its trigger button, which keeps the
// recovery action's focus hand-off working without a native-select ref.
const AGENT_SELECT_CONTROL_ID = 'channel-agent-select-control';

function Detail({
  binding,
  agents,
  panel,
  onPanelChange,
  onBack,
}: {
  binding: ChannelBindingInfo;
  agents: Agent[];
  panel: ChannelManagementPanel | null;
  onPanelChange: (panel: ChannelManagementPanel | null) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation('channels');
  const detail = useChannelStore((state) =>
    state.detailsByBindingId[binding.bindingId] ?? null);
  const actorPtid = useChannelStore((state) => state.actorPtid);
  const drafts = useChannelDrafts(actorPtid);
  const [notice, setNotice] = useState('');
  const [targetChatId, setTargetChatId] = useState('');
  const [messageText, setMessageText] = useState(
    t('channels.v2.test.defaultMessage'),
  );
  const [delivery, setDelivery] = useState<ChannelMessageDelivery | null>(null);
  const [sending, setSending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const chats = detail?.chats ?? [];
  const effectiveTarget = targetChatId || chats[0]?.chatId || '';
  const pendingMembers = detail?.memberAccess.filter((member) =>
    member.status === 'pending').length ?? 0;
  const activeAutomations = detail?.automations.filter((automation) =>
    automation.enabled).length ?? 0;
  const agentRequired = binding.readiness === 'agent_required';

  if (panel) {
    return (
      <main className="pt-channel-main">
        <ChannelManagementPanels
          panel={panel}
          binding={binding}
          detail={detail}
          agents={agents}
          routeDraft={drafts.routeByBindingId[binding.bindingId] ?? null}
          automationDraft={drafts.automationByBindingId[binding.bindingId] ?? null}
          setRouteDraft={(route) => drafts.setRoute(binding.bindingId, route)}
          setAutomationDraft={(automation) =>
            drafts.setAutomation(binding.bindingId, automation)}
          onBack={() => onPanelChange(null)}
        />
      </main>
    );
  }

  const sendTest = async () => {
    if (!effectiveTarget || !messageText.trim()) return;
    setSending(true);
    setDelivery(null);
    try {
      const result = await channelActions.sendMessage(
        binding.bindingId,
        effectiveTarget,
        messageText.trim(),
      );
      setDelivery(result);
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="pt-channel-main">
      <div className="pt-channel-detail-nav">
        <Button
          actionId="channel-detail-back"
          emphasis="quiet"
          density="compact"
          leading={<ArrowLeft size={16} />}
          label={t('channels.v2.detail.all')}
          onActivate={onBack}
        />
        <div>
          {!binding.isDefault ? (
            <Button
              actionId="channel-detail-make-default"
              emphasis="quiet"
              density="compact"
              label={t('channels.v2.detail.makeDefault')}
              onActivate={() => {
                void (async () => {
                  await channelActions.setDefaultBinding(binding.bindingId);
                  setNotice(t('channels.v2.notice.defaultChanged'));
                })();
              }}
            />
          ) : <span>{t('channels.v2.detail.default')}</span>}
          <Button
            actionId="channel-detail-toggle"
            emphasis="quiet"
            density="compact"
            leading={binding.enabled ? <Pause size={15} /> : <Play size={15} />}
            label={binding.enabled ? t('channels.v2.pause') : t('channels.v2.resume')}
            onActivate={() => {
              void (async () => {
                if (binding.enabled) await channelActions.stopBinding(binding.bindingId);
                else await channelActions.startBinding(binding.bindingId);
              })();
            }}
          />
        </div>
      </div>

      <section className="pt-channel-workspace">
        <header className="pt-channel-workspace__header">
          <div className="pt-channel-workspace__identity">
            <div className="pt-channel-workspace__marks">
              <span className="pt-channel-lark-mark is-compact">
                <MessageSquareText size={18} />
              </span>
            </div>
            <div>
              <span className="pt-channel-kicker">{t('channels.v2.detail.kicker')}</span>
              <h2>{binding.name}</h2>
              <p>{t('channels.v2.detail.description')}</p>
            </div>
          </div>
          <div className="pt-channel-workspace__status">
            <ChannelStatus binding={binding} />
            <Button
              actionId="channel-activity"
              density="compact"
              leading={<HeartPulse size={14} />}
              label={t('channels.v2.activity.title')}
              onActivate={() => onPanelChange('activity')}
            />
            <Button
              actionId="channel-health"
              density="compact"
              leading={<ShieldCheck size={14} />}
              label={t('channels.v2.health.title')}
              onActivate={() => onPanelChange('health')}
            />
          </div>
        </header>

        {notice ? (
          <div className="pt-channel-notice" role="status">
            <Check size={16} />
            <span>{notice}</span>
            <IconButton
              actionId="channel-notice-dismiss"
              iconId="close"
              iconSize={15}
              density="compact"
              label={t('channels.v2.dismiss')}
              onActivate={() => setNotice('')}
            />
          </div>
        ) : null}

        {binding.readiness !== 'ready' && binding.readiness !== 'paused' ? (
          <div className="pt-channel-recovery">
            <CircleAlert size={20} />
            <div>
              <b>{agentRequired
                ? t('channels.v2.responderRequired.title')
                : t('channels.v2.recovery.title')}</b>
              <p>{agentRequired
                ? t('channels.v2.responderRequired.description')
                : binding.lastError || t('channels.v2.recovery.description')}</p>
            </div>
            <Button
              actionId="channel-recovery"
              emphasis="primary"
              density="compact"
              label={agentRequired
                ? t('channels.v2.responderRequired.action')
                : t('channels.v2.recovery.action')}
              onActivate={() => {
                if (agentRequired) {
                  document.getElementById(AGENT_SELECT_CONTROL_ID)?.focus();
                } else {
                  onPanelChange('health');
                }
              }}
            />
          </div>
        ) : null}

        <div className="pt-channel-workspace__grid">
          <div className="pt-channel-config-panel">
            <div className="pt-channel-config-row">
              <div className="pt-channel-config-row__label">
                <ChannelAgentMark agents={agents} agentId={binding.agentId} />
                <span>
                  <small>{t('channels.v2.detail.currentAgent')}</small>
                  <b>{binding.agentId
                    ? channelAgentLabel(agents, binding.agentId)
                    : t('channels.v2.detail.noAgent')}</b>
                </span>
              </div>
              <Select<string>
                id={AGENT_SELECT_CONTROL_ID}
                value={binding.agentId || undefined}
                clearable
                placeholder={t('channels.v2.detail.noAgent')}
                options={agents.map((agent) => ({
                  value: agent.id,
                  label: agent.title || agent.name,
                }))}
                onValueChange={(next) => {
                  void (async () => {
                    await channelActions.updateBinding(binding.bindingId, {
                      agentId: typeof next === 'string' ? next : '',
                    });
                    setNotice(t('channels.v2.notice.agentChanged'));
                  })();
                }}
              />
            </div>

            <div className="pt-channel-facts">
              <span>
                <small>{t('channels.v2.app.title')}</small>
                <b>{binding.appMode === 'custom'
                  ? t('channels.v2.customApp')
                  : t('channels.v2.managedApp')}</b>
              </span>
              <span>
                <small>{t('channels.v2.routes.title')}</small>
                <b>{binding.routeCount}</b>
              </span>
              <span>
                <small>{t('channels.v2.automations.title')}</small>
                <b>{activeAutomations}</b>
              </span>
              <span>
                <small>{t('channels.v2.access.title')}</small>
                <b>{pendingMembers}</b>
              </span>
            </div>

            <div className="pt-channel-workspace__intents">
              <IntentRow
                icon={Route}
                title={t('channels.v2.routes.title')}
                description={t('channels.v2.routes.description')}
                value={drafts.routeByBindingId[binding.bindingId]
                  ? t('channels.v2.draft')
                  : binding.routeCount
                    ? t('channels.v2.savedCount', { count: binding.routeCount })
                    : undefined}
                onClick={() => onPanelChange('routes')}
              />
              <IntentRow
                icon={Zap}
                title={t('channels.v2.automations.title')}
                description={t('channels.v2.automations.description')}
                value={drafts.automationByBindingId[binding.bindingId]
                  ? t('channels.v2.draft')
                  : activeAutomations
                    ? t('channels.v2.activeCount', { count: activeAutomations })
                    : undefined}
                onClick={() => onPanelChange('automations')}
              />
              <IntentRow
                icon={MessageSquareText}
                title={t('channels.v2.topics.title')}
                description={t('channels.v2.topics.entryDescription')}
                onClick={() => onPanelChange('topics')}
              />
              <IntentRow
                icon={UserRound}
                title={t('channels.v2.personal.title')}
                description={t('channels.v2.personal.description')}
                value={binding.personalOauthStatus || undefined}
                onClick={() => onPanelChange('personal')}
              />
              <IntentRow
                icon={ShieldCheck}
                title={t('channels.v2.access.title')}
                description={t('channels.v2.access.description')}
                value={pendingMembers
                  ? t('channels.v2.pendingCount', { count: pendingMembers })
                  : undefined}
                onClick={() => onPanelChange('access')}
              />
            </div>
          </div>

          <aside className="pt-channel-test-panel">
            <div>
              <span className="pt-channel-kicker">{t('channels.v2.test.kicker')}</span>
              <h3>{t('channels.v2.test.title')}</h3>
              <p>{t('channels.v2.test.description')}</p>
            </div>
            <div className="pt-channel-test-form">
              <label>
                <span>{t('channels.v2.test.target')}</span>
                <Select<string>
                  value={effectiveTarget || undefined}
                  clearable
                  placeholder={t('channels.v2.test.selectTarget')}
                  options={chats.map((chat) => ({
                    value: chat.chatId,
                    label: chat.name || chat.lastSenderName || chat.chatId,
                  }))}
                  onValueChange={(next) => setTargetChatId(
                    typeof next === 'string' ? next : '',
                  )}
                />
              </label>
              <label>
                <span>{t('channels.v2.test.message')}</span>
                <TextArea
                  aria-label={t('channels.v2.test.message')}
                  minimumRows={3}
                  value={messageText}
                  onValueChange={setMessageText}
                />
              </label>
              {delivery ? (
                <div
                  className={`pt-channel-delivery-result${delivery.status === 'delivered' ? '' : ' is-warning'}`}
                  role={delivery.status === 'delivered' ? 'status' : 'alert'}
                >
                  {delivery.status === 'delivered' ? <Check size={17} /> : <CircleAlert size={17} />}
                  <span>
                    <b>{delivery.status}</b>
                    <small>{delivery.providerMessageId || delivery.errorMessage}</small>
                  </span>
                </div>
              ) : null}
              {chats.length === 0 ? (
                <div className="pt-channel-inline-empty">
                  <MessageSquareText size={18} />
                  <span>{t('channels.v2.test.noTargets')}</span>
                </div>
              ) : (
                <Button
                  actionId="channel-test-send"
                  className="pt-channel-block-button"
                  emphasis="primary"
                  trailing={<ArrowRight size={15} />}
                  label={t('channels.v2.test.send')}
                  execution={sending ? 'pending' : 'idle'}
                  availability={(!binding.enabled || !effectiveTarget || !messageText.trim())
                    ? { kind: 'disabled', reason: t('channels.v2.test.send') }
                    : undefined}
                  onActivate={sendTest}
                />
              )}
            </div>
          </aside>
        </div>

        <details className="pt-channel-more">
          <summary>{t('channels.v2.options.title')}</summary>
          <div>
            <IntentRow
              icon={Settings2}
              title={t('channels.v2.settings.title')}
              description={t('channels.v2.settings.description')}
              onClick={() => onPanelChange('settings')}
            />
            <IntentRow
              icon={FileKey}
              title={t('channels.v2.app.title')}
              description={binding.appMode === 'custom'
                ? t('channels.v2.app.customInUse')
                : t('channels.v2.app.description')}
              onClick={() => onPanelChange('app')}
            />
            <Button
              actionId="channel-detail-disconnect"
              className="pt-channel-disconnect"
              tone="danger"
              density="compact"
              leading={<Trash2 size={16} />}
              label={t('channels.v2.delete.action')}
              onActivate={() => setDeleteOpen(true)}
            />
          </div>
        </details>
      </section>
      {deleteOpen ? (
        <ConfirmDeleteDialog
          binding={binding}
          onCancel={() => setDeleteOpen(false)}
          onDeleted={onBack}
        />
      ) : null}
    </main>
  );
}

export function LarkChannelsSettings() {
  const { t } = useTranslation('channels');
  const bindings = useChannelStore((state) => state.bindings);
  const phase = useChannelStore((state) => state.phase);
  const error = useChannelStore((state) => state.error);
  const selectedBindingId = useChannelStore((state) => state.selectedBindingId);
  const selectBinding = useChannelStore((state) => state.selectBinding);
  const agents = useSettingsStore((state) => state.agents);
  const [creationDraft, setCreationDraft] = useState(newChannelCreationDraft);
  const createSourceRef = useRef<HTMLElement | null>(null);
  const [creating, setCreating] = useState(false);
  const [panel, setPanel] = useState<ChannelManagementPanel | null>(null);

  const selectedBinding = useMemo(
    () => bindings.find((binding) => binding.bindingId === selectedBindingId) ?? null,
    [bindings, selectedBindingId],
  );

  const openBinding = async (bindingId: string) => {
    setCreating(false);
    setPanel(null);
    await selectBinding(bindingId);
  };

  const openCreate = (source: HTMLElement) => {
    createSourceRef.current = source;
    setPanel(null);
    setCreationDraft(newChannelCreationDraft());
    setCreating(true);
  };

  const closeCreate = () => {
    setCreating(false);
    setCreationDraft(newChannelCreationDraft());
    window.requestAnimationFrame(() => createSourceRef.current?.focus());
  };

  return (
    <section className="pt-channel" data-testid="lark-product">
      <header className="pt-channel-page-header">
        <div>
          <span className="pt-channel-kicker">{t('channels.v2.page.kicker')}</span>
          <h1>{t('channels.v2.page.title')}</h1>
        </div>
        {!creating && bindings.length > 0 ? (
          <Button
            actionId="channel-add"
            emphasis="primary"
            density="compact"
            leading={<Plus size={14} />}
            label={t('channels.v2.page.add')}
            onActivate={(event) => openCreate(event.currentTarget)}
          />
        ) : null}
      </header>

      {selectedBinding ? (
        <Detail
          binding={selectedBinding}
          agents={agents}
          panel={panel}
          onPanelChange={setPanel}
          onBack={() => {
            setPanel(null);
            void selectBinding(null);
          }}
        />
      ) : (
        <Collection
          bindings={bindings}
          agents={agents}
          loading={phase === 'loading'}
          error={error}
          onSelect={(bindingId) => void openBinding(bindingId)}
          onCreate={openCreate}
          onRetry={() => void channelActions.refreshBindings()}
        />
      )}
      {creating ? (
        <ChannelProvisioningPanel
          draft={creationDraft}
          onDraftChange={setCreationDraft}
          onBack={closeCreate}
          onConnected={(bindingId) => {
            setCreationDraft(newChannelCreationDraft());
            void openBinding(bindingId);
          }}
        />
      ) : null}
    </section>
  );
}
