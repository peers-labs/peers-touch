import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { SearchBar } from '@lobehub/ui';
import {
  theme,
  Empty,
  Input,
  message as antMessage,
  Select,
  InputNumber,
} from 'antd';
import { Tag, Button } from '@lobehub/ui';
import {
  Settings2,
  ArrowLeft,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Bot,
  Brain,
  FolderOpen,
  Cpu,
  Wrench,
  Sparkles,
  Activity,
  Clock3,
  Search,
  Plus,
  Workflow,
} from 'lucide-react';
import { useAgentStore } from '../store/agent';
import {
  extractMessageArtifacts,
  useChatStore,
  type ChatMessage,
  type DelegationTaskInfo,
  type ToolCallInfo,
} from '../store/chat';
import {
  api,
  executeAgentTurn,
  type Agent,
  parseAgentChatConfig,
} from '../services/desktop_api';
import { ModelSelect } from '../components/ModelSelect';
import { AgentSettingsModal } from '../components/AgentSettingsModal';
import { BuilderPanel } from '../components/BuilderPanel';
import { AgentIconTile } from '../components/agent/AgentIconTile';
import { useSkillStore } from '../store/skill';
import { EVENT, eventBus } from '../kernel/events';
import { openAgentChatSession } from '../utils/openAgentChatSession';
import type { AgentTurnStreamEventPayload } from '../kernel/events/types';
import {
  DelegationStatus,
  TurnStatus,
  type TurnTraceEntry,
} from '../gen/proto/domain/agent/agent_pb';

interface AgentProfilePageProps {
  agentName: string;
  onBack?: () => void;
  onOpenOrchestration?: () => void;
  embedded?: boolean;
}


// ── Tab: Memories ────────────────────────────────────────────────────

const LAYERS = ['identity', 'context', 'experience', 'preference', 'activity'];
const LAYER_COLORS: Record<string, string> = {
  identity: 'blue',
  context: 'cyan',
  experience: 'green',
  preference: 'orange',
  activity: 'purple',
};

function MemoryTab({ agentName, agentId }: { agentName: string; agentId: string }) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const [memories, setMemories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLayer, setSelectedLayer] = useState<string>('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    setLoading(true);
    setLoadError('');
    Promise.all([
      api.listMemories({ agent_id: agentId, page_size: 50 } as any).catch(() => ({ memories: [] })),
      api.listMemories({ agent_id: agentName, page_size: 50 } as any).catch(() => ({ memories: [] })),
    ])
      .then(([byID, byName]: any[]) => {
        const merged = [...(byID?.memories || byID || []), ...(byName?.memories || byName || [])];
        const dedup = new Map<string, any>();
        for (const m of merged) dedup.set(m.id, m);
        setMemories(Array.from(dedup.values()));
      })
      .catch((err) => {
        setMemories([]);
        setLoadError(err?.message || t('agent.memory.loadFailed'));
      })
      .finally(() => setLoading(false));
  }, [agentName, agentId]);

  const filteredMemories = useMemo(() => {
    if (!selectedLayer) return memories;
    return memories.filter((m: any) => m.layer === selectedLayer);
  }, [memories, selectedLayer]);

  const layerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of memories) {
      counts[m.layer] = (counts[m.layer] || 0) + 1;
    }
    return counts;
  }, [memories]);

  if (loading) {
    return (
      <Flexbox style={{ flex: 1, padding: 2 }}>
        <span style={{ fontSize: 13, color: token.colorTextDescription, padding: '16px 0' }}>
          {t('agent.memory.loading')}
        </span>
      </Flexbox>
    );
  }

  return (
    <Flexbox style={{ flex: 1, padding: 2 }}>
      <Flexbox horizontal gap={4} style={{ flexShrink: 0, flexWrap: 'wrap', paddingBottom: 8 }}>
        <Tag
          style={{ cursor: 'pointer' }}
          color={!selectedLayer ? 'blue' : undefined}
          onClick={() => setSelectedLayer('')}
        >
          {t('agent.memory.all')} ({memories.length})
        </Tag>
        {LAYERS.map((l) => (
          <Tag
            key={l}
            style={{ cursor: 'pointer' }}
            color={selectedLayer === l ? LAYER_COLORS[l] : undefined}
            onClick={() => setSelectedLayer(selectedLayer === l ? '' : l)}
          >
            {l} ({layerCounts[l] || 0})
          </Tag>
        ))}
      </Flexbox>
      <Flexbox style={{ flex: 1, overflow: 'auto' }}>
        {filteredMemories.length === 0 ? (
          <Flexbox gap={6} style={{ padding: '12px 0' }}>
            <span style={{ fontSize: 13, color: token.colorTextDescription }}>
              {loadError
                ? loadError
                : memories.length === 0
                ? t('agent.memory.noMemories')
                : t('agent.memory.noMemoriesInLayer')}
            </span>
          </Flexbox>
        ) : (
          <Flexbox gap={6}>
            {filteredMemories.map((m: any) => (
              <Flexbox
                key={m.id}
                gap={4}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorBgContainer,
                }}
              >
                <Flexbox horizontal align="center" gap={6}>
                  <Tag color={LAYER_COLORS[m.layer]} style={{ margin: 0, fontSize: 11 }}>
                    {m.layer}
                  </Tag>
                  {m.access_count > 0 && (
                    <span style={{ fontSize: 11, color: token.colorTextDescription }}>
                      {t('agent.memory.accessCount', { count: m.access_count })}
                    </span>
                  )}
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: 11,
                      color: token.colorTextQuaternary,
                    }}
                  >
                    {new Date(m.created_at).toLocaleDateString()}
                  </span>
                </Flexbox>
                <span style={{ fontSize: 13, color: token.colorText, lineHeight: 1.5 }}>
                  {m.summary || JSON.stringify(m.content)}
                </span>
              </Flexbox>
            ))}
          </Flexbox>
        )}
      </Flexbox>
    </Flexbox>
  );
}

// ── Main Agent Profile Page ─────────────────────────────────────────

type ProfileTab = 'soul' | 'capabilities' | 'workspace' | 'tasks' | 'memories' | 'events';

const TAB_KEYS: { key: ProfileTab; labelKey: string; icon: ReactNode }[] = [
  { key: 'soul', labelKey: 'agent.profile.tab.prompt', icon: null },
  { key: 'capabilities', labelKey: 'agent.profile.tab.capabilities', icon: <Wrench size={13} /> },
  { key: 'workspace', labelKey: 'agent.profile.tab.runtime', icon: <FolderOpen size={13} /> },
];

const ACTIVITY_TAB_KEYS: { key: ProfileTab; labelKey: string; icon: ReactNode }[] = [
  { key: 'tasks', labelKey: 'agent.profile.tab.activity', icon: <Clock3 size={13} /> },
  { key: 'memories', labelKey: 'agent.profile.tab.memory', icon: <Brain size={13} /> },
  { key: 'events', labelKey: 'agent.profile.tab.diagnostics', icon: <Activity size={13} /> },
];


function AgentWorkbenchHero({
  agent,
  onBack,
  onOpenSettings,
  onTitleBlur,
  onDescriptionBlur,
  onRewriteDescription,
  onAvatarChange,
  descriptionGenerating,
}: {
  agent: Agent;
  onBack?: () => void;
  onOpenSettings: () => void;
  onTitleBlur: (value: string) => void;
  onDescriptionBlur: (value: string) => void;
  onRewriteDescription: () => void;
  onAvatarChange?: (emoji: string) => void;
  descriptionGenerating: boolean;
}) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const [title, setTitle] = useState(agent.title || agent.name);
  const [description, setDescription] = useState(agent.description || '');
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const titleRef = useRef(title);
  const descriptionRef = useRef(description);

  useEffect(() => {
    const nextTitle = agent.title || agent.name;
    const nextDescription = agent.description || '';
    titleRef.current = nextTitle;
    descriptionRef.current = nextDescription;
    setTitle(nextTitle);
    setDescription(nextDescription);
  }, [agent.id, agent.name, agent.title, agent.description]);

  return (
    <Flexbox
      gap={12}
      style={{
        paddingTop: 10,
        flexShrink: 0,
        color: token.colorText,
      }}
    >
      <Flexbox horizontal align="center" justify="space-between" gap={16} style={{ minWidth: 0 }}>
        <input
          value={title}
          onChange={(event) => {
            titleRef.current = event.target.value;
            setTitle(event.target.value);
          }}
          onInput={(event) => {
            titleRef.current = event.currentTarget.value;
          }}
          onBlur={(event) => onTitleBlur(titleRef.current || event.currentTarget.value)}
          placeholder={t('agent.profile.identityTitlePlaceholder')}
          style={{
            flex: 1,
            minWidth: 0,
            border: 0,
            outline: 'none',
            background: 'transparent',
            color: token.colorText,
            fontSize: 24,
            fontWeight: 800,
            lineHeight: 1.15,
            letterSpacing: -0.3,
            padding: 0,
          }}
        />
        <Flexbox horizontal gap={8} style={{ flexShrink: 0 }}>
          <Button
            icon={<Settings2 size={14} />}
            onClick={onOpenSettings}
            title={t('agent.profile.editSettings')}
            aria-label={t('agent.profile.editSettings')}
            style={{ width: 32, height: 32, padding: 0 }}
          />
          <Button icon={<ArrowLeft size={14} />} onClick={onBack}>
            {t('agent.profile.backToAgent')}
          </Button>
        </Flexbox>
      </Flexbox>

      <Flexbox horizontal align="flex-start" gap={14} style={{ minWidth: 0 }}>
        <div style={{ position: 'relative' }}>
          <AgentIconTile agent={agent} size={64} onClick={() => setEmojiPickerOpen((o) => !o)} />
          {emojiPickerOpen && (
            <div
              style={{
                position: 'absolute',
                top: 68,
                left: 0,
                zIndex: 100,
                background: token.colorBgElevated,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 12,
                padding: 8,
                display: 'grid',
                gridTemplateColumns: 'repeat(6, 1fr)',
                gap: 4,
                boxShadow: token.boxShadowSecondary,
              }}
            >
              {['🤖', '💻', '🧑‍💻', '🧠', '🎯', '🚀', '⚡', '🔬', '📊', '🎨', '🛠️', '📝', '🌐', '🔐', '💡', '🤝', '🎓', '🏗️'].map(
                (e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => {
                      onAvatarChange?.(e);
                      setEmojiPickerOpen(false);
                    }}
                    style={{
                      width: 32,
                      height: 32,
                      border: 0,
                      borderRadius: 6,
                      background: agent.avatar === e ? token.colorPrimaryBg : 'transparent',
                      fontSize: 18,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {e}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <textarea
            value={description}
            onChange={(event) => {
              descriptionRef.current = event.target.value;
              setDescription(event.target.value);
            }}
            onInput={(event) => {
              descriptionRef.current = event.currentTarget.value;
            }}
            onBlur={(event) => onDescriptionBlur(descriptionRef.current || event.currentTarget.value)}
            rows={3}
            placeholder={t('agent.profile.identityDescriptionPlaceholder')}
            style={{
              width: '100%',
              minHeight: 64,
              maxHeight: 108,
              resize: 'vertical',
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 12,
              outline: 'none',
              background: token.colorBgContainer,
              color: token.colorTextSecondary,
              fontFamily: 'inherit',
              fontSize: 13,
              lineHeight: 1.45,
              padding: '9px 38px 9px 10px',
              boxSizing: 'border-box',
            }}
          />
          <button
            type="button"
            title={t('agent.descriptionRewrite.generate')}
            onClick={onRewriteDescription}
            disabled={descriptionGenerating}
            style={{
              position: 'absolute',
              right: 8,
              bottom: 10,
              width: 26,
              height: 26,
              border: 0,
              borderRadius: 8,
              background: token.colorPrimaryBg,
              color: descriptionGenerating ? token.colorTextQuaternary : token.colorPrimary,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: descriptionGenerating ? 'not-allowed' : 'pointer',
            }}
          >
            <Sparkles size={14} />
          </button>
        </div>
      </Flexbox>
    </Flexbox>
  );
}

function ProfileCard({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const { token } = theme.useToken();
  return (
    <Flexbox
      gap={10}
      style={{
        padding: 14,
        borderRadius: 12,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
      }}
    >
      <Flexbox horizontal align="flex-start" justify="space-between" gap={12}>
        <Flexbox gap={2}>
          <span style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>{title}</span>
          {description && (
            <span style={{ fontSize: 12, color: token.colorTextDescription }}>{description}</span>
          )}
        </Flexbox>
        {action}
      </Flexbox>
      {children}
    </Flexbox>
  );
}

function InfoRow({ label, value }: { label: string; value?: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <Flexbox horizontal align="center" justify="space-between" gap={12}>
      <span style={{ fontSize: 12, color: token.colorTextSecondary }}>{label}</span>
      <span style={{ minWidth: 0, fontSize: 12, color: token.colorText, textAlign: 'right' }}>
        {value}
      </span>
    </Flexbox>
  );
}



function normalizeStringList(values?: string[]): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}






type AgentActivityStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'unknown';
type AgentActivityEventKind = 'turn' | 'tool' | 'approval' | 'delegation' | 'knowledge' | 'artifact' | 'error';

interface AgentActivityTaskProjection {
  id: string;
  title: string;
  status: AgentActivityStatus;
  source: 'turn' | 'delegation' | 'trace';
  startedAt: number;
  endedAt?: number;
  toolCount: number;
  eventCount: number;
}

interface AgentActivityEventProjection {
  id: string;
  kind: AgentActivityEventKind;
  status: AgentActivityStatus;
  detail: string;
  timestamp: number;
}

function truncateActivityText(value: string, fallback: string, maxLength = 96): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function statusFromToolCall(toolCall: ToolCallInfo): AgentActivityStatus {
  if (toolCall.status === 'approval_required') return 'waiting';
  if (toolCall.status === 'error') return 'failed';
  if (toolCall.status === 'cancelled') return 'cancelled';
  if (toolCall.pending || toolCall.status === 'approved' || toolCall.status === 'pending') return 'running';
  if (toolCall.status === 'success') return 'completed';
  if (toolCall.status === 'denied') return 'failed';
  return 'unknown';
}

function statusFromDelegation(delegation: DelegationTaskInfo): AgentActivityStatus {
  if (delegation.status === 'completed') return 'completed';
  if (delegation.status === 'failed' || delegation.status === 'timeout') return 'failed';
  return 'unknown';
}

function statusFromTurnStatus(status?: TurnStatus): AgentActivityStatus {
  if (status === TurnStatus.RUNNING) return 'running';
  if (status === TurnStatus.COMPLETED) return 'completed';
  if (status === TurnStatus.FAILED) return 'failed';
  if (status === TurnStatus.INTERRUPTED) return 'cancelled';
  return 'unknown';
}

function statusFromPersistedDelegation(status?: DelegationStatus): AgentActivityStatus {
  if (status === DelegationStatus.COMPLETED) return 'completed';
  if (status === DelegationStatus.FAILED || status === DelegationStatus.TIMEOUT) return 'failed';
  return 'unknown';
}

function protoTimestampToMs(timestamp?: { seconds: bigint; nanos: number }): number | undefined {
  if (!timestamp) return undefined;
  return Number(timestamp.seconds) * 1000 + Math.floor(timestamp.nanos / 1000000);
}

function statusFromAssistantMessage(message: ChatMessage): AgentActivityStatus {
  const toolCalls = message.toolCalls || [];
  if (message.error) return 'failed';
  if (toolCalls.some((toolCall) => statusFromToolCall(toolCall) === 'waiting')) return 'waiting';
  if (message.loading || toolCalls.some((toolCall) => statusFromToolCall(toolCall) === 'running')) return 'running';
  if (toolCalls.some((toolCall) => statusFromToolCall(toolCall) === 'failed')) return 'failed';
  return 'completed';
}

function buildAgentActivityProjections(messages: ChatMessage[], fallbackTitle: string): {
  tasks: AgentActivityTaskProjection[];
  events: AgentActivityEventProjection[];
} {
  const tasks: AgentActivityTaskProjection[] = [];
  const events: AgentActivityEventProjection[] = [];
  let latestUser: ChatMessage | undefined;

  for (const message of messages) {
    if (message.role === 'user') {
      latestUser = message;
      events.push({
        id: `${message.id}:turn-started`,
        kind: 'turn',
        status: 'running',
        detail: truncateActivityText(message.content, fallbackTitle),
        timestamp: message.timestamp,
      });
      continue;
    }

    if (message.role !== 'assistant') continue;

    const toolCalls = message.toolCalls || [];
    const delegations = [
      ...(message.delegationResults || []),
      ...toolCalls.flatMap((toolCall) => toolCall.delegationResults || []),
    ];
    const knowledgeChunks = message.knowledgeChunks || [];
    const artifacts = extractMessageArtifacts(message);
    const status = statusFromAssistantMessage(message);
    const eventCount = toolCalls.length + delegations.length + knowledgeChunks.length + artifacts.length + (message.error ? 1 : 0);

    tasks.push({
      id: message.id,
      title: truncateActivityText(latestUser?.content || message.content, fallbackTitle),
      status,
      source: 'turn',
      startedAt: latestUser?.timestamp || message.timestamp,
      endedAt: message.loading ? undefined : message.lastEventAt || message.timestamp,
      toolCount: toolCalls.length,
      eventCount: Math.max(eventCount, 1),
    });

    if (message.error) {
      events.push({
        id: `${message.id}:error`,
        kind: 'error',
        status: 'failed',
        detail: message.error,
        timestamp: message.lastEventAt || message.timestamp,
      });
    }

    for (const toolCall of toolCalls) {
      const toolStatus = statusFromToolCall(toolCall);
      events.push({
        id: `${message.id}:tool:${toolCall.id}`,
        kind: toolCall.status === 'approval_required' || toolCall.approvalId ? 'approval' : 'tool',
        status: toolStatus,
        detail: toolCall.serverName ? `${toolCall.serverName} / ${toolCall.name}` : toolCall.name,
        timestamp: message.lastEventAt || message.timestamp,
      });
    }

    for (const delegation of delegations) {
      tasks.push({
        id: delegation.taskId,
        title: truncateActivityText(delegation.taskDescription, fallbackTitle),
        status: statusFromDelegation(delegation),
        source: 'delegation',
        startedAt: delegation.startedAt ? Date.parse(delegation.startedAt) : message.timestamp,
        endedAt: delegation.endedAt ? Date.parse(delegation.endedAt) : undefined,
        toolCount: delegation.childToolset.length,
        eventCount: delegation.toolIterations,
      });
      events.push({
        id: `${message.id}:delegation:${delegation.taskId}`,
        kind: 'delegation',
        status: statusFromDelegation(delegation),
        detail: delegation.resultSummary || delegation.taskDescription,
        timestamp: delegation.endedAt ? Date.parse(delegation.endedAt) : message.lastEventAt || message.timestamp,
      });
    }

    if (knowledgeChunks.length > 0) {
      events.push({
        id: `${message.id}:knowledge`,
        kind: 'knowledge',
        status: 'completed',
        detail: knowledgeChunks.map((chunk) => chunk.resourceTitle || chunk.resourceId).join(', '),
        timestamp: message.lastEventAt || message.timestamp,
      });
    }

    if (artifacts.length > 0) {
      events.push({
        id: `${message.id}:artifact`,
        kind: 'artifact',
        status: 'completed',
        detail: artifacts.map((artifact) => artifact.title).join(', '),
        timestamp: message.lastEventAt || message.timestamp,
      });
    }
  }

  return {
    tasks: tasks.sort((left, right) => right.startedAt - left.startedAt),
    events: events.sort((left, right) => right.timestamp - left.timestamp),
  };
}

function buildPersistedAgentActivityProjections(entries: TurnTraceEntry[], fallbackTitle: string): {
  tasks: AgentActivityTaskProjection[];
  events: AgentActivityEventProjection[];
} {
  const tasks: AgentActivityTaskProjection[] = [];
  const events: AgentActivityEventProjection[] = [];

  for (const entry of entries) {
    const turn = entry.turn;
    const trace = entry.trace;
    if (!turn || !trace) continue;
    const startedAt = protoTimestampToMs(turn.startedAt) || Date.now();
    const endedAt = protoTimestampToMs(turn.endedAt);
    const status = statusFromTurnStatus(turn.status);
    const taskTitle = truncateActivityText(turn.userInput || turn.finalResponse, fallbackTitle);
    const eventCount =
      trace.toolCalls.length +
      trace.providerCalls.length +
      trace.errorsClassified.length +
      trace.delegationResults.length +
      trace.knowledgeChunks.length +
      (trace.reviewTriggered ? 1 : 0) +
      (trace.compressionEvent?.triggered ? 1 : 0);

    tasks.push({
      id: trace.traceId || turn.turnId,
      title: taskTitle,
      status,
      source: 'trace',
      startedAt,
      endedAt,
      toolCount: trace.toolCalls.length,
      eventCount: Math.max(eventCount, 1),
    });
    events.push({
      id: `${trace.traceId || turn.turnId}:turn`,
      kind: 'turn',
      status,
      detail: taskTitle,
      timestamp: startedAt,
    });

    trace.toolCalls.forEach((toolCall, index) => {
      events.push({
        id: `${trace.traceId || turn.turnId}:tool:${index}`,
        kind: 'tool',
        status: 'completed',
        detail: toolCall.toolName || fallbackTitle,
        timestamp: endedAt || startedAt,
      });
    });
    trace.providerCalls.forEach((providerCall, index) => {
      const detail = [providerCall.provider, providerCall.model].filter(Boolean).join(' / ');
      events.push({
        id: `${trace.traceId || turn.turnId}:provider:${index}`,
        kind: 'tool',
        status: 'completed',
        detail: detail || fallbackTitle,
        timestamp: endedAt || startedAt,
      });
    });
    trace.errorsClassified.forEach((errorEvent, index) => {
      events.push({
        id: `${trace.traceId || turn.turnId}:error:${index}`,
        kind: 'error',
        status: 'failed',
        detail: errorEvent.errorMessage || errorEvent.errorCode || fallbackTitle,
        timestamp: protoTimestampToMs(errorEvent.classifiedAt) || endedAt || startedAt,
      });
    });
    trace.delegationResults.forEach((delegation) => {
      const delegationStatus = statusFromPersistedDelegation(delegation.status);
      const delegationStartedAt = protoTimestampToMs(delegation.startedAt) || startedAt;
      const delegationEndedAt = protoTimestampToMs(delegation.endedAt);
      tasks.push({
        id: delegation.taskId,
        title: truncateActivityText(delegation.taskDescription, fallbackTitle),
        status: delegationStatus,
        source: 'delegation',
        startedAt: delegationStartedAt,
        endedAt: delegationEndedAt,
        toolCount: delegation.childToolset.length,
        eventCount: delegation.toolIterations,
      });
      events.push({
        id: `${trace.traceId || turn.turnId}:delegation:${delegation.taskId}`,
        kind: 'delegation',
        status: delegationStatus,
        detail: delegation.resultSummary || delegation.taskDescription || fallbackTitle,
        timestamp: delegationEndedAt || delegationStartedAt,
      });
    });
    if (trace.knowledgeChunks.length > 0) {
      events.push({
        id: `${trace.traceId || turn.turnId}:knowledge`,
        kind: 'knowledge',
        status: 'completed',
        detail: trace.knowledgeChunks.map((chunk) => chunk.resourceTitle || chunk.resourceId).filter(Boolean).join(', ') || fallbackTitle,
        timestamp: endedAt || startedAt,
      });
    }
  }

  return {
    tasks: tasks.sort((left, right) => right.startedAt - left.startedAt),
    events: events.sort((left, right) => right.timestamp - left.timestamp),
  };
}

function ActivityStatusTag({ status }: { status: AgentActivityStatus }) {
  const { t } = useTranslation('agent');
  const colorByStatus: Record<AgentActivityStatus, string> = {
    running: 'processing',
    waiting: 'warning',
    completed: 'success',
    failed: 'error',
    cancelled: 'default',
    unknown: 'default',
  };
  return <Tag color={colorByStatus[status]}>{t(`agent.profile.activity.status.${status}`)}</Tag>;
}

function formatActivityTime(timestamp?: number): string {
  if (!timestamp || Number.isNaN(timestamp)) return '';
  return new Date(timestamp).toLocaleString();
}

const ACTIVITY_TRACE_REFRESH_EVENTS = new Set([
  'progress',
  'tool_call',
  'tool_result',
  'tool_approval_required',
  'tool_approval_decision',
  'local_tool_request',
  'error',
  'done',
]);

function AgentActivityPanel({
  tasks,
  events,
  isCurrentAgentSession,
  currentSessionTitle,
  traceLoading,
  traceLoadError,
  persistedTraceCount,
}: {
  tasks: AgentActivityTaskProjection[];
  events: AgentActivityEventProjection[];
  isCurrentAgentSession: boolean;
  currentSessionTitle: string;
  traceLoading: boolean;
  traceLoadError: string;
  persistedTraceCount: number;
}) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();

  return (
    <Flexbox gap={12} style={{ overflow: 'auto' }}>
      <ProfileCard
        title={t('agent.profile.activity.persistentTrace')}
        description={t('agent.profile.activity.persistentTraceDesc')}
      >
        <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
          <Tag color={persistedTraceCount > 0 ? 'success' : 'default'}>
            {t('agent.profile.activity.traceCount', { count: persistedTraceCount })}
          </Tag>
          {traceLoading && <Tag color="processing">{t('agent.profile.activity.traceLoading')}</Tag>}
          {traceLoadError && <Tag color="error">{traceLoadError}</Tag>}
          {!isCurrentAgentSession && (
            <Tag color="warning">
              {t('agent.profile.activity.sessionMismatch', {
                session: currentSessionTitle || t('agent.profile.empty'),
              })}
            </Tag>
          )}
        </Flexbox>
      </ProfileCard>
      <ProfileCard title={t('agent.profile.activity.tasks')} description={t('agent.profile.activity.tasksDesc')}>
        {tasks.length === 0 ? (
          <Empty description={t('agent.profile.activity.noTasks')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Flexbox gap={8}>
            {tasks.map((task) => (
              <Flexbox
                key={`${task.source}:${task.id}`}
                gap={6}
                style={{
                  padding: 10,
                  borderRadius: 10,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorBgContainer,
                }}
              >
                <Flexbox horizontal align="center" justify="space-between" gap={8}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>{task.title}</span>
                  <ActivityStatusTag status={task.status} />
                </Flexbox>
                <Flexbox horizontal gap={6} style={{ flexWrap: 'wrap' }}>
                  <Tag>{t(`agent.profile.activity.source.${task.source}`)}</Tag>
                  <Tag>{t('agent.profile.activity.toolCount', { count: task.toolCount })}</Tag>
                  <Tag>{t('agent.profile.activity.eventCount', { count: task.eventCount })}</Tag>
                </Flexbox>
                <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
                  {formatActivityTime(task.startedAt)}
                  {task.endedAt ? ` · ${formatActivityTime(task.endedAt)}` : ''}
                </span>
              </Flexbox>
            ))}
          </Flexbox>
        )}
      </ProfileCard>
      <ProfileCard title={t('agent.profile.activity.events')} description={t('agent.profile.activity.eventsDesc')}>
        {events.length === 0 ? (
          <Empty description={t('agent.profile.activity.noEvents')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Flexbox gap={8}>
            {events.map((event) => (
              <Flexbox
                key={event.id}
                gap={4}
                style={{
                  padding: 10,
                  borderRadius: 10,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorFillQuaternary,
                }}
              >
                <Flexbox horizontal align="center" justify="space-between" gap={8}>
                  <Flexbox horizontal align="center" gap={6}>
                    <Tag>{t(`agent.profile.activity.event.${event.kind}`)}</Tag>
                    <ActivityStatusTag status={event.status} />
                  </Flexbox>
                  <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
                    {formatActivityTime(event.timestamp)}
                  </span>
                </Flexbox>
                <span style={{ fontSize: 12, color: token.colorTextSecondary, wordBreak: 'break-word' }}>
                  {truncateActivityText(event.detail, t('agent.profile.empty'), 180)}
                </span>
              </Flexbox>
            ))}
          </Flexbox>
        )}
      </ProfileCard>
    </Flexbox>
  );
}


function parseAllowedRootsForDisplay(value?: string): string {
  if (!value?.trim()) return '';
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean).join('\n');
    }
  } catch {
    return value;
  }
  return '';
}



export function AgentProfilePage({
  agentName,
  onBack,
  onOpenOrchestration,
  embedded = false,
}: AgentProfilePageProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const agents = useAgentStore(s => s.agents);
  const availableModels = useAgentStore(s => s.availableModels);
  const loadAgents = useAgentStore(s => s.loadAgents);
  const loadModels = useAgentStore(s => s.loadModels);
  const setSelectedAgent = useAgentStore(s => s.setSelectedAgent);
  const setAgentSurface = useAgentStore(s => s.setAgentSurface);
  const agentRosterOpen = useAgentStore(s => s.agentRosterOpen);
  const setAgentRosterOpen = useAgentStore(s => s.setAgentRosterOpen);

  const [profileAgentName, setProfileAgentName] = useState(agentName);
  const agentListOpen = agentRosterOpen;
  const setAgentListOpen = setAgentRosterOpen;
  const [agentSearch, setAgentSearch] = useState('');
  const [agent, setAgent] = useState<Agent | null>(null);
  const [soulMd, setSoulMd] = useState('');
  const [soulMdDirty, setSoulMdDirty] = useState(false);
  const [agentsMd, setAgentsMd] = useState('');
  const [agentsMdDirty, setAgentsMdDirty] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [activeTab, setActiveTab] = useState<ProfileTab>('soul');
  const [descriptionGenerating, setDescriptionGenerating] = useState(false);
  const [allowedRootsText, setAllowedRootsText] = useState('');
  const [persistedActivityProjection, setPersistedActivityProjection] = useState<{
    tasks: AgentActivityTaskProjection[];
    events: AgentActivityEventProjection[];
  }>({ tasks: [], events: [] });
  const [activityTraceLoading, setActivityTraceLoading] = useState(false);
  const [activityTraceLoadError, setActivityTraceLoadError] = useState('');
  const [persistedTraceCount, setPersistedTraceCount] = useState(0);
  const soulSaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const agentsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const skills = useSkillStore(s => s.skills);
  const builtins = useSkillStore(s => s.builtins);
  const loadSkills = useSkillStore(s => s.loadSkills);
  const activityMessages = useChatStore((state) => state.messages);
  const activityCurrentSessionKey = useChatStore((state) => state.currentSessionKey);
  const activitySessions = useChatStore((state) => state.sessions);
  const skillOptions = useMemo(
    () => [
      ...builtins.map((skill) => ({
        value: skill.identifier,
        label: `${skill.name} · ${t('agent.profile.skills.builtin')}`,
      })),
      ...skills.map((skill) => ({
        value: skill.id,
        label: skill.metaTitle || skill.name,
      })),
    ],
    [builtins, skills, t],
  );
  const filteredProfileAgents = useMemo(() => {
    const query = agentSearch.trim().toLowerCase();
    if (!query) return agents;
    return agents.filter((item) =>
      [item.title, item.name, item.description].some((value) => value.toLowerCase().includes(query)),
    );
  }, [agentSearch, agents]);
  const pinnedProfileAgents = filteredProfileAgents.filter((item) => item.pinned);
  const otherProfileAgents = filteredProfileAgents.filter((item) => !item.pinned);
  const collapsedPinnedAgents = agents.filter((item) => item.pinned);
  const collapsedOtherAgents = agents.filter((item) => !item.pinned);

  const handleSelectProfileAgent = useCallback((nextAgent: Agent) => {
    setSelectedAgent(nextAgent.name);
    void openAgentChatSession(nextAgent, {
      reason: 'profile-roster-switch',
      draftTitle: t('agent.sidebar.newTopic'),
    });
    onBack?.();
  }, [onBack, setSelectedAgent, t]);

  const skillLabelByValue = useMemo(() => {
    const labels = new Map<string, string>();
    for (const skill of builtins) {
      labels.set(skill.identifier, skill.name);
    }
    for (const skill of skills) {
      const label = skill.metaTitle || skill.name;
      labels.set(skill.id, label);
      labels.set(skill.identifier, label);
    }
    return labels;
  }, [builtins, skills]);

  useEffect(() => {
    loadAgents();
    loadModels();
    loadSkills();
  }, [loadAgents, loadModels, loadSkills]);

  // Refresh agent data when Agent Builder modifies the agent
  useEffect(() => {
    const handler = () => loadAgents();
    return eventBus.subscribe(EVENT.AGENT_BUILDER_STREAM_ENDED, handler);
  }, [loadAgents]);

  useEffect(() => {
    setProfileAgentName(agentName);
  }, [agentName]);

  useEffect(() => {
    const found = agents.find((a) => a.name === profileAgentName) || agents[0];
    if (found) {
      setAgent(found);
      setSoulMd(found.soulMd || '');
      setSoulMdDirty(false);
      setAgentsMd(found.agentsMd || '');
      setAgentsMdDirty(false);
      setAllowedRootsText(parseAllowedRootsForDisplay(found.allowedRoots));
    }
  }, [agents, profileAgentName]);

  useEffect(() => {
    return () => {
      if (soulSaveTimerRef.current) clearTimeout(soulSaveTimerRef.current);
      if (agentsSaveTimerRef.current) clearTimeout(agentsSaveTimerRef.current);
    };
  }, []);



  const saveSoulMd = useCallback(
    async (value: string) => {
      if (!agent) return;
      try {
        await api.updateAgent(agent.id, { soulMd: value });
        setSoulMdDirty(false);
        loadAgents();
      } catch (err: any) {
        antMessage.error(err.message || t('agent.profile.failedToSave'));
      }
    },
    [agent, loadAgents, t],
  );

  const handleSoulMdChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setSoulMd(value);
      setSoulMdDirty(true);
      if (soulSaveTimerRef.current) clearTimeout(soulSaveTimerRef.current);
      soulSaveTimerRef.current = setTimeout(() => saveSoulMd(value), 1500);
    },
    [saveSoulMd],
  );

  const handleSoulMdBlur = useCallback(() => {
    if (soulMdDirty) {
      if (soulSaveTimerRef.current) clearTimeout(soulSaveTimerRef.current);
      saveSoulMd(soulMd);
    }
  }, [soulMdDirty, soulMd, saveSoulMd]);

  const saveAgentsMd = useCallback(
    async (value: string) => {
      if (!agent) return;
      try {
        await api.updateAgent(agent.id, { agentsMd: value });
        setAgentsMdDirty(false);
        loadAgents();
      } catch (err: any) {
        antMessage.error(err.message || t('agent.profile.failedToSave'));
      }
    },
    [agent, loadAgents, t],
  );

  const handleAgentsMdChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setAgentsMd(value);
      setAgentsMdDirty(true);
      if (agentsSaveTimerRef.current) clearTimeout(agentsSaveTimerRef.current);
      agentsSaveTimerRef.current = setTimeout(() => saveAgentsMd(value), 1500);
    },
    [saveAgentsMd],
  );

  const handleAgentsMdBlur = useCallback(() => {
    if (agentsMdDirty) {
      if (agentsSaveTimerRef.current) clearTimeout(agentsSaveTimerRef.current);
      saveAgentsMd(agentsMd);
    }
  }, [agentsMdDirty, agentsMd, saveAgentsMd]);

  const handleEffortChange = useCallback(
    async (value: string) => {
      if (!agent) return;
      try {
        await api.updateAgent(agent.id, { effort: value });
        loadAgents();
      } catch (err: any) {
        antMessage.error(err.message || t('agent.profile.failedToSave'));
      }
    },
    [agent, loadAgents, t],
  );



  const handleIsolationRetentionDaysChange = useCallback(
    async (value: number | null) => {
      if (!agent) return;
      try {
        await api.updateAgent(agent.id, { isolationRetentionDays: value ?? 7 });
        loadAgents();
      } catch (err: any) {
        antMessage.error(err.message || t('agent.profile.failedToSave'));
      }
    },
    [agent, loadAgents, t],
  );

  const handleWorkspaceModeChange = useCallback(
    async (value: string) => {
      if (!agent) return;
      try {
        await api.updateAgent(agent.id, { workspaceMode: value });
        loadAgents();
      } catch (err: any) {
        antMessage.error(err.message || t('agent.profile.failedToSave'));
      }
    },
    [agent, loadAgents, t],
  );





  const handleAllowedRootsBlur = useCallback(
    async () => {
      if (!agent) return;
      const roots = allowedRootsText
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean);
      const value = JSON.stringify(roots);
      if (value === (agent.allowedRoots || '[]')) return;
      try {
        await api.updateAgent(agent.id, { allowedRoots: value });
        loadAgents();
      } catch (err: any) {
        antMessage.error(err.message || t('agent.profile.failedToSave'));
      }
    },
    [agent, loadAgents, t],
  );



  const handleModelChange = useCallback(
    async (modelId: string) => {
      if (!agent) return;
      const m = availableModels.find((x) => x.id === modelId);
      const providerId = m?.provider_id || '';
      try {
        await api.updateAgent(agent.id, { model: modelId || '', provider: providerId });
        if (modelId) {
          await api.setModelConfig(`agent:${agent.name}`, { provider: providerId, model: modelId });
        } else {
          await api.deleteModelConfig(`agent:${agent.name}`);
        }
        loadAgents();
      } catch (err: any) {
        antMessage.error(err.message || t('agent.profile.failedToUpdateModel'));
      }
    },
    [agent, availableModels, loadAgents],
  );

  const handleProviderChange = useCallback(
    async (providerId: string) => {
      if (!agent) return;
      const currentModel = availableModels.find((item) => item.id === agent.model);
      const shouldClearModel = !!currentModel && currentModel.provider_id !== providerId;
      try {
        await api.updateAgent(agent.id, {
          provider: providerId || '',
          model: shouldClearModel ? '' : agent.model,
        });
        if (shouldClearModel) {
          await api.deleteModelConfig(`agent:${agent.name}`);
        }
        loadAgents();
      } catch (err: any) {
        antMessage.error(err.message || t('agent.profile.failedToUpdateModel'));
      }
    },
    [agent, availableModels, loadAgents, t],
  );

  const handleTitleBlur = useCallback(
    async (rawValue: string) => {
      if (!agent) return;
      const value = rawValue.trim();
      if (!value || value === (agent.title || agent.name)) return;
      try {
        const updated = await api.updateAgent(agent.id, { title: value });
        setAgent(updated);
        await loadAgents();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('agent.profile.failedToSave');
        antMessage.error(message);
      }
    },
    [agent, loadAgents, t],
  );

  const handleDescriptionBlur = useCallback(
    async (rawValue: string) => {
      if (!agent) return;
      const value = rawValue.trim();
      if (value === (agent.description || '').trim()) return;
      try {
        const updated = await api.updateAgent(agent.id, { description: value });
        setAgent(updated);
        await loadAgents();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('agent.profile.failedToSave');
        antMessage.error(message);
      }
    },
    [agent, loadAgents, t],
  );

  const handleAvatarChange = useCallback(
    async (emoji: string) => {
      if (!agent) return;
      try {
        const updated = await api.updateAgent(agent.id, { avatar: emoji });
        setAgent(updated);
        await loadAgents();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('agent.profile.failedToSave');
        antMessage.error(message);
      }
    },
    [agent, loadAgents, t],
  );

  const handleSettingsSaved = useCallback(
    (updated: Agent) => {
      setAgent(updated);
      setSettingsOpen(false);
      loadAgents();
    },
    [loadAgents],
  );

  const handleCreateAgent = useCallback(async () => {
    const suffix = Date.now().toString(36);
    try {
      const created = await api.createAgent({
        name: `agent-${suffix}`,
        title: t('agent.profile.identityTitlePlaceholder'),
        description: '',
        avatar: '',
        soulMd: '# SOUL.md\n\n## Identity\n',
        agentsMd: '# AGENTS.md\n\n## Workflow\n',
        effort: 'medium',
        visibility: 'private',
        workspaceMode: 'agent',
      });
      setAgentSurface(created.name, 'profile');
      setProfileAgentName(created.name);
      setAgent(created);
      setSoulMd(created.soulMd || '');
      setSoulMdDirty(false);
      setAgentsMd(created.agentsMd || '');
      setAgentsMdDirty(false);
      window.history.pushState(null, '', `#/agent-profile/${encodeURIComponent(created.name)}`);
      await loadAgents();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('agent.profile.failedToSave');
      antMessage.error(message);
    }
  }, [loadAgents, setAgentSurface, t]);

  const handleBoundSkillsChange = useCallback(
    async (values: string[]) => {
      if (!agent) return;
      const config = parseAgentChatConfig(agent);
      try {
        const updated = await api.updateAgent(agent.id, {
          chatConfig: JSON.stringify({
            ...config,
            skills: normalizeStringList(values),
          }),
        });
        setAgent(updated);
        await loadAgents();
        antMessage.success(t('agent.profile.skills.boundUpdated'));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('agent.profile.failedToSave');
        antMessage.error(message);
      }
    },
    [agent, loadAgents, t],
  );









  const handleInlineRewriteDescription = useCallback(async () => {
    if (!agent) return;
    const intent = agent.description?.trim() || agent.title || agent.name;
    setDescriptionGenerating(true);
    const sessionKey = `agent_description:${agent.id}`;
    const prompt = [
      'Rewrite this Agent description for A2A routing.',
      'Return one concise sentence only. Do not include markdown or quotes.',
      `Agent name: ${agent.title || agent.name}`,
      `Current description: ${intent}`,
    ].join('\n');
    let content = '';

    try {
      await new Promise<void>((resolve, reject) => {
        executeAgentTurn(
          prompt,
          sessionKey,
          'agent-builder',
          (event) => {
            if (event.event === 'text') content += event.data?.content || '';
          },
          () => resolve(),
          (error) => reject(error),
        );
      });
      const updatedDescription = content.replace(/^```[a-z]*|```$/g, '').replace(/^description\s*[:：]/i, '').trim();
      if (!updatedDescription) throw new Error(t('agent.descriptionRewrite.parseFailed'));
      const updated = await api.updateAgent(agent.id, { description: updatedDescription });
      setAgent(updated);
      await loadAgents();
      antMessage.success(t('agent.descriptionRewrite.applied'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      antMessage.error(message || t('agent.descriptionRewrite.parseFailed'));
    } finally {
      setDescriptionGenerating(false);
    }
  }, [agent, loadAgents, t]);











  const loadActivityTraces = useCallback(async (ignore?: () => boolean) => {
    if (!agent) return;
    setActivityTraceLoading(true);
    setActivityTraceLoadError('');
    try {
      const response = await api.listAgentTurnTraces(agent.id, { pageSize: 20 });
      if (ignore?.()) return;
      setPersistedTraceCount(response.total);
      setPersistedActivityProjection(buildPersistedAgentActivityProjections(
        response.entries || [],
        t('agent.profile.activity.defaultTaskTitle'),
      ));
    } catch {
      if (ignore?.()) return;
      const message = t('agent.profile.activity.traceLoadFailed');
      setPersistedTraceCount(0);
      setPersistedActivityProjection({ tasks: [], events: [] });
      setActivityTraceLoadError(message);
    } finally {
      if (!ignore?.()) setActivityTraceLoading(false);
    }
  }, [agent, t]);

  useEffect(() => {
    if (!agent || !['tasks', 'events'].includes(activeTab)) return;
    let ignore = false;
    loadActivityTraces(() => ignore);
    return () => {
      ignore = true;
    };
  }, [activeTab, agent, loadActivityTraces]);

  useEffect(() => {
    if (!agent || !['tasks', 'events'].includes(activeTab)) return;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = eventBus.subscribe(
      EVENT.AGENT_TURN_STREAM_EVENT,
      (payload: AgentTurnStreamEventPayload) => {
        if (payload.agentId !== agent.id && payload.agentId !== agent.name) return;
        if (!ACTIVITY_TRACE_REFRESH_EVENTS.has(payload.event)) return;
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          loadActivityTraces();
        }, payload.event === 'done' || payload.event === 'error' ? 0 : 500);
      },
    );
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [activeTab, agent, loadActivityTraces]);

  if (!agent) {
    return (
      <Flexbox align="center" justify="center" style={{ height: '100%' }}>
        <Empty description={t('agent.profile.notFound')} />
        {onBack && (
          <Button type="link" onClick={onBack}>
            {t('agent.profile.goBack')}
          </Button>
        )}
      </Flexbox>
    );
  }

  const chatConfig = parseAgentChatConfig(agent);
  const workspaceRoot = chatConfig.workspace?.root?.trim();
  const mcpServers = chatConfig.mcpServers || [];
  const boundTools = chatConfig.tools || [];
  const boundSkills = chatConfig.skills || [];
  const boundSkillLabels = boundSkills.map((skill) => skillLabelByValue.get(skill) || skill);
  const activityCurrentSession = activitySessions.find((session) => session.key === activityCurrentSessionKey);
  const isCurrentAgentActivitySession =
    activityCurrentSession?.agent_name === agent.name || activityCurrentSession?.agent_name === agent.id;
  const localActivityProjection = buildAgentActivityProjections(
    isCurrentAgentActivitySession ? activityMessages : [],
    t('agent.profile.activity.defaultTaskTitle'),
  );
  const activityProjection = {
    tasks: [...persistedActivityProjection.tasks, ...localActivityProjection.tasks]
      .sort((left, right) => right.startedAt - left.startedAt),
    events: [...persistedActivityProjection.events, ...localActivityProjection.events]
      .sort((left, right) => right.timestamp - left.timestamp),
  };
  const selectedModel = availableModels.find((model) => model.id === agent.model);
  const selectedProviderId = agent.provider || selectedModel?.provider_id || '';
  const providerOptions = Array.from(
    new Map(
      availableModels
        .filter((model) => model.enabled)
        .map((model) => [
          model.provider_id || model.provider_name,
          {
            value: model.provider_id || model.provider_name,
            label: model.provider_name || model.provider_id,
          },
        ]),
    ).values(),
  ).filter((option) => option.value);
  const routingModels = selectedProviderId
    ? availableModels.filter((model) => model.provider_id === selectedProviderId)
    : availableModels;
  const modelLabel = selectedModel?.display_name || agent.model || t('agent.profile.defaultModel');
  const hasLocalToolBindings = boundTools.length > 0 || mcpServers.length > 0 || boundSkills.length > 0;
  const activeTabLabel = t(TAB_KEYS.find((tab) => tab.key === activeTab)?.labelKey || ACTIVITY_TAB_KEYS.find((tab) => tab.key === activeTab)?.labelKey || 'agent.profile.tab.prompt');
  const builderContextSummary = [
    {
      label: t('agent.builder.context.model'),
      value: modelLabel,
      ready: Boolean(agent.model || selectedModel),
      targetTab: 'workspace' as ProfileTab,
    },
    {
      label: t('agent.builder.context.capabilities'),
      value: t('agent.profile.bindingSummary', {
        tools: boundTools.length,
        skills: boundSkills.length,
        mcp: mcpServers.length,
        knowledge: 0,
      }),
      ready: hasLocalToolBindings,
      targetTab: 'capabilities' as ProfileTab,
    },
    {
      label: t('agent.builder.context.focus'),
      value: activeTabLabel,
      ready: true,
      targetTab: activeTab,
    },
  ];
  const builderContextPayload = {
    target_agent: {
      id: agent.id,
      name: agent.name,
      title: agent.title || agent.name,
      description: agent.description || '',
      system_prompt_configured: Boolean((agent.systemPrompt || '').trim()),
    },
    workbench: {
      active_tab: activeTab,
      active_tab_label: activeTabLabel,
    },
    runtime: {
      model_id: agent.model || '',
      model_label: modelLabel,
      model_type: selectedModel?.type || '',
    },
    context: {
      workspace_root_configured: Boolean(workspaceRoot),
      workspace_root: workspaceRoot || '',
      memory_enabled: Boolean(chatConfig.memory?.enabled),
      search_mode: chatConfig.searchMode || '',
    },
    bindings: {
      tools: boundTools,
      mcp_servers: mcpServers,
      skills: boundSkills,
    },
  };
  const activeMode = ACTIVITY_TAB_KEYS.some((tab) => tab.key === activeTab) ? 'activity' : 'configure';
  const visibleTabs = activeMode === 'activity' ? ACTIVITY_TAB_KEYS : TAB_KEYS;

  return (
    <Flexbox horizontal style={{ height: '100%', width: '100%', minWidth: 0, overflow: 'auto' }}>
      {!embedded && <aside
        style={{
          width: agentListOpen ? 230 : 48,
          height: '100%',
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          padding: agentListOpen ? '14px 10px 58px' : '14px 0 58px',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      >
        {agentListOpen ? (
          <>
            <Flexbox horizontal align="center" style={{ height: 36, marginBottom: 8 }}>
              <Bot size={18} color={token.colorPrimary} />
              <span style={{ flex: 1, marginLeft: 8, fontSize: 15, fontWeight: 800, color: token.colorText }}>
                {t('agent.chat.myAgents')}
              </span>
              {onOpenOrchestration && (
                <button
                  type="button"
                  onClick={onOpenOrchestration}
                  title={t('agent.chat.openCanvas')}
                  style={{
                    width: 28,
                    height: 28,
                    marginRight: 4,
                    border: 0,
                    borderRadius: 8,
                    background: 'transparent',
                    color: token.colorTextSecondary,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <Workflow size={17} />
                </button>
              )}
              <button
                type="button"
                onClick={handleCreateAgent}
                title={t('agent.sidebar.createAgent')}
                style={{
                  width: 28,
                  height: 28,
                  border: 0,
                  borderRadius: 8,
                  background: 'transparent',
                  color: token.colorTextSecondary,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <Plus size={17} />
              </button>
            </Flexbox>
            <div style={{ marginBottom: 12 }}>
              <SearchBar
                value={agentSearch}
                onChange={(event) => setAgentSearch(event.target.value)}
                placeholder={t('agent.sidebar.searchAgents')}
                spotlight={false}
                size="small"
                style={{ height: 36 }}
              />
            </div>
            <Flexbox flex={1} gap={2} style={{ minHeight: 0, overflow: 'auto', padding: '0 0 10px' }}>
              {pinnedProfileAgents.length > 0 && (
                <div style={{ padding: '8px 8px 4px', color: token.colorTextTertiary, fontSize: 11, fontWeight: 800 }}>
                  {t('agent.chat.pinned')}
                </div>
              )}
              {pinnedProfileAgents.map((item) => {
                const active = agent?.name === item.name;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectProfileAgent(item)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      minHeight: 48,
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: 10,
                      border: 0,
                      background: active ? token.colorFillSecondary : 'transparent',
                      color: token.colorText,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <AgentIconTile agent={item} size={32} selected={active} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.title || item.name}
                      </span>
                      <span style={{ display: 'block', fontSize: 11, color: token.colorTextTertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.description || t('agent.canvas.agentFallback')}
                      </span>
                    </span>
                    <MoreHorizontal size={14} color={token.colorTextTertiary} />
                  </button>
                );
              })}
              <div style={{ padding: '8px 8px 4px', color: token.colorTextTertiary, fontSize: 11, fontWeight: 800 }}>
                {t('agent.chat.allAgents')}
              </div>
              {otherProfileAgents.map((item) => {
                const active = agent?.name === item.name;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectProfileAgent(item)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      minHeight: 48,
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: 10,
                      border: 0,
                      background: active ? token.colorFillSecondary : 'transparent',
                      color: token.colorText,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <AgentIconTile agent={item} size={32} selected={active} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.title || item.name}
                      </span>
                      <span style={{ display: 'block', fontSize: 11, color: token.colorTextTertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.description || t('agent.canvas.agentFallback')}
                      </span>
                    </span>
                    <MoreHorizontal size={14} color={token.colorTextTertiary} />
                  </button>
                );
              })}
              {filteredProfileAgents.length === 0 && (
                <Empty description={t('agent.sidebar.noMatchingAgents')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Flexbox>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={handleCreateAgent}
              title={t('agent.sidebar.createAgent')}
              style={{
                width: 40,
                height: 40,
                margin: '0 auto 10px',
                border: 0,
                borderRadius: 12,
                background: 'transparent',
                color: token.colorTextSecondary,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <Plus size={18} />
            </button>
            <button
              type="button"
              onClick={() => setAgentListOpen(true)}
              title={t('agent.sidebar.searchAgents')}
              style={{
                width: 40,
                height: 40,
                margin: '0 auto 2px',
                border: 0,
                borderRadius: 12,
                background: 'transparent',
                color: token.colorTextSecondary,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <Search size={18} />
            </button>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
              {collapsedPinnedAgents.length > 0 && <div style={{ width: 28, height: 1, margin: '18px 0 12px', background: token.colorBorderSecondary }} />}
              {collapsedPinnedAgents.map((item) => {
                const active = agent?.name === item.name;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      handleSelectProfileAgent(item);
                    }}
                    title={item.title || item.name}
                    style={{
                      width: 40,
                      height: 48,
                      borderRadius: 12,
                      border: 0,
                      background: active ? token.colorFillSecondary : 'transparent',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <AgentIconTile agent={item} size={30} selected={active} />
                  </button>
                );
              })}
              {collapsedOtherAgents.length > 0 && <div style={{ width: 28, height: 1, margin: '18px 0 12px', background: token.colorBorderSecondary }} />}
              {collapsedOtherAgents.map((item) => {
                const active = agent?.name === item.name;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      handleSelectProfileAgent(item);
                    }}
                    title={item.title || item.name}
                    style={{
                      width: 40,
                      height: 48,
                      borderRadius: 12,
                      border: 0,
                      background: active ? token.colorFillSecondary : 'transparent',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <AgentIconTile agent={item} size={30} selected={active} />
                  </button>
                );
              })}
            </div>
          </>
        )}
        <button
          type="button"
          onClick={() => setAgentListOpen(!agentListOpen)}
          title={t(agentListOpen ? 'agent.sidebar.collapseAgents' : 'agent.sidebar.expandAgents')}
          style={{
            position: 'absolute',
            left: 7,
            bottom: 14,
            width: 34,
            height: 34,
            borderRadius: 999,
            border: 0,
            background: 'transparent',
            boxShadow: 'none',
            color: token.colorTextSecondary,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          {agentListOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
      </aside>}

      {/* ── Center: Profile Editor ── */}
      <Flexbox flex={1} style={{ minWidth: embedded ? 0 : 680, minHeight: 0, overflow: 'hidden' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
            padding: '0 20px 20px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              minHeight: 0,
              maxWidth: 760,
              margin: '0 auto',
              width: '100%',
            }}
          >
            {/* ── Workbench Hero ── */}
            <div style={{ flexShrink: 0 }}>
              <AgentWorkbenchHero
                key={agent.id}
                agent={agent}
                onBack={onBack}
                onOpenSettings={() => setSettingsOpen(true)}
                onTitleBlur={handleTitleBlur}
                onDescriptionBlur={handleDescriptionBlur}
                onRewriteDescription={handleInlineRewriteDescription}
                onAvatarChange={handleAvatarChange}
                descriptionGenerating={descriptionGenerating}
              />
            </div>

            <div
              style={{
                flexShrink: 0,
                marginTop: 10,
                marginBottom: 10,
                display: 'grid',
                gridTemplateColumns: 'minmax(130px, 190px) auto minmax(160px, 1fr) auto minmax(96px, 120px)',
                alignItems: 'center',
                gap: 10,
                padding: 14,
                borderRadius: 12,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
                minWidth: 0,
              }}
            >
              <Select
                value={selectedProviderId || undefined}
                onChange={handleProviderChange}
                placeholder={t('agent.profile.routing.providerPlaceholder')}
                allowClear
                showSearch
                size="middle"
                options={providerOptions}
                style={{ width: '100%' }}
                filterOption={(input, option) =>
                  String(option?.label || '').toLowerCase().includes(input.toLowerCase())
                }
              />
              <span style={{ color: token.colorTextQuaternary, fontSize: 13 }}>→</span>
              <div style={{ minWidth: 0 }}>
                <ModelSelect
                  models={routingModels}
                  value={agent.model || undefined}
                  onChange={handleModelChange}
                  placeholder={t('agent.profile.routing.modelPlaceholder')}
                  size="middle"
                  style={{ width: '100%', minWidth: 0 }}
                />
              </div>
              <span style={{ color: token.colorTextQuaternary, fontSize: 13 }}>·</span>
              <Select
                value={agent.effort || 'medium'}
                onChange={handleEffortChange}
                placeholder={t('agent.profile.routing.effortPlaceholder')}
                size="middle"
                style={{ width: '100%' }}
                options={[
                  { value: 'low', label: t('agent.profile.effort.low') },
                  { value: 'medium', label: t('agent.profile.effort.medium') },
                  { value: 'high', label: t('agent.profile.effort.high') },
                ]}
              />
            </div>

            {/* ── Prototype-aligned mode switch: Configure vs Activity ── */}
            <Flexbox
              horizontal
              align="center"
              gap={2}
              style={{
                alignSelf: 'flex-start',
                flexShrink: 0,
                padding: 3,
                marginBottom: 12,
                borderRadius: 10,
                background: token.colorFillQuaternary,
              }}
            >
              {([
                { key: 'configure', label: t('agent.profile.mode.configure'), target: 'soul' as ProfileTab },
                { key: 'activity', label: t('agent.profile.mode.activity'), target: 'tasks' as ProfileTab },
              ] as const).map((mode) => (
                <button
                  key={mode.key}
                  type="button"
                  onClick={() => setActiveTab(mode.target)}
                  style={{
                    height: 30,
                    padding: '0 18px',
                    borderRadius: 8,
                    border: 0,
                    background: activeMode === mode.key ? token.colorBgContainer : 'transparent',
                    color: activeMode === mode.key ? token.colorText : token.colorTextTertiary,
                    boxShadow: activeMode === mode.key ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {mode.label}
                </button>
              ))}
            </Flexbox>

            {/* ── Tab bar (no font-weight change to prevent wobble) ── */}
            <div style={{ display: 'flex', gap: 4, flexShrink: 0, borderBottom: `1px solid ${token.colorBorderSecondary}`, marginBottom: 12, flexWrap: 'wrap' }}>
              {visibleTabs.map((tab) => (
                <div
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '8px 12px',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    color:
                      activeTab === tab.key ? token.colorPrimary : token.colorTextSecondary,
                    borderBottom: `2px solid ${
                      activeTab === tab.key ? token.colorPrimary : 'transparent'
                    }`,
                    transition: 'color 0.2s, border-color 0.2s',
                  }}
                >
                  <span style={{ width: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {tab.icon}
                  </span>
                  <span style={{ lineHeight: '18px' }}>
                    {t(tab.labelKey)}
                  </span>
                </div>
              ))}
            </div>

            {/* ── Tab content (fills remaining space) ── */}
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                paddingTop: 0,
                paddingBottom: 16,
                overflow: 'auto',
              }}
            >

              {activeTab === 'soul' && (
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'grid', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, minHeight: 0 }}>
                    <ProfileCard title={t('agent.profile.section.soulMd')}>
                      <textarea
                        value={soulMd}
                        onChange={handleSoulMdChange}
                        onBlur={handleSoulMdBlur}
                        placeholder={t('agent.profile.soulMdPlaceholder')}
                        style={{
                          width: '100%',
                          minHeight: 280,
                          padding: '12px 16px',
                          borderRadius: 8,
                          border: `1px solid ${token.colorBorderSecondary}`,
                          background: token.colorBgContainer,
                          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                          fontSize: 13,
                          lineHeight: 1.7,
                          resize: 'vertical',
                          outline: 'none',
                          color: token.colorText,
                        }}
                        onFocus={(e) => {
                          (e.target as HTMLElement).style.borderColor = token.colorPrimary;
                        }}
                        onBlurCapture={(e) => {
                          (e.target as HTMLElement).style.borderColor = token.colorBorderSecondary;
                        }}
                      />
                    </ProfileCard>
                    <ProfileCard title={t('agent.profile.section.agentsMd')}>
                      <textarea
                        value={agentsMd}
                        onChange={handleAgentsMdChange}
                        onBlur={handleAgentsMdBlur}
                        placeholder={t('agent.profile.agentsMdPlaceholder')}
                        style={{
                          width: '100%',
                          minHeight: 280,
                          padding: '12px 16px',
                          borderRadius: 8,
                          border: `1px solid ${token.colorBorderSecondary}`,
                          background: token.colorBgContainer,
                          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                          fontSize: 13,
                          lineHeight: 1.7,
                          resize: 'vertical',
                          outline: 'none',
                          color: token.colorText,
                        }}
                        onFocus={(e) => {
                          (e.target as HTMLElement).style.borderColor = token.colorPrimary;
                        }}
                        onBlurCapture={(e) => {
                          (e.target as HTMLElement).style.borderColor = token.colorBorderSecondary;
                        }}
                      />
                    </ProfileCard>
                  </div>
                </div>
              )}


              {activeTab === 'workspace' && (
                <div
                  style={{
                    overflow: 'auto',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                    gap: 12,
                    alignContent: 'start',
                  }}
                >
                  <ProfileCard title={t('agent.profile.section.agentWorkspace')} description={t('agent.profile.section.agentWorkspaceDesc')}>
                    <InfoRow label={t('agent.profile.field.workspaceRoot')} value={workspaceRoot || t('agent.profile.workspaceNotSet')} />
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 6 }}>
                        {t('agent.profile.field.workspaceMode')}
                      </div>
                      <Select
                        value={agent.workspaceMode || 'agent'}
                        onChange={handleWorkspaceModeChange}
                        style={{ minWidth: 180 }}
                        options={[
                          { value: 'agent', label: t('agent.profile.workspaceMode.agent') },
                          { value: 'task', label: t('agent.profile.workspaceMode.task') },
                        ]}
                      />
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 6 }}>
                        {t('agent.profile.field.workspaceRetentionDays')}
                      </div>
                      <InputNumber
                        min={1}
                        max={90}
                        value={agent.isolationRetentionDays ?? 7}
                        onChange={handleIsolationRetentionDaysChange}
                        style={{ minWidth: 140 }}
                      />
                    </div>
                  </ProfileCard>
                  <ProfileCard title={t('agent.profile.section.accessBoundary')} description={t('agent.profile.section.accessBoundaryDesc')}>
                    <InfoRow label={t('agent.profile.field.agentWorkspace')} value={t('agent.profile.accessBoundary.agentWorkspaceAllowed')} />
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 6 }}>
                        {t('agent.profile.field.allowedRoots')}
                      </div>
                      <Input.TextArea
                        value={allowedRootsText}
                        onChange={(event) => setAllowedRootsText(event.target.value)}
                        onBlur={handleAllowedRootsBlur}
                        placeholder={t('agent.profile.allowedRootsPlaceholder')}
                        autoSize={{ minRows: 2, maxRows: 4 }}
                      />
                    </div>
                  </ProfileCard>
                </div>
              )}

              {activeTab === 'capabilities' && (
                <div
                  style={{
                    overflow: 'auto',
                    display: 'grid',
                    gridTemplateRows: '1fr 1fr',
                    gap: 12,
                    minHeight: 0,
                  }}
                >
                  <ProfileCard
                    title={t('agent.profile.section.skillPackages')}
                    description={t('agent.profile.section.skillPackagesDesc')}
                  >
                    <Flexbox gap={8} style={{ minHeight: 0 }}>
                      <Select
                        mode="multiple"
                        value={boundSkills}
                        onChange={handleBoundSkillsChange}
                        options={skillOptions}
                        placeholder={t('agent.profile.skills.bindPlaceholder')}
                        optionFilterProp="label"
                        style={{ width: '100%' }}
                      />
                      {boundSkillLabels.length === 0 ? (
                        <Empty description={t('agent.profile.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                      ) : (
                        <Flexbox gap={6} style={{ overflow: 'auto', paddingRight: 2 }}>
                          {boundSkillLabels.map((skill) => (
                            <Flexbox
                              key={skill}
                              horizontal
                              align="center"
                              gap={10}
                              style={{
                                minHeight: 40,
                                padding: '7px 10px',
                                borderRadius: 12,
                                border: `1px solid ${token.colorBorderSecondary}`,
                                background: token.colorBgContainer,
                              }}
                            >
                              <span style={{ width: 26, height: 26, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: token.colorPrimaryBg, color: token.colorPrimary, fontWeight: 800 }}>#</span>
                              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: token.colorText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{skill}</span>
                              <Tag style={{ margin: 0 }}>{t('agent.profile.enabled')}</Tag>
                            </Flexbox>
                          ))}
                        </Flexbox>
                      )}
                    </Flexbox>
                  </ProfileCard>

                  <ProfileCard
                    title={t('agent.profile.section.toolsAndMcp')}
                    description={t('agent.profile.section.toolsAndMcpDesc')}
                    action={(
                      <Button
                        size="small"
                        icon={<Settings2 size={14} />}
                        onClick={() => setSettingsOpen(true)}
                        title={t('agent.profile.editSettings')}
                        aria-label={t('agent.profile.editSettings')}
                        style={{ width: 32, height: 32, padding: 0 }}
                      />
                    )}
                  >
                    <Flexbox gap={6} style={{ minHeight: 0, overflow: 'auto' }}>
                      {boundTools.length === 0 && mcpServers.length === 0 ? (
                        <Empty description={t('agent.profile.mcpEmpty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                      ) : null}
                      {boundTools.map((tool) => (
                        <Flexbox
                          key={`tool-${tool}`}
                          horizontal
                          align="center"
                          gap={10}
                          style={{
                            minHeight: 38,
                            padding: '7px 10px',
                            borderRadius: 12,
                            border: `1px solid ${token.colorBorderSecondary}`,
                            background: token.colorBgContainer,
                          }}
                        >
                          <Wrench size={15} color={token.colorTextTertiary} />
                          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: token.colorText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tool}</span>
                          <Tag style={{ margin: 0 }}>{t('agent.profile.tag.tool')}</Tag>
                        </Flexbox>
                      ))}
                      {mcpServers.map((server) => (
                        <Flexbox
                          key={`mcp-${server}`}
                          horizontal
                          align="center"
                          gap={10}
                          style={{
                            minHeight: 38,
                            padding: '7px 10px',
                            borderRadius: 12,
                            border: `1px solid ${token.colorBorderSecondary}`,
                            background: token.colorBgContainer,
                          }}
                        >
                          <Cpu size={15} color={token.colorTextTertiary} />
                          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: token.colorText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{server}</span>
                          <Tag style={{ margin: 0 }}>{t('agent.profile.tag.mcp')}</Tag>
                        </Flexbox>
                      ))}
                    </Flexbox>
                  </ProfileCard>
                </div>
              )}

              {activeTab === 'memories' && <MemoryTab agentName={agent.name} agentId={agent.id} />}


              {activeTab === 'tasks' && (
                <AgentActivityPanel
                  tasks={activityProjection.tasks}
                  events={activityProjection.events}
                  isCurrentAgentSession={isCurrentAgentActivitySession}
                  currentSessionTitle={activityCurrentSession?.title || activityCurrentSession?.key || ''}
                  traceLoading={activityTraceLoading}
                  traceLoadError={activityTraceLoadError}
                  persistedTraceCount={persistedTraceCount}
                />
              )}


              {activeTab === 'events' && (
                <Flexbox gap={8} style={{ overflow: 'auto' }}>
                  {activityProjection.events.length === 0 ? (
                    <Empty description={t('agent.profile.activity.noEvents')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    activityProjection.events.map((event) => (
                      <div
                        key={event.id}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 12,
                          border: `1px solid ${token.colorBorderSecondary}`,
                          background: token.colorBgContainer,
                        }}
                      >
                        <Flexbox horizontal align="center" justify="space-between" gap={10}>
                          <span style={{ fontSize: 13, color: token.colorText }}>{event.detail}</span>
                          <Tag style={{ margin: 0 }}>{event.kind}</Tag>
                        </Flexbox>
                      </div>
                    ))
                  )}
                </Flexbox>
              )}

            </div>
          </div>
        </div>
      </Flexbox>

      {/* ── Right: Agent Builder Panel ── */}
      <BuilderPanel
        agentName="agent-builder"
        scope="agent_builder"
        welcomeTitle={t('agent.builder.title')}
        welcomeDescription={t('agent.builder.description')}
        suggestQuestions={[
          t('agent.builder.suggest.optimizeDescription'),
          t('agent.builder.suggest.customerSupport'),
          t('agent.builder.suggest.codeReview'),
          t('agent.builder.suggest.researchAnalyst'),
        ]}
        contextSummary={builderContextSummary}
        onContextItemClick={(targetTab) => {
          const nextTab = targetTab as ProfileTab;
          if ([...TAB_KEYS, ...ACTIVITY_TAB_KEYS].some((tab) => tab.key === nextTab)) setActiveTab(nextTab);
        }}
        contextPayload={builderContextPayload}
        expand={showBuilder}
        onExpandChange={setShowBuilder}
        defaultWidth={320}
        minWidth={320}
        maxWidth={480}
      />

      {/* Advanced Settings Modal */}
      {settingsOpen && (
        <AgentSettingsModal
          open={settingsOpen}
          agent={agent}
          onClose={() => setSettingsOpen(false)}
          onSaved={handleSettingsSaved}
        />
      )}
    </Flexbox>
  );
}
