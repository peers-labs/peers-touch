import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, IconButton, Select, Switch, TextArea, TextField } from '@peers-touch/ui';
import { Schema } from '@peers-touch/schema';
import {
  Check,
  CircleAlert,
  Download,
  ExternalLink,
  HeartPulse,
  MessageSquareText,
  Plus,
  RefreshCw,
  Route,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  ChannelRequesterAuthorizationStatus,
} from '../../../gen/proto/domain/channel/channel_pb';

import {
  api,
  type Agent,
  type AgentConversation,
  type ChannelAutomation,
  type ChannelBindingInfo,
  type ChannelRoute,
} from '../../../services/desktop_api';
import {
  channelActions,
} from '../../../services/channelActions';
import type { ChannelDetailProjection } from '../../../store/channel';
import type {
  ChannelAutomationDraft,
  ChannelRouteDraft,
} from './channelDrafts';
import { channelAgentLabel } from './channelLabels';
import { boundTopicAgentIds, formatTopicDate } from './channelTopics';
import {
  DEFAULT_LARK_REQUESTER_DOMAINS,
  LARK_REQUESTER_DOMAIN_GROUPS,
} from './requesterDomains';

export type ChannelManagementPanel =
  | 'routes'
  | 'automations'
  | 'topics'
  | 'personal'
  | 'access'
  | 'health'
  | 'activity'
  | 'app'
  | 'settings';

interface ChannelManagementPanelsProps {
  panel: ChannelManagementPanel;
  binding: ChannelBindingInfo;
  detail: ChannelDetailProjection | null;
  agents: Agent[];
  routeDraft: ChannelRouteDraft | null;
  automationDraft: ChannelAutomationDraft | null;
  setRouteDraft: (draft: ChannelRouteDraft | null) => void;
  setAutomationDraft: (draft: ChannelAutomationDraft | null) => void;
  onBack: () => void;
}

function PanelHeader({
  title,
  description,
  onBack,
}: {
  title: string;
  description: string;
  onBack: () => void;
}) {
  return (
    <header className="pt-channel-panel-header">
      <IconButton
        actionId="channel-panel-back"
        iconId="arrow-left"
        iconSize={17}
        label={title}
        onActivate={onBack}
      />
      <div>
        <h3 tabIndex={-1}>{title}</h3>
        <p>{description}</p>
      </div>
    </header>
  );
}

function RoutePanel({
  binding,
  detail,
  agents,
  draft,
  setDraft,
  onBack,
}: {
  binding: ChannelBindingInfo;
  detail: ChannelDetailProjection | null;
  agents: Agent[];
  draft: ChannelRouteDraft | null;
  setDraft: (draft: ChannelRouteDraft | null) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation('channels');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const chats = detail?.chats ?? [];
  const routes = detail?.routes ?? [];

  const begin = (route?: ChannelRoute) => {
    const firstChat = chats[0];
    setDraft({
      editingId: route?.routeId ?? null,
      chatId: route?.chatId ?? firstChat?.chatId ?? '',
      chatName: route?.chatName ?? firstChat?.name ?? '',
      agentId: route?.agentId || binding.agentId || agents[0]?.id || '',
    });
    setError('');
  };

  const save = async () => {
    if (!draft?.chatId || !draft.agentId) {
      setError(t('channels.v2.routes.incomplete'));
      return;
    }
    const chat = chats.find((item) => item.chatId === draft.chatId);
    setBusy(true);
    setError('');
    try {
      await channelActions.upsertRoute({
        routeId: draft.editingId ?? undefined,
        bindingId: binding.bindingId,
        chatId: draft.chatId,
        chatName: chat?.name || draft.chatName,
        agentId: draft.agentId,
        enabled: true,
      });
      setDraft(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (route: ChannelRoute) => {
    await channelActions.upsertRoute({
      routeId: route.routeId,
      bindingId: binding.bindingId,
      chatId: route.chatId,
      chatName: route.chatName,
      agentId: route.agentId,
      enabled: !route.enabled,
    });
  };

  return (
    <section className="pt-channel-panel">
      <PanelHeader
        title={t('channels.v2.routes.title')}
        description={t('channels.v2.routes.description')}
        onBack={onBack}
      />
      {draft ? (
        <div className="pt-channel-focused-form">
          <label>
            <span>{t('channels.v2.routes.chat')}</span>
            <Select<string>
              value={draft.chatId || undefined}
              clearable
              placeholder={t('channels.v2.routes.selectChat')}
              options={chats.map((chat) => ({
                value: chat.chatId,
                label: chat.name || chat.lastSenderName || chat.chatId,
              }))}
              onValueChange={(next) => {
                const nextChatId = typeof next === 'string' ? next : '';
                const chat = chats.find((item) => item.chatId === nextChatId);
                setDraft({
                  ...draft,
                  chatId: nextChatId,
                  chatName: chat?.name ?? '',
                });
              }}
            />
          </label>
          <label>
            <span>{t('channels.v2.routes.agent')}</span>
            <Select<string>
              value={draft.agentId || undefined}
              options={agents.map((agent) => ({
                value: agent.id,
                label: agent.title || agent.name,
              }))}
              onValueChange={(next) => setDraft({
                ...draft,
                agentId: typeof next === 'string' ? next : '',
              })}
            />
          </label>
          {error ? <p className="pt-channel-error" role="alert">{error}</p> : null}
          <div className="pt-channel-actions">
            <Button
              actionId="channel-route-cancel"
              density="compact"
              label={t('channels.v2.cancel')}
              onActivate={() => setDraft(null)}
            />
            <Button
              actionId="channel-route-save"
              emphasis="primary"
              density="compact"
              execution={busy ? 'pending' : 'idle'}
              label={t('channels.v2.save')}
              onActivate={() => void save()}
            />
          </div>
        </div>
      ) : (
        <div className="pt-channel-collection-header">
          <div>
            <b>{routes.length
              ? t('channels.v2.routes.saved', { count: routes.length })
              : t('channels.v2.routes.empty')}</b>
            <small>{t('channels.v2.routes.fallback', {
              agent: channelAgentLabel(agents, binding.agentId),
            })}</small>
          </div>
          <Button
            actionId="channel-route-add"
            emphasis="primary"
            density="compact"
            leading={<Plus size={14} />}
            label={t('channels.v2.routes.add')}
            onActivate={() => begin()}
          />
        </div>
      )}
      <div className="pt-channel-managed-list">
        {routes.map((route) => (
          <div className="pt-channel-managed-row" key={route.routeId}>
            <span className="pt-channel-row-icon"><Route size={16} /></span>
            <span className="pt-channel-row-copy">
              <b>{route.chatName || route.chatId}</b>
              <small>
                {channelAgentLabel(agents, route.agentId)}
                {' · '}
                {route.enabled
                  ? t('channels.v2.active')
                  : t('channels.v2.paused')}
              </small>
            </span>
            <span className="pt-channel-row-actions">
              <Switch
                checked={route.enabled}
                onCheckedChange={() => void toggle(route)}
              />
              <IconButton
                actionId={`channel-route-edit-${route.routeId}`}
                iconId="pencil-line"
                iconSize={15}
                density="compact"
                label={t('channels.v2.edit')}
                onActivate={() => begin(route)}
              />
              <IconButton
                actionId={`channel-route-delete-${route.routeId}`}
                iconId="delete"
                iconSize={15}
                density="compact"
                tone="danger"
                label={t('channels.v2.delete')}
                onActivate={() => void channelActions.deleteRoute(binding.bindingId, route.routeId)}
              />
            </span>
          </div>
        ))}
      </div>
      {!draft && chats.length === 0 ? (
        <div className="pt-channel-inline-empty">
          <CircleAlert size={18} />
          <span>{t('channels.v2.routes.noChats')}</span>
        </div>
      ) : null}
    </section>
  );
}

const defaultScheduleTimezone =
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function automationDraftFrom(
  automation: ChannelAutomation | undefined,
  binding: ChannelBindingInfo,
  agents: Agent[],
  destinationChatId: string,
): ChannelAutomationDraft {
  const draft: ChannelAutomationDraft = {
    editingId: automation?.automationId ?? null,
    triggerType: (automation?.triggerType as ChannelAutomationDraft['triggerType'])
      || 'schedule',
    triggerValue: automation?.triggerValue || '',
    scheduleKind: 'weekly',
    intervalMinutes: 30,
    scheduleTime: '17:00',
    scheduleWeekday: 5,
    scheduleTimezone: defaultScheduleTimezone,
    messageMatch: 'contains',
    messageChatId: '',
    documentFileType: 'docx',
    documentEvents: ['edit', 'title_updated'],
    actionPrompt: automation?.actionPrompt || '',
    agentId: automation?.agentId || binding.agentId || agents[0]?.id || '',
    destinationChatId: automation?.destinationChatId || destinationChatId,
  };
  if (!automation?.triggerValue.startsWith('{')) return draft;
  try {
    const value = JSON.parse(automation.triggerValue);
    if (draft.triggerType === 'schedule') {
      draft.scheduleKind = value.kind || 'weekly';
      draft.intervalMinutes = Math.max(1, Math.round(
        Number(value.interval_seconds || 1_800) / 60,
      ));
      draft.scheduleTime = value.time || '17:00';
      draft.scheduleWeekday = Number(value.weekdays?.[0] ?? 5);
      draft.scheduleTimezone = value.timezone || defaultScheduleTimezone;
    } else if (draft.triggerType === 'message') {
      draft.messageMatch = value.match || 'contains';
      draft.triggerValue = value.value || '';
      draft.messageChatId = value.chat_id || '';
    } else {
      draft.triggerValue = value.file_token || '';
      draft.documentFileType = value.file_type || 'docx';
      draft.documentEvents = value.events || ['edit', 'title_updated'];
    }
  } catch {
    // Preserve legacy text triggers; the user can save them in structured form.
  }
  return draft;
}

function documentIdentity(
  value: string,
  fallbackType: ChannelAutomationDraft['documentFileType'],
) {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    const [kind, token] = url.pathname.split('/').filter(Boolean);
    const fileType = kind === 'sheets'
      ? 'sheet'
      : kind === 'base'
        ? 'bitable'
        : kind === 'doc'
          ? 'doc'
          : kind === 'docx'
            ? 'docx'
            : fallbackType;
    return { fileToken: token || '', fileType };
  } catch {
    return { fileToken: trimmed, fileType: fallbackType };
  }
}

function automationTriggerValue(draft: ChannelAutomationDraft): string {
  if (draft.triggerType === 'schedule') {
    if (draft.scheduleKind === 'interval') {
      return JSON.stringify({
        kind: 'interval',
        interval_seconds: Math.max(1, draft.intervalMinutes || 30) * 60,
        timezone: draft.scheduleTimezone || defaultScheduleTimezone,
        missed_window_seconds: 900,
      });
    }
    return JSON.stringify({
      kind: draft.scheduleKind || 'weekly',
      time: draft.scheduleTime || '17:00',
      weekdays: draft.scheduleKind === 'weekly'
        ? [draft.scheduleWeekday ?? 5]
        : undefined,
      timezone: draft.scheduleTimezone || defaultScheduleTimezone,
      missed_window_seconds: 900,
    });
  }
  if (draft.triggerType === 'message') {
    return JSON.stringify({
      match: draft.messageMatch || 'contains',
      value: draft.triggerValue.trim(),
      chat_id: draft.messageChatId || undefined,
      message_type: 'text',
    });
  }
  const identity = documentIdentity(
    draft.triggerValue,
    draft.documentFileType || 'docx',
  );
  return JSON.stringify({
    file_token: identity.fileToken,
    file_type: identity.fileType,
    events: draft.documentEvents?.length
      ? draft.documentEvents
      : ['edit', 'title_updated'],
  });
}

function AutomationPanel({
  binding,
  detail,
  agents,
  draft,
  setDraft,
  onBack,
}: {
  binding: ChannelBindingInfo;
  detail: ChannelDetailProjection | null;
  agents: Agent[];
  draft: ChannelAutomationDraft | null;
  setDraft: (draft: ChannelAutomationDraft | null) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation('channels');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const automations = detail?.automations ?? [];
  const chats = detail?.chats ?? [];

  const triggerLabel = (automation: ChannelAutomation) => {
    const parsed = automationDraftFrom(
      automation,
      binding,
      agents,
      chats[0]?.chatId || '',
    );
    if (automation.triggerType === 'schedule') {
      if (parsed.scheduleKind === 'interval') {
        return t('channels.v2.automations.intervalSummary', {
          count: parsed.intervalMinutes,
        });
      }
      const time = parsed.scheduleTime || '17:00';
      if (parsed.scheduleKind === 'daily') {
        return t('channels.v2.automations.dailySummary', { time });
      }
      return t('channels.v2.automations.weeklySummary', {
        weekday: t(`channels.v2.automations.weekdays.${parsed.scheduleWeekday ?? 5}`),
        time,
      });
    }
    if (automation.triggerType === 'message') {
      return t(`channels.v2.automations.${parsed.messageMatch || 'contains'}Summary`, {
        value: parsed.triggerValue,
      });
    }
    return t('channels.v2.automations.documentSummary', {
      value: parsed.triggerValue,
    });
  };

  const begin = (automation?: ChannelAutomation) => {
    setDraft(automationDraftFrom(
      automation,
      binding,
      agents,
      chats[0]?.chatId || '',
    ));
    setError('');
  };

  const save = async () => {
    const triggerValue = draft ? automationTriggerValue(draft) : '';
    if (
      !draft
      || !triggerValue
      || (draft.triggerType !== 'schedule' && !draft.triggerValue.trim())
      || !draft.actionPrompt.trim()
      || !draft.agentId
      || !draft.destinationChatId
    ) {
      setError(t('channels.v2.automations.incomplete'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await channelActions.upsertAutomation({
        automationId: draft.editingId ?? undefined,
        bindingId: binding.bindingId,
        triggerType: draft.triggerType,
        triggerValue,
        actionPrompt: draft.actionPrompt.trim(),
        agentId: draft.agentId,
        destinationChatId: draft.destinationChatId,
        enabled: true,
      });
      setDraft(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (automation: ChannelAutomation) =>
    channelActions.upsertAutomation({
      automationId: automation.automationId,
      bindingId: binding.bindingId,
      triggerType: automation.triggerType,
      triggerValue: automation.triggerValue,
      actionPrompt: automation.actionPrompt,
      agentId: automation.agentId,
      destinationChatId: automation.destinationChatId,
      enabled: !automation.enabled,
    });

  return (
    <section className="pt-channel-panel">
      <PanelHeader
        title={t('channels.v2.automations.title')}
        description={t('channels.v2.automations.description')}
        onBack={onBack}
      />
      {draft ? (
        <div className="pt-channel-focused-form">
          <label>
            <span>{t('channels.v2.automations.when')}</span>
            <Select<ChannelAutomationDraft['triggerType']>
              value={draft.triggerType}
              options={[
                { value: 'schedule', label: t('channels.v2.automations.schedule') },
                { value: 'message', label: t('channels.v2.automations.message') },
                { value: 'document', label: t('channels.v2.automations.document') },
              ]}
              onValueChange={(next) => setDraft({
                ...draft,
                triggerType: next as ChannelAutomationDraft['triggerType'],
              })}
            />
          </label>
          {draft.triggerType === 'schedule' ? (
            <div className="pt-channel-form-grid">
              <label>
                <span>{t('channels.v2.automations.frequency')}</span>
                <Select<NonNullable<ChannelAutomationDraft['scheduleKind']>>
                  value={draft.scheduleKind ?? 'weekly'}
                  options={[
                    { value: 'interval', label: t('channels.v2.automations.interval') },
                    { value: 'daily', label: t('channels.v2.automations.daily') },
                    { value: 'weekly', label: t('channels.v2.automations.weekly') },
                  ]}
                  onValueChange={(next) => setDraft({
                    ...draft,
                    scheduleKind: next as ChannelAutomationDraft['scheduleKind'],
                  })}
                />
              </label>
              {draft.scheduleKind === 'interval' ? (
                <label>
                  <span>{t('channels.v2.automations.intervalMinutes')}</span>
                  <TextField
                    type="number"
                    min={1}
                    aria-label={t('channels.v2.automations.intervalMinutes')}
                    value={draft.intervalMinutes}
                    onValueChange={(value) => setDraft({
                      ...draft,
                      intervalMinutes: Number(value),
                    })}
                  />
                </label>
              ) : (
                <>
                  {draft.scheduleKind === 'weekly' ? (
                    <label>
                      <span>{t('channels.v2.automations.weekday')}</span>
                      <Select<number>
                        value={draft.scheduleWeekday ?? 5}
                        options={Array.from({ length: 7 }, (_, day) => ({
                          value: day,
                          label: t(`channels.v2.automations.weekdays.${day}`),
                        }))}
                        onValueChange={(next) => setDraft({
                          ...draft,
                          scheduleWeekday: typeof next === 'number' ? next : 5,
                        })}
                      />
                    </label>
                  ) : null}
                  <label>
                    <span>{t('channels.v2.automations.time')}</span>
                    <TextField
                      type="time"
                      aria-label={t('channels.v2.automations.time')}
                      value={draft.scheduleTime}
                      onValueChange={(value) => setDraft({
                        ...draft,
                        scheduleTime: value,
                      })}
                    />
                  </label>
                </>
              )}
              <label>
                <span>{t('channels.v2.automations.timezone')}</span>
                <TextField
                  aria-label={t('channels.v2.automations.timezone')}
                  value={draft.scheduleTimezone}
                  readOnly
                />
              </label>
            </div>
          ) : null}
          {draft.triggerType === 'message' ? (
            <div className="pt-channel-form-grid">
              <label>
                <span>{t('channels.v2.automations.match')}</span>
                <Select<NonNullable<ChannelAutomationDraft['messageMatch']>>
                  value={draft.messageMatch ?? 'contains'}
                  options={[
                    { value: 'contains', label: t('channels.v2.automations.contains') },
                    { value: 'equals', label: t('channels.v2.automations.equals') },
                    { value: 'regex', label: t('channels.v2.automations.regex') },
                  ]}
                  onValueChange={(next) => setDraft({
                    ...draft,
                    messageMatch: next as ChannelAutomationDraft['messageMatch'],
                  })}
                />
              </label>
              <label>
                <span>{t('channels.v2.automations.trigger')}</span>
                <TextField
                  aria-label={t('channels.v2.automations.trigger')}
                  value={draft.triggerValue}
                  onValueChange={(value) => setDraft({ ...draft, triggerValue: value })}
                />
              </label>
              <label>
                <span>{t('channels.v2.automations.sourceChat')}</span>
                <Select<string>
                  value={draft.messageChatId || undefined}
                  clearable
                  placeholder={t('channels.v2.automations.anyChat')}
                  options={chats.map((chat) => ({
                    value: chat.chatId,
                    label: chat.name || chat.lastSenderName || chat.chatId,
                  }))}
                  onValueChange={(next) => setDraft({
                    ...draft,
                    messageChatId: typeof next === 'string' ? next : '',
                  })}
                />
              </label>
            </div>
          ) : null}
          {draft.triggerType === 'document' ? (
            <>
              <div className="pt-channel-form-grid">
                <label>
                  <span>{t('channels.v2.automations.document')}</span>
                  <TextField
                    aria-label={t('channels.v2.automations.document')}
                    value={draft.triggerValue}
                    placeholder={t('channels.v2.automations.documentPlaceholder')}
                    onValueChange={(value) => setDraft({
                      ...draft,
                      triggerValue: value,
                    })}
                  />
                </label>
                <label>
                  <span>{t('channels.v2.automations.documentType')}</span>
                  <Select<NonNullable<ChannelAutomationDraft['documentFileType']>>
                    value={draft.documentFileType ?? 'docx'}
                    options={[
                      { value: 'docx', label: t('channels.v2.automations.documentType.docx') },
                      { value: 'doc', label: t('channels.v2.automations.documentType.doc') },
                      { value: 'sheet', label: t('channels.v2.automations.documentType.sheet') },
                      { value: 'bitable', label: t('channels.v2.automations.documentType.bitable') },
                    ]}
                    onValueChange={(next) => setDraft({
                      ...draft,
                      documentFileType: next as ChannelAutomationDraft['documentFileType'],
                    })}
                  />
                </label>
              </div>
              <fieldset className="pt-channel-choice-list">
                <legend>{t('channels.v2.automations.documentEvents')}</legend>
                {(['edit', 'title_updated', 'created', 'deleted', 'trashed'] as const)
                  .map((eventName) => (
                    <Checkbox
                      key={eventName}
                      checked={draft.documentEvents?.includes(eventName) ?? false}
                      onCheckedChange={(checked) => {
                        const current = draft.documentEvents ?? [];
                        setDraft({
                          ...draft,
                          documentEvents: checked
                            ? [...current, eventName]
                            : current.filter((item) => item !== eventName),
                        });
                      }}
                      label={t(`channels.v2.automations.documentEvent.${eventName}`)}
                    />
                  ))}
              </fieldset>
            </>
          ) : null}
          <label>
            <span>{t('channels.v2.automations.action')}</span>
            <TextArea
              aria-label={t('channels.v2.automations.action')}
              minimumRows={3}
              value={draft.actionPrompt}
              onValueChange={(value) => setDraft({ ...draft, actionPrompt: value })}
            />
          </label>
          <div className="pt-channel-form-grid">
            <label>
              <span>{t('channels.v2.automations.agent')}</span>
              <Select<string>
                value={draft.agentId || undefined}
                options={agents.map((agent) => ({
                  value: agent.id,
                  label: agent.title || agent.name,
                }))}
                onValueChange={(next) => setDraft({
                  ...draft,
                  agentId: typeof next === 'string' ? next : '',
                })}
              />
            </label>
            <label>
              <span>{t('channels.v2.automations.destination')}</span>
              <Select<string>
                value={draft.destinationChatId || undefined}
                clearable
                placeholder={t('channels.v2.routes.selectChat')}
                options={chats.map((chat) => ({
                  value: chat.chatId,
                  label: chat.name || chat.lastSenderName || chat.chatId,
                }))}
                onValueChange={(next) => setDraft({
                  ...draft,
                  destinationChatId: typeof next === 'string' ? next : '',
                })}
              />
            </label>
          </div>
          {error ? <p className="pt-channel-error" role="alert">{error}</p> : null}
          <div className="pt-channel-actions">
            <Button
              actionId="channel-automation-cancel"
              density="compact"
              label={t('channels.v2.cancel')}
              onActivate={() => setDraft(null)}
            />
            <Button
              actionId="channel-automation-save"
              emphasis="primary"
              density="compact"
              execution={busy ? 'pending' : 'idle'}
              label={t('channels.v2.save')}
              onActivate={() => void save()}
            />
          </div>
        </div>
      ) : (
        <div className="pt-channel-collection-header">
          <div>
            <b>{automations.length
              ? t('channels.v2.automations.saved', { count: automations.length })
              : t('channels.v2.automations.empty')}</b>
            <small>{t('channels.v2.automations.summary')}</small>
          </div>
          <Button
            actionId="channel-automation-add"
            emphasis="primary"
            density="compact"
            leading={<Plus size={14} />}
            label={t('channels.v2.automations.add')}
            onActivate={() => begin()}
          />
        </div>
      )}
      <div className="pt-channel-managed-list">
        {automations.map((automation) => (
          <div className="pt-channel-managed-row" key={automation.automationId}>
            <span className="pt-channel-row-icon"><Zap size={16} /></span>
            <span className="pt-channel-row-copy">
              <b>{triggerLabel(automation)}</b>
              <small>{automation.actionPrompt}</small>
              <em>
                {channelAgentLabel(agents, automation.agentId)}
                {' · '}
                {automation.lastRunStatus || t('channels.v2.neverRun')}
                {automation.lastRunAtUnixMs
                  ? ` · ${new Date(Number(automation.lastRunAtUnixMs)).toLocaleString()}`
                  : ''}
              </em>
            </span>
            <span className="pt-channel-row-actions">
              <IconButton
                actionId={`channel-automation-run-${automation.automationId}`}
                iconId="play"
                iconSize={15}
                density="compact"
                label={t('channels.v2.runNow')}
                onActivate={() => void channelActions.runAutomation(
                  binding.bindingId,
                  automation.automationId,
                )}
              />
              <Switch
                checked={automation.enabled}
                onCheckedChange={() => void toggle(automation)}
              />
              <IconButton
                actionId={`channel-automation-edit-${automation.automationId}`}
                iconId="pencil-line"
                iconSize={15}
                density="compact"
                label={t('channels.v2.edit')}
                onActivate={() => begin(automation)}
              />
              <IconButton
                actionId={`channel-automation-delete-${automation.automationId}`}
                iconId="delete"
                iconSize={15}
                density="compact"
                tone="danger"
                label={t('channels.v2.delete')}
                onActivate={() => void channelActions.deleteAutomation(
                  binding.bindingId,
                  automation.automationId,
                )}
              />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RequesterDomainPicker({
  selected,
  locked,
  onToggle,
}: {
  selected: ReadonlySet<string>;
  locked: ReadonlySet<string>;
  onToggle: (domain: string) => void;
}) {
  const { t } = useTranslation('channels');
  return (
    <div className="pt-channel-domain-picker">
      <strong>{t('channels.v2.personal.workAreas')}</strong>
      <p>{t('channels.v2.personal.workAreasDescription')}</p>
      {LARK_REQUESTER_DOMAIN_GROUPS.map((group) => (
        <fieldset className="pt-channel-choice-list" key={group.id}>
          <legend>
            {t(`channels.v2.personal.domainGroup.${group.id}`)}
          </legend>
          {group.domains.map((domain) => (
            <Checkbox
              key={domain}
              checked={selected.has(domain)}
              disabled={locked.has(domain)}
              onCheckedChange={() => onToggle(domain)}
              label={t(`channels.v2.personal.domain.${domain}`)}
            />
          ))}
        </fieldset>
      ))}
    </div>
  );
}

function PersonalAccessPanel({
  binding,
  detail,
  onBack,
}: {
  binding: ChannelBindingInfo;
  detail: ChannelDetailProjection | null;
  onBack: () => void;
}) {
  const { t } = useTranslation('channels');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [domainDraft, setDomainDraft] = useState<{
    bindingId: string;
    domains: string[];
  } | null>(null);
  const [domainEditorBindingId, setDomainEditorBindingId] = useState<string | null>(
    null,
  );
  const authorization = detail?.requesterAuthorization ?? null;
  const connected =
    authorization?.status === ChannelRequesterAuthorizationStatus.READY;
  const pending =
    authorization?.status === ChannelRequesterAuthorizationStatus.PENDING;
  const refreshable = authorization?.status
    === ChannelRequesterAuthorizationStatus.NEEDS_REFRESH;
  const needsRecovery = authorization
    && !connected
    && !pending
    && authorization.status
      !== ChannelRequesterAuthorizationStatus.DISCONNECTED
    && authorization.status
      !== ChannelRequesterAuthorizationStatus.UNSPECIFIED;
  const authorizedDomains = authorization?.requestedDomains ?? [];
  const baselineDomains = authorizedDomains.length > 0
    ? authorizedDomains
    : [...DEFAULT_LARK_REQUESTER_DOMAINS];
  const selectedDomains = domainDraft?.bindingId === binding.bindingId
    ? domainDraft.domains
    : baselineDomains;
  const selectedDomainSet = new Set(selectedDomains);
  const lockedDomainSet = new Set(connected ? authorizedDomains : []);
  const hasNewDomains = selectedDomains.some(
    (domain) => !lockedDomainSet.has(domain),
  );
  const showDomainPicker = (!connected && !pending && !refreshable)
    || domainEditorBindingId === binding.bindingId;

  const connect = async () => {
    if (selectedDomains.length === 0) return;
    setBusy(true);
    setError('');
    try {
      await channelActions.startRequesterAuthorization(
        binding.bindingId,
        selectedDomains,
      );
      setDomainDraft(null);
      setDomainEditorBindingId(null);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : String(connectError));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!authorization) return;
    setBusy(true);
    setError('');
    try {
      await channelActions.revokeRequesterAuthorization(authorization);
      setDomainDraft(null);
      setDomainEditorBindingId(null);
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : String(revokeError));
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    if (!authorization) return;
    setBusy(true);
    setError('');
    try {
      await channelActions.refreshRequesterAuthorization(authorization);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!authorization) return;
    setBusy(true);
    setError('');
    try {
      await channelActions.cancelRequesterAuthorization(authorization);
      setDomainDraft(null);
      setDomainEditorBindingId(null);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : String(cancelError));
    } finally {
      setBusy(false);
    }
  };

  const toggleDomain = (domain: string) => {
    if (lockedDomainSet.has(domain)) return;
    const next = new Set(selectedDomains);
    if (next.has(domain)) next.delete(domain);
    else next.add(domain);
    setDomainDraft({
      bindingId: binding.bindingId,
      domains: Array.from(next).sort(),
    });
  };

  return (
    <section className="pt-channel-panel">
      <PanelHeader
        title={t('channels.v2.personal.title')}
        description={t('channels.v2.personal.description')}
        onBack={onBack}
      />
      <div className="pt-channel-permission">
        <span className={needsRecovery ? 'is-warning' : ''}>
          {needsRecovery
            ? <CircleAlert size={24} />
            : <ShieldCheck size={24} />}
        </span>
        {pending && authorization ? (
          <>
            <h4>{t('channels.v2.personal.pendingTitle')}</h4>
            <p>{t('channels.v2.personal.pendingDescription')}</p>
            {authorization.verificationUrl ? (
              <div className="pt-channel-personal-qr">
                <Schema.QRCode
                  content={{ kind: 'external-protocol', owner: 'channels.requester-authorization', value: authorization.verificationUrl }}
                  constraints={{ size: 320, style: 'classic', errorCorrection: 'Q' }}
                  title={t('channels.v2.personal.openAuthorization')}
                  errorLabel={t('channels.schema.qrUnavailable')}
                />
                <Button
                  actionId="channel-personal-open-auth"
                  density="compact"
                  leading={<ExternalLink size={15} />}
                  label={t('channels.v2.personal.openAuthorization')}
                  onActivate={() => api.openExternalUrl(authorization.verificationUrl)}
                />
              </div>
            ) : null}
            <div className="pt-channel-domain-summary">
              {authorization.pendingDomains.map((domain) => (
                <span key={domain}>
                  {t(`channels.v2.personal.domain.${domain}`)}
                </span>
              ))}
            </div>
            <Button
              actionId="channel-personal-cancel-auth"
              tone="danger"
              density="compact"
              execution={busy ? 'pending' : 'idle'}
              leading={<X size={15} />}
              label={t('channels.v2.personal.cancelAuthorization')}
              onActivate={() => void cancel()}
            />
          </>
        ) : connected && authorization ? (
          <>
            <h4>{authorization.userName || authorization.providerUserId}</h4>
            <p>{authorization.email || authorization.providerUserId}</p>
            <div className="pt-channel-permission-list">
              <span><Check size={15} /> {t('channels.v2.personal.read')}</span>
              <span><Check size={15} /> {t('channels.v2.personal.draft')}</span>
              <span><Check size={15} /> {t('channels.v2.personal.approval')}</span>
            </div>
            {authorization.errorMessage ? (
              <p className="pt-channel-error" role="alert">
                {authorization.errorMessage}
              </p>
            ) : null}
            {showDomainPicker ? (
              <RequesterDomainPicker
                selected={selectedDomainSet}
                locked={lockedDomainSet}
                onToggle={toggleDomain}
              />
            ) : null}
            <div className="pt-channel-actions">
              {showDomainPicker ? (
                <Button
                  actionId="channel-personal-authorize-more"
                  emphasis="primary"
                  density="compact"
                  execution={busy ? 'pending' : 'idle'}
                  leading={<Plus size={15} />}
                  label={t('channels.v2.personal.authorizeMore')}
                  availability={!hasNewDomains
                    ? { kind: 'disabled', reason: t('channels.v2.personal.authorizeMore') }
                    : undefined}
                  onActivate={() => void connect()}
                />
              ) : (
                <Button
                  actionId="channel-personal-add-work-areas"
                  density="compact"
                  leading={<Plus size={15} />}
                  label={t('channels.v2.personal.addWorkAreas')}
                  onActivate={() => setDomainEditorBindingId(binding.bindingId)}
                />
              )}
              <Button
                actionId="channel-personal-refresh"
                density="compact"
                execution={busy ? 'pending' : 'idle'}
                leading={<RefreshCw size={15} />}
                label={t('channels.v2.personal.refresh')}
                onActivate={() => void refresh()}
              />
              <Button
                actionId="channel-personal-remove"
                tone="danger"
                density="compact"
                execution={busy ? 'pending' : 'idle'}
                leading={<Trash2 size={15} />}
                label={t('channels.v2.personal.remove')}
                onActivate={() => void revoke()}
              />
            </div>
          </>
        ) : (
          <>
            <h4>
              {refreshable
                ? t('channels.v2.personal.refreshTitle')
                : t('channels.v2.personal.connectTitle')}
            </h4>
            <p>
              {refreshable
                ? t('channels.v2.personal.refreshDescription')
                : t('channels.v2.personal.connectDescription')}
            </p>
            <div className="pt-channel-permission-list">
              <span><Check size={15} /> {t('channels.v2.personal.read')}</span>
              <span><Check size={15} /> {t('channels.v2.personal.draft')}</span>
              <span><Check size={15} /> {t('channels.v2.personal.revoke')}</span>
            </div>
            {showDomainPicker ? (
              <RequesterDomainPicker
                selected={selectedDomainSet}
                locked={lockedDomainSet}
                onToggle={toggleDomain}
              />
            ) : null}
            {needsRecovery && authorization?.errorMessage ? (
              <p className="pt-channel-error" role="alert">
                {authorization.errorMessage}
              </p>
            ) : null}
            <Button
              actionId="channel-personal-connect"
              emphasis="primary"
              density="compact"
              execution={busy ? 'pending' : 'idle'}
              leading={refreshable ? <RefreshCw size={15} /> : undefined}
              label={refreshable
                ? t('channels.v2.personal.refresh')
                : needsRecovery
                  ? t('channels.v2.personal.reconnect')
                  : t('channels.v2.personal.connect')}
              availability={(!refreshable && selectedDomains.length === 0)
                ? { kind: 'disabled', reason: t('channels.v2.personal.connect') }
                : undefined}
              onActivate={() => void (refreshable ? refresh() : connect())}
            />
          </>
        )}
        {error ? <p className="pt-channel-error" role="alert">{error}</p> : null}
      </div>
    </section>
  );
}

function AccessPanel({
  binding,
  detail,
  onBack,
}: {
  binding: ChannelBindingInfo;
  detail: ChannelDetailProjection | null;
  onBack: () => void;
}) {
  const { t } = useTranslation('channels');
  const members = detail?.memberAccess ?? [];
  return (
    <section className="pt-channel-panel">
      <PanelHeader
        title={t('channels.v2.access.title')}
        description={t('channels.v2.access.description')}
        onBack={onBack}
      />
      <label className="pt-channel-setting-row">
        <span>
          <b>{t('channels.v2.access.mode')}</b>
          <small>{t('channels.v2.access.modeDescription')}</small>
        </span>
        <Select<string>
          appearance="ghost"
          aria-label={t('channels.v2.access.mode')}
          value={binding.accessMode || 'approval'}
          options={[
            { value: 'owner', label: t('channels.v2.access.owner') },
            { value: 'approval', label: t('channels.v2.access.approval') },
            { value: 'allowlist', label: t('channels.v2.access.allowlist') },
            { value: 'open', label: t('channels.v2.access.open') },
          ]}
          onValueChange={(next) => void channelActions.updateBinding(
            binding.bindingId,
            { accessMode: typeof next === 'string' ? next : 'approval' },
          )}
        />
      </label>
      <div className="pt-channel-managed-list">
        {members.map((member) => (
          <div className="pt-channel-managed-row" key={member.accessId}>
            <span className="pt-channel-row-icon"><UserRound size={16} /></span>
            <span className="pt-channel-row-copy">
              <b>{member.displayName || member.providerUserId}</b>
              <small>{member.status}</small>
            </span>
            {member.status === 'pending' ? (
              <span className="pt-channel-row-actions">
                <Button
                  actionId={`channel-access-deny-${member.accessId}`}
                  density="compact"
                  label={t('channels.v2.access.deny')}
                  onActivate={() => void channelActions.decideMemberAccess(
                    binding.bindingId,
                    member.accessId,
                    'deny',
                  )}
                />
                <Button
                  actionId={`channel-access-allow-${member.accessId}`}
                  emphasis="primary"
                  density="compact"
                  label={t('channels.v2.access.allow')}
                  onActivate={() => void channelActions.decideMemberAccess(
                    binding.bindingId,
                    member.accessId,
                    'allow',
                  )}
                />
              </span>
            ) : null}
          </div>
        ))}
      </div>
      {members.length === 0 ? (
        <div className="pt-channel-inline-empty">
          <ShieldCheck size={18} />
          <span>{t('channels.v2.access.empty')}</span>
        </div>
      ) : null}
    </section>
  );
}

function HealthPanel({
  binding,
  detail,
  onBack,
}: {
  binding: ChannelBindingInfo;
  detail: ChannelDetailProjection | null;
  onBack: () => void;
}) {
  const { t } = useTranslation('channels');
  const [busy, setBusy] = useState(false);
  const health = detail?.health;
  return (
    <section className="pt-channel-panel">
      <PanelHeader
        title={t('channels.v2.health.title')}
        description={t('channels.v2.health.description')}
        onBack={onBack}
      />
      <div className="pt-channel-health-list">
        {(health?.checks ?? []).map((check) => (
          <div key={check.capability} className={check.status === 'ready' ? '' : 'is-warning'}>
            {check.status === 'ready' ? <Check size={16} /> : <CircleAlert size={16} />}
            <span>
              <b>{check.capability}</b>
              <small>{check.status === 'ready'
                ? t('channels.v2.health.ready')
                : check.recoveryAction}</small>
            </span>
          </div>
        ))}
        {!health ? (
          <div><RefreshCw className="is-spinning" size={16} /><span>{t('channels.v2.loading')}</span></div>
        ) : null}
      </div>
      <Button
        actionId="channel-health-run"
        emphasis="primary"
        density="compact"
        execution={busy ? 'pending' : 'idle'}
        leading={<RefreshCw size={15} />}
        label={t('channels.v2.health.run')}
        onActivate={async () => {
          setBusy(true);
          try {
            await channelActions.checkHealth(binding.bindingId);
          } finally {
            setBusy(false);
          }
        }}
      />
    </section>
  );
}

function ActivityPanel({
  binding,
  detail,
  onBack,
}: {
  binding: ChannelBindingInfo;
  detail: ChannelDetailProjection | null;
  onBack: () => void;
}) {
  const { t } = useTranslation('channels');
  const stats = detail?.stats;
  const events = detail?.events ?? [];
  return (
    <section className="pt-channel-panel">
      <PanelHeader
        title={t('channels.v2.activity.title')}
        description={t('channels.v2.activity.description')}
        onBack={onBack}
      />
      <div className="pt-channel-stats">
        <span><b>{stats?.todayInbound.toString() ?? '0'}</b><small>{t('channels.v2.activity.receivedToday')}</small></span>
        <span><b>{stats?.todayOutbound.toString() ?? '0'}</b><small>{t('channels.v2.activity.sentToday')}</small></span>
        <span><b>{stats?.totalErrors.toString() ?? '0'}</b><small>{t('channels.v2.activity.errors')}</small></span>
        <span><b>{stats?.averageLatencyMs.toString() ?? '0'} ms</b><small>{t('channels.v2.activity.latency')}</small></span>
      </div>
      <div className="pt-channel-activity-list">
        {events.map((event) => (
          <div key={event.eventId} className={event.errorCode ? 'is-warning' : ''}>
            {event.errorCode ? <CircleAlert size={16} /> : <HeartPulse size={16} />}
            <span>
              <b>{event.phase} · {event.direction}</b>
              <small>
                {event.summary || event.errorMessage || event.messageType}
                {' · '}
                {new Date(Number(event.occurredAtUnixMs)).toLocaleString()}
              </small>
            </span>
            {event.deliveryId && event.errorCode ? (
              <Button
                actionId={`channel-activity-retry-${event.deliveryId}`}
                density="compact"
                label={t('channels.v2.activity.retry')}
                onActivate={() => void channelActions.retryDelivery(
                  binding.bindingId,
                  event.deliveryId,
                )}
              />
            ) : null}
          </div>
        ))}
      </div>
      <Button
        actionId="channel-activity-export"
        density="compact"
        leading={<Download size={15} />}
        label={t('channels.v2.activity.export')}
        onActivate={() => void channelActions.exportDiagnostics(binding.bindingId)}
      />
    </section>
  );
}

function TopicsPanel({
  binding,
  detail,
  agents,
  onBack,
}: {
  binding: ChannelBindingInfo;
  detail: ChannelDetailProjection | null;
  agents: Agent[];
  onBack: () => void;
}) {
  const { t } = useTranslation('channels');
  const agentIds = useMemo(
    () => boundTopicAgentIds(binding, detail),
    [binding, detail],
  );
  const [records, setRecords] = useState<Record<string, AgentConversation[]>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const settled = await Promise.allSettled(
      agentIds.map((agentId) =>
        api
          .listAgentConversations(agentId, { status: 'active', pageSize: 50 })
          .then((conversations) => [agentId, conversations] as const),
      ),
    );
    const next: Record<string, AgentConversation[]> = {};
    let failed = false;
    settled.forEach((result) => {
      if (result.status === 'fulfilled') {
        next[result.value[0]] = result.value[1];
      } else {
        failed = true;
      }
    });
    setRecords(next);
    setLoadError(failed);
    setLoading(false);
  }, [agentIds]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="pt-channel-panel" data-testid="channel-topics-panel">
      <PanelHeader
        title={t('channels.v2.topics.title')}
        description={t('channels.v2.topics.description')}
        onBack={onBack}
      />
      <div className="pt-channel-collection-header">
        <div>
          <b>{t('channels.v2.topics.heading')}</b>
          <small>{t('channels.v2.topics.readonly')}</small>
        </div>
        <Button
          actionId="channel-topics-refresh"
          density="compact"
          leading={<RefreshCw size={14} />}
          execution={loading ? 'pending' : 'idle'}
          label={t('channels.v2.topics.refresh')}
          onActivate={() => void load()}
        />
      </div>
      {loadError ? (
        <div className="pt-channel-notice is-warning" role="alert">
          <CircleAlert size={16} />
          <span>{t('channels.v2.topics.loadFailed')}</span>
        </div>
      ) : null}
      {loading && Object.keys(records).length === 0 ? (
        <div className="pt-channel-panel-loading">
          <RefreshCw className="is-spinning" size={16} />
          <span>{t('channels.v2.loading')}</span>
        </div>
      ) : agentIds.length === 0 ? (
        <div className="pt-channel-inline-empty">
          <MessageSquareText size={18} />
          <span>{t('channels.v2.topics.noAgents')}</span>
        </div>
      ) : (
        <div className="pt-channel-topic-groups">
          {agentIds.map((agentId) => {
            const topics = records[agentId] ?? [];
            return (
              <section key={agentId} className="pt-channel-topic-group">
                <h4>{channelAgentLabel(agents, agentId)}</h4>
                {loading && !(agentId in records) ? (
                  <p className="pt-channel-topic-empty">{t('channels.v2.loading')}</p>
                ) : topics.length === 0 ? (
                  <p className="pt-channel-topic-empty">{t('channels.v2.topics.empty')}</p>
                ) : (
                  <ul className="pt-channel-topic-list">
                    {topics.map((topic) => (
                      <li key={topic.conversation_id}>
                        <span className="pt-channel-topic-name">{topic.title}</span>
                        <span className="pt-channel-topic-date">
                          {formatTopicDate(topic.created_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AppPanel({
  binding,
  onBack,
}: {
  binding: ChannelBindingInfo;
  onBack: () => void;
}) {
  const { t } = useTranslation('channels');
  const [appId, setAppId] = useState(binding.providerAppId);
  const [secret, setSecret] = useState('');
  const [validation, setValidation] = useState<Awaited<ReturnType<typeof channelActions.validateApp>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const domain = binding.region === 'lark'
    ? 'https://open.larksuite.com'
    : 'https://open.feishu.cn';
  return (
    <section className="pt-channel-panel">
      <PanelHeader
        title={t('channels.v2.app.title')}
        description={t('channels.v2.app.description')}
        onBack={onBack}
      />
      <div className="pt-channel-focused-form">
        <label>
          <span>{t('channels.config.lark.appId.label')}</span>
          <TextField
            aria-label={t('channels.config.lark.appId.label')}
            value={appId}
            onValueChange={setAppId}
          />
        </label>
        <label>
          <span>{t('channels.config.lark.appSecret.label')}</span>
          <TextField
            type="password"
            aria-label={t('channels.config.lark.appSecret.label')}
            value={secret}
            onValueChange={setSecret}
          />
        </label>
        {validation ? (
          <div className={`pt-channel-validation${validation.valid ? ' is-ready' : ' is-warning'}`}>
            {validation.valid ? <Check size={18} /> : <CircleAlert size={18} />}
            <div>
              <b>{validation.valid
                ? t('channels.v2.custom.ready')
                : t('channels.v2.custom.needsRepair')}</b>
              {validation.checks.map((check) => (
                <small key={check.capability}>{check.capability} · {check.status}</small>
              ))}
            </div>
          </div>
        ) : null}
        {error ? <p className="pt-channel-error" role="alert">{error}</p> : null}
        <div className="pt-channel-actions">
          <Button
            actionId="channel-app-check"
            density="compact"
            execution={busy ? 'pending' : 'idle'}
            label={t('channels.v2.custom.check')}
            onActivate={async () => {
              setBusy(true);
              setError('');
              try {
                setValidation(await channelActions.validateApp({
                  providerKind: 'lark',
                  providerAppId: appId.trim(),
                  appSecret: secret,
                  domain,
                  region: binding.region,
                }));
              } catch (validationError) {
                setError(validationError instanceof Error
                  ? validationError.message
                  : String(validationError));
              } finally {
                setBusy(false);
              }
            }}
          />
          <Button
            actionId="channel-app-rotate"
            emphasis="primary"
            density="compact"
            label={t('channels.v2.app.rotate')}
            availability={!validation?.valid
              ? { kind: 'disabled', reason: t('channels.v2.app.rotate') }
              : undefined}
            onActivate={async () => {
              await channelActions.updateBinding(binding.bindingId, { appSecret: secret });
              setSecret('');
              setValidation(null);
              onBack();
            }}
          />
        </div>
        {validation?.consoleUrl ? (
          <Button
            actionId="channel-app-console"
            density="compact"
            leading={<ExternalLink size={15} />}
            label={t('channels.v2.provision.openConsole')}
            onActivate={() => api.openExternalUrl(validation.consoleUrl)}
          />
        ) : null}
      </div>
    </section>
  );
}

function SettingsPanel({
  binding,
  onBack,
}: {
  binding: ChannelBindingInfo;
  onBack: () => void;
}) {
  const { t } = useTranslation('channels');
  const update = (patch: Parameters<typeof channelActions.updateBinding>[1]) =>
    channelActions.updateBinding(binding.bindingId, patch);
  return (
    <section className="pt-channel-panel">
      <PanelHeader
        title={t('channels.v2.settings.title')}
        description={t('channels.v2.settings.description')}
        onBack={onBack}
      />
      <div className="pt-channel-settings-list">
        <label className="pt-channel-setting-row">
          <span><b>{t('channels.v2.settings.name')}</b></span>
          <TextField
            aria-label={t('channels.v2.settings.name')}
            defaultValue={binding.name}
            onBlur={(event) => {
              if (event.target.value.trim() !== binding.name) {
                void update({ name: event.target.value.trim() });
              }
            }}
          />
        </label>
        <label className="pt-channel-setting-row">
          <span><b>{t('channels.v2.settings.groupMode')}</b><small>{t('channels.v2.settings.groupModeDescription')}</small></span>
          <Select<string>
            appearance="ghost"
            aria-label={t('channels.v2.settings.groupMode')}
            value={binding.groupResponseMode || 'mention'}
            options={[
              { value: 'mention', label: t('channels.v2.settings.mention') },
              { value: 'all', label: t('channels.v2.settings.all') },
              { value: 'off', label: t('channels.v2.settings.off') },
            ]}
            onValueChange={(next) => void update({
              groupResponseMode: typeof next === 'string' ? next : 'mention',
            })}
          />
        </label>
        <label className="pt-channel-setting-row">
          <span><b>{t('channels.v2.settings.threadIsolation')}</b><small>{t('channels.v2.settings.threadIsolationDescription')}</small></span>
          <Switch
            checked={binding.threadIsolation}
            onCheckedChange={() => void update({ threadIsolation: !binding.threadIsolation })}
          />
        </label>
        <label className="pt-channel-setting-row">
          <span><b>{t('channels.v2.settings.output')}</b></span>
          <Select<string>
            appearance="ghost"
            aria-label={t('channels.v2.settings.output')}
            value={binding.outputMode || 'concise'}
            options={[
              { value: 'concise', label: t('channels.v2.settings.concise') },
              { value: 'detailed', label: t('channels.v2.settings.detailed') },
            ]}
            onValueChange={(next) => void update({
              outputMode: typeof next === 'string' ? next : 'concise',
            })}
          />
        </label>
      </div>
    </section>
  );
}

export function ChannelManagementPanels({
  panel,
  binding,
  detail,
  agents,
  routeDraft,
  automationDraft,
  setRouteDraft,
  setAutomationDraft,
  onBack,
}: ChannelManagementPanelsProps) {
  if (panel === 'routes') {
    return (
      <RoutePanel
        binding={binding}
        detail={detail}
        agents={agents}
        draft={routeDraft}
        setDraft={setRouteDraft}
        onBack={onBack}
      />
    );
  }
  if (panel === 'automations') {
    return (
      <AutomationPanel
        binding={binding}
        detail={detail}
        agents={agents}
        draft={automationDraft}
        setDraft={setAutomationDraft}
        onBack={onBack}
      />
    );
  }
  if (panel === 'personal') {
    return <PersonalAccessPanel binding={binding} detail={detail} onBack={onBack} />;
  }
  if (panel === 'access') return <AccessPanel binding={binding} detail={detail} onBack={onBack} />;
  if (panel === 'topics') {
    return (
      <TopicsPanel
        binding={binding}
        detail={detail}
        agents={agents}
        onBack={onBack}
      />
    );
  }
  if (panel === 'health') return <HealthPanel binding={binding} detail={detail} onBack={onBack} />;
  if (panel === 'activity') return <ActivityPanel binding={binding} detail={detail} onBack={onBack} />;
  if (panel === 'app') return <AppPanel binding={binding} onBack={onBack} />;
  return <SettingsPanel binding={binding} onBack={onBack} />;
}
