import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@lobehub/ui';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Download,
  ExternalLink,
  HeartPulse,
  MessageSquareText,
  Pencil,
  Play,
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
      <button type="button" onClick={onBack} aria-label={title}>
        <ArrowLeft size={17} />
      </button>
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
            <select
              value={draft.chatId}
              onChange={(event) => {
                const chat = chats.find((item) => item.chatId === event.target.value);
                setDraft({
                  ...draft,
                  chatId: event.target.value,
                  chatName: chat?.name ?? '',
                });
              }}
            >
              <option value="">{t('channels.v2.routes.selectChat')}</option>
              {chats.map((chat) => (
                <option key={chat.chatId} value={chat.chatId}>
                  {chat.name || chat.lastSenderName || chat.chatId}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('channels.v2.routes.agent')}</span>
            <select
              value={draft.agentId}
              onChange={(event) => setDraft({ ...draft, agentId: event.target.value })}
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.title || agent.name}
                </option>
              ))}
            </select>
          </label>
          {error ? <p className="pt-channel-error" role="alert">{error}</p> : null}
          <div className="pt-channel-actions">
            <Button onClick={() => setDraft(null)}>{t('channels.v2.cancel')}</Button>
            <Button type="primary" loading={busy} onClick={save}>
              {t('channels.v2.save')}
            </Button>
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
          <Button type="primary" icon={Plus} onClick={() => begin()}>
            {t('channels.v2.routes.add')}
          </Button>
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
              <button
                type="button"
                role="switch"
                aria-checked={route.enabled}
                className={`pt-channel-switch${route.enabled ? ' is-on' : ''}`}
                onClick={() => void toggle(route)}
              ><span /></button>
              <button type="button" onClick={() => begin(route)} aria-label={t('channels.v2.edit')}>
                <Pencil size={15} />
              </button>
              <button
                type="button"
                className="is-danger"
                aria-label={t('channels.v2.delete')}
                onClick={() => void channelActions.deleteRoute(binding.bindingId, route.routeId)}
              >
                <Trash2 size={15} />
              </button>
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
            <select
              value={draft.triggerType}
              onChange={(event) => setDraft({
                ...draft,
                triggerType: event.target.value as ChannelAutomationDraft['triggerType'],
              })}
            >
              <option value="schedule">{t('channels.v2.automations.schedule')}</option>
              <option value="message">{t('channels.v2.automations.message')}</option>
              <option value="document">{t('channels.v2.automations.document')}</option>
            </select>
          </label>
          {draft.triggerType === 'schedule' ? (
            <div className="pt-channel-form-grid">
              <label>
                <span>{t('channels.v2.automations.frequency')}</span>
                <select
                  value={draft.scheduleKind}
                  onChange={(event) => setDraft({
                    ...draft,
                    scheduleKind: event.target.value as ChannelAutomationDraft['scheduleKind'],
                  })}
                >
                  <option value="interval">{t('channels.v2.automations.interval')}</option>
                  <option value="daily">{t('channels.v2.automations.daily')}</option>
                  <option value="weekly">{t('channels.v2.automations.weekly')}</option>
                </select>
              </label>
              {draft.scheduleKind === 'interval' ? (
                <label>
                  <span>{t('channels.v2.automations.intervalMinutes')}</span>
                  <input
                    type="number"
                    min={1}
                    value={draft.intervalMinutes}
                    onChange={(event) => setDraft({
                      ...draft,
                      intervalMinutes: Number(event.target.value),
                    })}
                  />
                </label>
              ) : (
                <>
                  {draft.scheduleKind === 'weekly' ? (
                    <label>
                      <span>{t('channels.v2.automations.weekday')}</span>
                      <select
                        value={draft.scheduleWeekday}
                        onChange={(event) => setDraft({
                          ...draft,
                          scheduleWeekday: Number(event.target.value),
                        })}
                      >
                        {Array.from({ length: 7 }, (_, day) => (
                          <option key={day} value={day}>
                            {t(`channels.v2.automations.weekdays.${day}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label>
                    <span>{t('channels.v2.automations.time')}</span>
                    <input
                      type="time"
                      value={draft.scheduleTime}
                      onChange={(event) => setDraft({
                        ...draft,
                        scheduleTime: event.target.value,
                      })}
                    />
                  </label>
                </>
              )}
              <label>
                <span>{t('channels.v2.automations.timezone')}</span>
                <input value={draft.scheduleTimezone} readOnly />
              </label>
            </div>
          ) : null}
          {draft.triggerType === 'message' ? (
            <div className="pt-channel-form-grid">
              <label>
                <span>{t('channels.v2.automations.match')}</span>
                <select
                  value={draft.messageMatch}
                  onChange={(event) => setDraft({
                    ...draft,
                    messageMatch: event.target.value as ChannelAutomationDraft['messageMatch'],
                  })}
                >
                  <option value="contains">{t('channels.v2.automations.contains')}</option>
                  <option value="equals">{t('channels.v2.automations.equals')}</option>
                  <option value="regex">{t('channels.v2.automations.regex')}</option>
                </select>
              </label>
              <label>
                <span>{t('channels.v2.automations.trigger')}</span>
                <input
                  value={draft.triggerValue}
                  onChange={(event) => setDraft({ ...draft, triggerValue: event.target.value })}
                />
              </label>
              <label>
                <span>{t('channels.v2.automations.sourceChat')}</span>
                <select
                  value={draft.messageChatId}
                  onChange={(event) => setDraft({
                    ...draft,
                    messageChatId: event.target.value,
                  })}
                >
                  <option value="">{t('channels.v2.automations.anyChat')}</option>
                  {chats.map((chat) => (
                    <option key={chat.chatId} value={chat.chatId}>
                      {chat.name || chat.lastSenderName || chat.chatId}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          {draft.triggerType === 'document' ? (
            <>
              <div className="pt-channel-form-grid">
                <label>
                  <span>{t('channels.v2.automations.document')}</span>
                  <input
                    value={draft.triggerValue}
                    placeholder={t('channels.v2.automations.documentPlaceholder')}
                    onChange={(event) => setDraft({
                      ...draft,
                      triggerValue: event.target.value,
                    })}
                  />
                </label>
                <label>
                  <span>{t('channels.v2.automations.documentType')}</span>
                  <select
                    value={draft.documentFileType}
                    onChange={(event) => setDraft({
                      ...draft,
                      documentFileType: event.target.value as ChannelAutomationDraft['documentFileType'],
                    })}
                  >
                    <option value="docx">{t('channels.v2.automations.documentType.docx')}</option>
                    <option value="doc">{t('channels.v2.automations.documentType.doc')}</option>
                    <option value="sheet">{t('channels.v2.automations.documentType.sheet')}</option>
                    <option value="bitable">{t('channels.v2.automations.documentType.bitable')}</option>
                  </select>
                </label>
              </div>
              <fieldset className="pt-channel-choice-list">
                <legend>{t('channels.v2.automations.documentEvents')}</legend>
                {(['edit', 'title_updated', 'created', 'deleted', 'trashed'] as const)
                  .map((eventName) => (
                    <label key={eventName}>
                      <input
                        type="checkbox"
                        checked={draft.documentEvents?.includes(eventName) ?? false}
                        onChange={(event) => {
                          const current = draft.documentEvents ?? [];
                          setDraft({
                            ...draft,
                            documentEvents: event.target.checked
                              ? [...current, eventName]
                              : current.filter((item) => item !== eventName),
                          });
                        }}
                      />
                      <span>{t(`channels.v2.automations.documentEvent.${eventName}`)}</span>
                    </label>
                  ))}
              </fieldset>
            </>
          ) : null}
          <label>
            <span>{t('channels.v2.automations.action')}</span>
            <textarea
              rows={3}
              value={draft.actionPrompt}
              onChange={(event) => setDraft({ ...draft, actionPrompt: event.target.value })}
            />
          </label>
          <div className="pt-channel-form-grid">
            <label>
              <span>{t('channels.v2.automations.agent')}</span>
              <select
                value={draft.agentId}
                onChange={(event) => setDraft({ ...draft, agentId: event.target.value })}
              >
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.title || agent.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('channels.v2.automations.destination')}</span>
              <select
                value={draft.destinationChatId}
                onChange={(event) => setDraft({
                  ...draft,
                  destinationChatId: event.target.value,
                })}
              >
                <option value="">{t('channels.v2.routes.selectChat')}</option>
                {chats.map((chat) => (
                  <option key={chat.chatId} value={chat.chatId}>
                    {chat.name || chat.lastSenderName || chat.chatId}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error ? <p className="pt-channel-error" role="alert">{error}</p> : null}
          <div className="pt-channel-actions">
            <Button onClick={() => setDraft(null)}>{t('channels.v2.cancel')}</Button>
            <Button type="primary" loading={busy} onClick={save}>
              {t('channels.v2.save')}
            </Button>
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
          <Button type="primary" icon={Plus} onClick={() => begin()}>
            {t('channels.v2.automations.add')}
          </Button>
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
              <button
                type="button"
                aria-label={t('channels.v2.runNow')}
                onClick={() => void channelActions.runAutomation(
                  binding.bindingId,
                  automation.automationId,
                )}
              >
                <Play size={15} />
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={automation.enabled}
                className={`pt-channel-switch${automation.enabled ? ' is-on' : ''}`}
                onClick={() => void toggle(automation)}
              ><span /></button>
              <button type="button" onClick={() => begin(automation)} aria-label={t('channels.v2.edit')}>
                <Pencil size={15} />
              </button>
              <button
                type="button"
                className="is-danger"
                aria-label={t('channels.v2.delete')}
                onClick={() => void channelActions.deleteAutomation(
                  binding.bindingId,
                  automation.automationId,
                )}
              >
                <Trash2 size={15} />
              </button>
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
            <label key={domain}>
              <input
                type="checkbox"
                checked={selected.has(domain)}
                disabled={locked.has(domain)}
                onChange={() => onToggle(domain)}
              />
              <span>{t(`channels.v2.personal.domain.${domain}`)}</span>
            </label>
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
                <QRCodeSVG
                  value={authorization.verificationUrl}
                  size={184}
                  level="M"
                />
                <Button
                  icon={<ExternalLink size={15} />}
                  onClick={() => api.openExternalUrl(authorization.verificationUrl)}
                >
                  {t('channels.v2.personal.openAuthorization')}
                </Button>
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
              danger
              loading={busy}
              icon={<X size={15} />}
              onClick={() => void cancel()}
            >
              {t('channels.v2.personal.cancelAuthorization')}
            </Button>
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
                  type="primary"
                  loading={busy}
                  disabled={!hasNewDomains}
                  icon={<Plus size={15} />}
                  onClick={() => void connect()}
                >
                  {t('channels.v2.personal.authorizeMore')}
                </Button>
              ) : (
                <Button
                  icon={<Plus size={15} />}
                  onClick={() => setDomainEditorBindingId(binding.bindingId)}
                >
                  {t('channels.v2.personal.addWorkAreas')}
                </Button>
              )}
              <Button
                loading={busy}
                icon={<RefreshCw size={15} />}
                onClick={() => void refresh()}
              >
                {t('channels.v2.personal.refresh')}
              </Button>
              <Button
                danger
                loading={busy}
                icon={<Trash2 size={15} />}
                onClick={() => void revoke()}
              >
                {t('channels.v2.personal.remove')}
              </Button>
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
              type="primary"
              loading={busy}
              disabled={!refreshable && selectedDomains.length === 0}
              icon={refreshable ? <RefreshCw size={15} /> : undefined}
              onClick={() => void (refreshable ? refresh() : connect())}
            >
              {refreshable
                ? t('channels.v2.personal.refresh')
                : needsRecovery
                ? t('channels.v2.personal.reconnect')
                : t('channels.v2.personal.connect')}
            </Button>
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
        <select
          value={binding.accessMode || 'approval'}
          onChange={(event) => void channelActions.updateBinding(
            binding.bindingId,
            { accessMode: event.target.value },
          )}
        >
          <option value="owner">{t('channels.v2.access.owner')}</option>
          <option value="approval">{t('channels.v2.access.approval')}</option>
          <option value="allowlist">{t('channels.v2.access.allowlist')}</option>
          <option value="open">{t('channels.v2.access.open')}</option>
        </select>
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
                  size="small"
                  onClick={() => void channelActions.decideMemberAccess(
                    binding.bindingId,
                    member.accessId,
                    'deny',
                  )}
                >
                  {t('channels.v2.access.deny')}
                </Button>
                <Button
                  size="small"
                  type="primary"
                  onClick={() => void channelActions.decideMemberAccess(
                    binding.bindingId,
                    member.accessId,
                    'allow',
                  )}
                >
                  {t('channels.v2.access.allow')}
                </Button>
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
        type="primary"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await channelActions.checkHealth(binding.bindingId);
          } finally {
            setBusy(false);
          }
        }}
      >
        <RefreshCw size={15} />
        {t('channels.v2.health.run')}
      </Button>
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
                size="small"
                onClick={() => void channelActions.retryDelivery(
                  binding.bindingId,
                  event.deliveryId,
                )}
              >
                {t('channels.v2.activity.retry')}
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      <Button onClick={() => void channelActions.exportDiagnostics(binding.bindingId)}>
        <Download size={15} />
        {t('channels.v2.activity.export')}
      </Button>
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
        <Button icon={RefreshCw} loading={loading} onClick={() => void load()}>
          {t('channels.v2.topics.refresh')}
        </Button>
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
          <input value={appId} onChange={(event) => setAppId(event.target.value)} />
        </label>
        <label>
          <span>{t('channels.config.lark.appSecret.label')}</span>
          <input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} />
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
            loading={busy}
            onClick={async () => {
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
          >
            {t('channels.v2.custom.check')}
          </Button>
          <Button
            type="primary"
            disabled={!validation?.valid}
            onClick={async () => {
              await channelActions.updateBinding(binding.bindingId, { appSecret: secret });
              setSecret('');
              setValidation(null);
              onBack();
            }}
          >
            {t('channels.v2.app.rotate')}
          </Button>
        </div>
        {validation?.consoleUrl ? (
          <Button onClick={() => api.openExternalUrl(validation.consoleUrl)}>
            <ExternalLink size={15} />
            {t('channels.v2.provision.openConsole')}
          </Button>
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
          <input
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
          <select
            value={binding.groupResponseMode || 'mention'}
            onChange={(event) => void update({ groupResponseMode: event.target.value })}
          >
            <option value="mention">{t('channels.v2.settings.mention')}</option>
            <option value="all">{t('channels.v2.settings.all')}</option>
            <option value="off">{t('channels.v2.settings.off')}</option>
          </select>
        </label>
        <label className="pt-channel-setting-row">
          <span><b>{t('channels.v2.settings.threadIsolation')}</b><small>{t('channels.v2.settings.threadIsolationDescription')}</small></span>
          <button
            type="button"
            role="switch"
            aria-checked={binding.threadIsolation}
            className={`pt-channel-switch${binding.threadIsolation ? ' is-on' : ''}`}
            onClick={() => void update({ threadIsolation: !binding.threadIsolation })}
          ><span /></button>
        </label>
        <label className="pt-channel-setting-row">
          <span><b>{t('channels.v2.settings.output')}</b></span>
          <select
            value={binding.outputMode || 'concise'}
            onChange={(event) => void update({ outputMode: event.target.value })}
          >
            <option value="concise">{t('channels.v2.settings.concise')}</option>
            <option value="detailed">{t('channels.v2.settings.detailed')}</option>
          </select>
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
