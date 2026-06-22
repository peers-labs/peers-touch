import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { EmojiPicker } from '@lobehub/ui';
import {
  theme,
  Divider,
  Empty,
  Input,
  message as antMessage,
  Select,
} from 'antd';
import { Tag, Button } from '@lobehub/ui';
import {
  Settings2,
  Play,
  Brain,
  Zap,
  Plus,
  FolderOpen,
  Cpu,
  Wrench,
  Eye,
  Sparkles,
  Network,
  BookOpen,
  Users,
  Activity,
  Database,
  Trash2,
  Download,
  ShieldCheck,
} from 'lucide-react';
import { useAgentStore } from '../store/agent';
import { buildAgentTurnDiagnosticsExport } from '../diagnostics/agentTurnDiagnostics';
import { useChatStore } from '../store/chat';
import {
  api,
  executeAgentTurn,
  type Agent,
  type AgentKnowledgeResource,
  type AgentKnowledgeResourcePolicy,
  type AgentKnowledgeResourceType,
  parseAgentKnowledgeResources,
  parseAgentChatConfig,
  parseAgentParams,
} from '../services/desktop_api';
import { ModelSelect } from '../components/ModelSelect';
import { AgentSettingsModal } from '../components/AgentSettingsModal';
import { BuilderPanel } from '../components/BuilderPanel';
import { SkillAppletTagBar } from '../components/SkillAppletSelector';
import { EVENT, eventBus } from '../kernel/events';

interface AgentProfilePageProps {
  agentName: string;
  onBack?: () => void;
  onStartChat: (agentName: string) => void;
  onNavigateCron?: () => void;
  onNavigateSkills?: () => void;
  onNavigateApplets?: () => void;
}

// ── Tab: Scheduled Tasks ─────────────────────────────────────────────

function CronTab({ agentName, onNavigateCron }: { agentName: string; onNavigateCron?: () => void }) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.listCronJobs()
      .then((all) =>
        setJobs(all.filter((j: any) => j.agentName === agentName || j.agent_name === agentName)),
      )
      .catch(() => setJobs([]))
      .finally(() => setLoading(false));
  }, [agentName]);

  if (loading) return null;

  return (
    <Flexbox style={{ flex: 1, padding: 2 }}>
      <Flexbox horizontal justify="flex-end" style={{ flexShrink: 0, paddingBottom: 8 }}>
        <Button size="small" icon={<Plus size={14} />} onClick={onNavigateCron}>
          {t('agent.cron.addTask')}
        </Button>
      </Flexbox>
      <Flexbox style={{ flex: 1, overflow: 'auto' }}>
        {jobs.length === 0 ? (
          <span style={{ fontSize: 13, color: token.colorTextDescription, padding: '16px 0' }}>
            {t('agent.cron.noTasks')}
          </span>
        ) : (
          <Flexbox gap={6}>
            {jobs.map((job: any) => (
              <Flexbox
                key={job.id}
                horizontal
                align="center"
                gap={8}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorBgContainer,
                }}
              >
                <Zap
                  size={14}
                  style={{ color: job.enabled ? token.colorSuccess : token.colorTextQuaternary }}
                />
                <span style={{ flex: 1, fontSize: 13, color: token.colorText }}>{job.name}</span>
                <Tag>{job.scheduleKind || job.schedule_kind || 'cron'}</Tag>
                <Tag color={job.enabled ? 'green' : 'default'}>
                  {job.enabled ? t('agent.cron.active') : t('agent.cron.paused')}
                </Tag>
              </Flexbox>
            ))}
          </Flexbox>
        )}
      </Flexbox>
    </Flexbox>
  );
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

type ProfileTab =
  | 'overview'
  | 'prompt'
  | 'model'
  | 'runtime'
  | 'tools'
  | 'mcp'
  | 'skills'
  | 'memory'
  | 'knowledge'
  | 'collaboration'
  | 'diagnostics';

const TAB_KEYS: { key: ProfileTab; labelKey: string; icon: ReactNode }[] = [
  { key: 'overview', labelKey: 'agent.profile.tab.overview', icon: <Settings2 size={13} /> },
  { key: 'prompt', labelKey: 'agent.profile.tab.prompt', icon: null },
  { key: 'model', labelKey: 'agent.profile.tab.model', icon: <Cpu size={13} /> },
  { key: 'runtime', labelKey: 'agent.profile.tab.runtime', icon: <Zap size={13} /> },
  { key: 'tools', labelKey: 'agent.profile.tab.tools', icon: <Wrench size={13} /> },
  { key: 'mcp', labelKey: 'agent.profile.tab.mcp', icon: <Network size={13} /> },
  { key: 'skills', labelKey: 'agent.profile.tab.skills', icon: <BookOpen size={13} /> },
  { key: 'memory', labelKey: 'agent.profile.tab.memory', icon: <Brain size={13} /> },
  { key: 'knowledge', labelKey: 'agent.profile.tab.knowledge', icon: <Database size={13} /> },
  { key: 'collaboration', labelKey: 'agent.profile.tab.collaboration', icon: <Users size={13} /> },
  { key: 'diagnostics', labelKey: 'agent.profile.tab.diagnostics', icon: <Activity size={13} /> },
];

interface WorkbenchSignal {
  key: string;
  icon: ReactNode;
  label: string;
  value: string;
  ready: boolean;
  targetTab: ProfileTab;
}

interface WorkbenchStep {
  key: string;
  label: string;
  description: string;
  complete: boolean;
  targetTab: ProfileTab;
}

function AgentWorkbenchHero({
  agent,
  modelLabel,
  workspaceRoot,
  signals,
  steps,
  activeTab,
  onSelectTab,
  onStartChat,
  onOpenSettings,
  onAvatarChange,
}: {
  agent: Agent;
  modelLabel: string;
  workspaceRoot?: string;
  signals: WorkbenchSignal[];
  steps: WorkbenchStep[];
  activeTab: ProfileTab;
  onSelectTab: (tab: ProfileTab) => void;
  onStartChat: () => void;
  onOpenSettings: () => void;
  onAvatarChange: (emoji: string) => void;
}) {
  const { t } = useTranslation('agent');
  const completedSteps = steps.filter((step) => step.complete).length;
  const progress = Math.round((completedSteps / Math.max(steps.length, 1)) * 100);

  return (
    <Flexbox
      gap={16}
      style={{
        padding: 18,
        borderRadius: 24,
        color: '#fff',
        background:
          'radial-gradient(circle at top left, rgba(255,255,255,0.26), transparent 30%), linear-gradient(135deg, #0f172a 0%, #1d4ed8 48%, #7c3aed 100%)',
        boxShadow: '0 26px 80px rgba(15, 23, 42, 0.22)',
      }}
    >
      <Flexbox horizontal align="flex-start" justify="space-between" gap={16}>
        <Flexbox horizontal align="center" gap={14} style={{ minWidth: 0 }}>
          <EmojiPicker
            value={agent.avatar || '🤖'}
            size={68}
            shape="square"
            background={agent.backgroundColor || 'linear-gradient(135deg, #667eea, #764ba2)'}
            onChange={onAvatarChange}
          />
          <Flexbox gap={6} style={{ minWidth: 0 }}>
            <Flexbox horizontal align="center" gap={8} style={{ flexWrap: 'wrap' }}>
              <Tag style={{ margin: 0, color: '#fff', borderColor: 'rgba(255,255,255,0.34)', background: 'rgba(255,255,255,0.15)' }}>
                {t('agent.profile.workbench.badge')}
              </Tag>
              {agent.isDefault && (
                <Tag style={{ margin: 0, color: '#fff', borderColor: 'rgba(255,255,255,0.34)', background: 'rgba(255,255,255,0.15)' }}>
                  {t('agent.profile.builtIn')}
                </Tag>
              )}
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)' }}>
                {t('agent.profile.workbench.progress', { done: completedSteps, total: steps.length, progress })}
              </span>
            </Flexbox>
            <span style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.1, letterSpacing: -0.5 }}>
              {agent.title || agent.name}
            </span>
            <span style={{ maxWidth: 640, fontSize: 13, lineHeight: 1.6, color: 'rgba(255,255,255,0.76)' }}>
              {agent.description || t('agent.profile.workbench.descriptionFallback')}
            </span>
          </Flexbox>
        </Flexbox>

        <Flexbox horizontal gap={8} style={{ flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Button icon={<Settings2 size={14} />} onClick={onOpenSettings}>
            {t('agent.profile.editSettings')}
          </Button>
          <Button type="primary" icon={<Play size={14} />} onClick={onStartChat}>
            {t('agent.profile.startConversation')}
          </Button>
        </Flexbox>
      </Flexbox>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
        {signals.map((signal) => (
          <button
            key={signal.key}
            type="button"
            onClick={() => onSelectTab(signal.targetTab)}
            style={{
              minHeight: 86,
              padding: 12,
              borderRadius: 16,
              border: `1px solid ${activeTab === signal.targetTab ? 'rgba(255,255,255,0.62)' : 'rgba(255,255,255,0.18)'}`,
              background: activeTab === signal.targetTab ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.11)',
              color: '#fff',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <Flexbox gap={8}>
              <Flexbox horizontal align="center" justify="space-between" gap={8}>
                <span style={{ display: 'inline-flex', color: signal.ready ? '#bbf7d0' : '#fde68a' }}>
                  {signal.icon}
                </span>
                <Tag style={{ margin: 0, color: '#fff', borderColor: 'rgba(255,255,255,0.28)', background: 'rgba(255,255,255,0.13)' }}>
                  {signal.ready ? t('agent.profile.workbench.ready') : t('agent.profile.workbench.needsSetup')}
                </Tag>
              </Flexbox>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.66)' }}>{signal.label}</span>
              <span style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {signal.value}
              </span>
            </Flexbox>
          </button>
        ))}
      </div>

      <Flexbox gap={8}>
        <Flexbox horizontal align="center" justify="space-between" gap={10}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{t('agent.profile.workbench.nextActions')}</span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.68)' }}>
            {t('agent.profile.workbench.modelAndWorkspace', {
              model: modelLabel,
              workspace: workspaceRoot || t('agent.profile.workspaceNotSet'),
            })}
          </span>
        </Flexbox>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
          {steps.map((step) => (
            <button
              key={step.key}
              type="button"
              onClick={() => onSelectTab(step.targetTab)}
              style={{
                padding: 10,
                borderRadius: 14,
                border: `1px solid ${step.complete ? 'rgba(187,247,208,0.5)' : 'rgba(255,255,255,0.18)'}`,
                background: step.complete ? 'rgba(22,163,74,0.18)' : 'rgba(255,255,255,0.09)',
                color: '#fff',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <Flexbox gap={6}>
                <Flexbox horizontal align="center" gap={7}>
                  <ShieldCheck size={14} style={{ color: step.complete ? '#bbf7d0' : '#fde68a' }} />
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{step.label}</span>
                </Flexbox>
                <span style={{ fontSize: 11, lineHeight: 1.45, color: 'rgba(255,255,255,0.66)' }}>
                  {step.description}
                </span>
              </Flexbox>
            </button>
          ))}
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
          <span style={{ fontSize: 14, fontWeight: 600, color: token.colorText }}>{title}</span>
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

function PillList({ values, emptyText }: { values?: string[]; emptyText: string }) {
  const { token } = theme.useToken();
  if (!values || values.length === 0) {
    return <span style={{ fontSize: 12, color: token.colorTextDescription }}>{emptyText}</span>;
  }
  return (
    <Flexbox horizontal gap={6} style={{ flexWrap: 'wrap' }}>
      {values.map((value) => (
        <Tag key={value}>{value}</Tag>
      ))}
    </Flexbox>
  );
}

function parseStringList(raw?: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return raw
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

const PROMPT_VARIABLES = ['agent', 'user', 'date', 'workspace', 'model'];

function extractPromptVariables(prompt: string): string[] {
  const matches = prompt.matchAll(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g);
  return Array.from(new Set(Array.from(matches, (match) => match[1])));
}

function estimatePromptTokens(prompt: string): number {
  return Math.ceil(prompt.trim().length / 4);
}

function buildPromptPreview(prompt: string, values: Record<string, string>): string {
  return prompt.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (_, key: string) => {
    return values[key] ?? `{{${key}}}`;
  });
}

function formatContextWindow(value?: number): string {
  if (!value || value <= 0) return '';
  if (value >= 1000000) return `${(value / 1000000).toFixed(value % 1000000 === 0 ? 0 : 1)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(value);
}

function CapabilityBadge({
  icon,
  label,
  enabled,
}: {
  icon: ReactNode;
  label: string;
  enabled: boolean;
}) {
  const { token } = theme.useToken();
  return (
    <Flexbox
      horizontal
      align="center"
      gap={6}
      style={{
        padding: '6px 8px',
        borderRadius: 8,
        border: `1px solid ${enabled ? token.colorSuccessBorder : token.colorBorderSecondary}`,
        background: enabled ? token.colorSuccessBg : token.colorFillQuaternary,
        color: enabled ? token.colorSuccessText : token.colorTextDescription,
        fontSize: 12,
      }}
    >
      {icon}
      <span>{label}</span>
    </Flexbox>
  );
}

type RuntimeCapabilityState = 'native' | 'partial' | 'unavailable';

function RuntimeCapabilityBadge({
  label,
  state,
  detail,
}: {
  label: string;
  state: RuntimeCapabilityState;
  detail: string;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('agent');
  const color = state === 'native' ? 'success' : state === 'partial' ? 'warning' : 'default';
  const borderColor = state === 'native'
    ? token.colorSuccessBorder
    : state === 'partial'
      ? token.colorWarningBorder
      : token.colorBorderSecondary;
  const background = state === 'native'
    ? token.colorSuccessBg
    : state === 'partial'
      ? token.colorWarningBg
      : token.colorFillQuaternary;

  return (
    <Flexbox
      gap={4}
      style={{
        padding: '8px 10px',
        borderRadius: 8,
        border: `1px solid ${borderColor}`,
        background,
        minWidth: 190,
        flex: 1,
      }}
    >
      <Flexbox horizontal align="center" justify="space-between" gap={8}>
        <span style={{ fontSize: 12, fontWeight: 600, color: token.colorText }}>{label}</span>
        <Tag color={color} style={{ margin: 0 }}>{t(`agent.profile.degradation.${state}`)}</Tag>
      </Flexbox>
      <span style={{ fontSize: 11, color: token.colorTextSecondary }}>{detail}</span>
    </Flexbox>
  );
}

const KNOWLEDGE_RESOURCE_TYPES: AgentKnowledgeResourceType[] = ['document', 'folder', 'project', 'url', 'notebook', 'workspace'];
const KNOWLEDGE_RESOURCE_POLICIES: AgentKnowledgeResourcePolicy[] = ['manual', 'auto', 'always', 'disabled'];

function createKnowledgeResourceId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `knowledge-${Date.now()}`;
}

function KnowledgeResourceList({
  resources,
  onRemove,
}: {
  resources: AgentKnowledgeResource[];
  onRemove: (resourceId: string) => void;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('agent');

  if (resources.length === 0) {
    return <Empty description={t('agent.profile.knowledge.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <Flexbox gap={8}>
      {resources.map((resource) => (
        <Flexbox
          key={resource.id}
          gap={6}
          style={{
            padding: 10,
            borderRadius: 10,
            border: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorFillQuaternary,
          }}
        >
          <Flexbox horizontal align="flex-start" justify="space-between" gap={10}>
            <Flexbox gap={4} style={{ minWidth: 0 }}>
              <Flexbox horizontal align="center" gap={6}>
                <Tag>{t(`agent.profile.knowledge.type.${resource.type}`)}</Tag>
                <Tag>{t(`agent.profile.knowledge.policy.${resource.policy}`)}</Tag>
                <Tag color={resource.status === 'error' ? 'error' : resource.status === 'indexed' ? 'success' : 'processing'}>
                  {t(`agent.profile.knowledge.status.${resource.status}`)}
                </Tag>
              </Flexbox>
              <span style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>{resource.title}</span>
              <span style={{ fontSize: 12, color: token.colorTextSecondary, wordBreak: 'break-all' }}>{resource.source}</span>
              <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
                {t('agent.profile.knowledge.lastIndexedAt')}: {resource.lastIndexedAt || t('agent.profile.knowledge.notIndexed')}
              </span>
              {resource.error && (
                <span style={{ fontSize: 11, color: token.colorErrorText }}>{resource.error}</span>
              )}
            </Flexbox>
            <Button
              size="small"
              icon={<Trash2 size={13} />}
              onClick={() => onRemove(resource.id)}
            >
              {t('agent.profile.knowledge.remove')}
            </Button>
          </Flexbox>
        </Flexbox>
      ))}
    </Flexbox>
  );
}

interface AgentMetadataDraft {
  title: string;
  description: string;
  tags: string[];
  openingMessage: string;
  openingQuestions: string[];
  systemPrompt: string;
}

function sanitizeDraftList(values?: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 6);
}

function extractJsonObject(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start >= 0 && end > start) return content.slice(start, end + 1);
  return content;
}

function parseMetadataDraft(content: string, fallback: AgentMetadataDraft): AgentMetadataDraft {
  const parsed = JSON.parse(extractJsonObject(content)) as Partial<Record<keyof AgentMetadataDraft, unknown>>;
  return {
    title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : fallback.title,
    description:
      typeof parsed.description === 'string' && parsed.description.trim()
        ? parsed.description.trim()
        : fallback.description,
    tags: sanitizeDraftList(parsed.tags).length > 0 ? sanitizeDraftList(parsed.tags) : fallback.tags,
    openingMessage:
      typeof parsed.openingMessage === 'string' && parsed.openingMessage.trim()
        ? parsed.openingMessage.trim()
        : fallback.openingMessage,
    openingQuestions:
      sanitizeDraftList(parsed.openingQuestions).length > 0
        ? sanitizeDraftList(parsed.openingQuestions)
        : fallback.openingQuestions,
    systemPrompt:
      typeof parsed.systemPrompt === 'string' && parsed.systemPrompt.trim()
        ? parsed.systemPrompt.trim()
        : fallback.systemPrompt,
  };
}

function buildMetadataPrompt(agent: Agent, intent: string, currentTags: string[], currentQuestions: string[]): string {
  return [
    'You are helping refine an AI agent profile. Return only a valid JSON object with these fields:',
    'title, description, tags, openingMessage, openingQuestions, systemPrompt.',
    'Rules: title should be concise; description should explain user value; tags and openingQuestions are string arrays; systemPrompt must be actionable and specific.',
    '',
    `User intent: ${intent}`,
    '',
    'Current agent:',
    JSON.stringify(
      {
        name: agent.name,
        title: agent.title,
        description: agent.description,
        tags: currentTags,
        openingMessage: agent.openingMessage,
        openingQuestions: currentQuestions,
        systemPrompt: agent.systemPrompt,
      },
      null,
      2,
    ),
  ].join('\n');
}

export function AgentProfilePage({
  agentName,
  onBack,
  onStartChat,
  onNavigateCron,
  onNavigateSkills,
  onNavigateApplets,
}: AgentProfilePageProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const { agents, availableModels, loadAgents, loadModels } = useAgentStore();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [promptDirty, setPromptDirty] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showBuilder, setShowBuilder] = useState(true);
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');
  const [metadataIntent, setMetadataIntent] = useState('');
  const [metadataDraft, setMetadataDraft] = useState<AgentMetadataDraft | null>(null);
  const [metadataGenerating, setMetadataGenerating] = useState(false);
  const [metadataApplying, setMetadataApplying] = useState(false);
  const [metadataError, setMetadataError] = useState('');
  const [knowledgeType, setKnowledgeType] = useState<AgentKnowledgeResourceType>('document');
  const [knowledgePolicy, setKnowledgePolicy] = useState<AgentKnowledgeResourcePolicy>('manual');
  const [knowledgeTitle, setKnowledgeTitle] = useState('');
  const [knowledgeSource, setKnowledgeSource] = useState('');
  const [exportingAgentPackage, setExportingAgentPackage] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    loadAgents();
    loadModels();
  }, [loadAgents, loadModels]);

  // Refresh agent data when Agent Builder modifies the agent
  useEffect(() => {
    const handler = () => loadAgents();
    return eventBus.subscribe(EVENT.AGENT_BUILDER_STREAM_ENDED, handler);
  }, [loadAgents]);

  useEffect(() => {
    const found = agents.find((a) => a.name === agentName);
    if (found) {
      setAgent(found);
      setSystemPrompt(found.systemPrompt || '');
      setPromptDirty(false);
    }
  }, [agents, agentName]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const savePrompt = useCallback(
    async (value: string) => {
      if (!agent) return;
      const invalidVariables = extractPromptVariables(value).filter((item) => !PROMPT_VARIABLES.includes(item));
      if (invalidVariables.length > 0) {
        antMessage.error(t('agent.profile.promptInvalidVariables', { variables: invalidVariables.join(', ') }));
        return;
      }
      try {
        await api.updateAgent(agent.id, { systemPrompt: value });
        setPromptDirty(false);
        loadAgents();
      } catch (err: any) {
        antMessage.error(err.message || t('agent.profile.failedToSave'));
      }
    },
    [agent, loadAgents, t],
  );

  const handlePromptChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setSystemPrompt(value);
      setPromptDirty(true);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => savePrompt(value), 1500);
    },
    [savePrompt],
  );

  const handlePromptBlur = useCallback(() => {
    if (promptDirty) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      savePrompt(systemPrompt);
    }
  }, [promptDirty, systemPrompt, savePrompt]);

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

  const handleAvatarChange = useCallback(
    async (emoji: string) => {
      if (!agent) return;
      try {
        await api.updateAgent(agent.id, { avatar: emoji });
        loadAgents();
      } catch (err: any) {
        antMessage.error(err.message || t('agent.profile.failedToUpdateAvatar'));
      }
    },
    [agent, loadAgents],
  );

  const handleSettingsSaved = useCallback(
    (updated: Agent) => {
      setAgent(updated);
      setSettingsOpen(false);
      loadAgents();
    },
    [loadAgents],
  );

  const handleGenerateMetadata = useCallback(async () => {
    if (!agent) return;
    const intent = metadataIntent.trim();
    if (!intent) {
      antMessage.warning(t('agent.metadata.intentRequired'));
      return;
    }

    setMetadataGenerating(true);
    setMetadataError('');
    setMetadataDraft(null);

    const fallback: AgentMetadataDraft = {
      title: agent.title || agent.name,
      description: agent.description || '',
      tags: parseStringList(agent.tags),
      openingMessage: agent.openingMessage || '',
      openingQuestions: parseStringList(agent.openingQuestions),
      systemPrompt: agent.systemPrompt || '',
    };

    const sessionKey = `agent_metadata:${agent.id}`;
    const prompt = buildMetadataPrompt(agent, intent, fallback.tags, fallback.openingQuestions);
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
      setMetadataDraft(parseMetadataDraft(content, fallback));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMetadataError(message || t('agent.metadata.parseFailed'));
    } finally {
      setMetadataGenerating(false);
    }
  }, [agent, metadataIntent, t]);

  const handleApplyMetadataDraft = useCallback(async () => {
    if (!agent || !metadataDraft) return;
    setMetadataApplying(true);
    try {
      const updated = await api.updateAgent(agent.id, {
        title: metadataDraft.title,
        description: metadataDraft.description,
        tags: JSON.stringify(metadataDraft.tags),
        openingMessage: metadataDraft.openingMessage,
        openingQuestions: JSON.stringify(metadataDraft.openingQuestions),
        systemPrompt: metadataDraft.systemPrompt,
      });
      setAgent(updated);
      setSystemPrompt(updated.systemPrompt || '');
      setMetadataDraft(null);
      setMetadataIntent('');
      await loadAgents();
      antMessage.success(t('agent.metadata.applied'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('agent.profile.failedToSave');
      antMessage.error(message);
    } finally {
      setMetadataApplying(false);
    }
  }, [agent, metadataDraft, loadAgents, t]);

  const handleSaveKnowledgeResources = useCallback(async (resources: AgentKnowledgeResource[]) => {
    if (!agent) return;
    const updated = await api.updateAgent(agent.id, {
      knowledgeResources: JSON.stringify(resources),
    });
    setAgent(updated);
    await loadAgents();
  }, [agent, loadAgents]);

  const handleAddKnowledgeResource = useCallback(async () => {
    if (!agent) return;
    const source = knowledgeSource.trim();
    if (!source) {
      antMessage.warning(t('agent.profile.knowledge.sourceRequired'));
      return;
    }
    const now = new Date().toISOString();
    const resources = parseAgentKnowledgeResources(agent);
    const next: AgentKnowledgeResource = {
      id: createKnowledgeResourceId(),
      type: knowledgeType,
      title: knowledgeTitle.trim() || source,
      source,
      policy: knowledgePolicy,
      status: 'bound',
      lastIndexedAt: '',
      createdAt: now,
      updatedAt: now,
    };
    try {
      await handleSaveKnowledgeResources([...resources, next]);
      setKnowledgeTitle('');
      setKnowledgeSource('');
      antMessage.success(t('agent.profile.knowledge.added'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('agent.profile.failedToSave');
      antMessage.error(message);
    }
  }, [agent, handleSaveKnowledgeResources, knowledgePolicy, knowledgeSource, knowledgeTitle, knowledgeType, t]);

  const handleRemoveKnowledgeResource = useCallback(async (resourceId: string) => {
    if (!agent) return;
    const resources = parseAgentKnowledgeResources(agent).filter((resource) => resource.id !== resourceId);
    try {
      await handleSaveKnowledgeResources(resources);
      antMessage.success(t('agent.profile.knowledge.removed'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('agent.profile.failedToSave');
      antMessage.error(message);
    }
  }, [agent, handleSaveKnowledgeResources, t]);

  const handleExportAgentPackage = useCallback(async (includeLocalPaths: boolean) => {
    if (!agent) return;
    setExportingAgentPackage(true);
    try {
      const pkg = await api.exportAgentPackage(agent.id, { includeLocalPaths });
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${agent.name || agent.id}.agent.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      antMessage.success(t('agent.profile.sharing.exported'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('agent.profile.sharing.exportFailed');
      antMessage.error(message);
    } finally {
      setExportingAgentPackage(false);
    }
  }, [agent, t]);

  const handleExportTurnDiagnostics = useCallback(() => {
    if (!agent) return;
    const chatState = useChatStore.getState();
    const diagnostic = buildAgentTurnDiagnosticsExport({
      sessionKey: chatState.currentSessionKey,
      messages: chatState.messages,
      agent,
      selectedModel: agent.model,
    });
    const blob = new Blob([JSON.stringify(diagnostic, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${agent.name || agent.id}.turn-diagnostics.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    antMessage.success(t('agent.profile.diagnostics.exported'));
  }, [agent, t]);

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
  const params = parseAgentParams(agent);
  const workspaceRoot = chatConfig.workspace?.root?.trim();
  const mcpServers = chatConfig.mcpServers || [];
  const boundTools = chatConfig.tools || [];
  const boundSkills = chatConfig.skills || [];
  const knowledgeResources = parseAgentKnowledgeResources(agent);
  const openingQuestions = parseStringList(agent.openingQuestions);
  const agentTags = parseStringList(agent.tags);
  const selectedModel = availableModels.find((model) => model.id === agent.model);
  const modelContextWindow = formatContextWindow(selectedModel?.context_window);
  const promptVariables = extractPromptVariables(systemPrompt);
  const invalidPromptVariables = promptVariables.filter((item) => !PROMPT_VARIABLES.includes(item));
  const promptPreview = buildPromptPreview(systemPrompt, {
    agent: agent.title || agent.name,
    user: t('agent.profile.promptPreview.user'),
    date: new Date().toISOString().slice(0, 10),
    workspace: workspaceRoot || t('agent.profile.workspaceNotSet'),
    model: agent.model || t('agent.profile.defaultModel'),
  });
  const hasLocalToolBindings = boundTools.length > 0 || mcpServers.length > 0 || boundSkills.length > 0;
  const runtimeCapabilities: Array<{ key: string; label: string; state: RuntimeCapabilityState; detail: string }> = [
    {
      key: 'chat',
      label: t('agent.profile.degradation.chat'),
      state: selectedModel?.enabled === false || !selectedModel ? 'unavailable' : (selectedModel.type || 'chat') === 'chat' ? 'native' : 'partial',
      detail: selectedModel
        ? t('agent.profile.degradation.chatDetail', { type: selectedModel.type || 'chat' })
        : t('agent.profile.degradation.modelMissing'),
    },
    {
      key: 'tools',
      label: t('agent.profile.degradation.tools'),
      state: selectedModel?.function_call ? 'native' : hasLocalToolBindings ? 'partial' : 'unavailable',
      detail: selectedModel?.function_call
        ? t('agent.profile.degradation.toolsNative')
        : hasLocalToolBindings
          ? t('agent.profile.degradation.toolsPartial')
          : t('agent.profile.degradation.toolsUnavailable'),
    },
    {
      key: 'vision',
      label: t('agent.profile.degradation.vision'),
      state: selectedModel?.vision ? 'native' : 'unavailable',
      detail: selectedModel?.vision ? t('agent.profile.degradation.visionNative') : t('agent.profile.degradation.visionUnavailable'),
    },
    {
      key: 'search',
      label: t('agent.profile.degradation.search'),
      state: selectedModel?.search ? 'native' : chatConfig.searchMode && chatConfig.searchMode !== 'off' ? 'partial' : 'unavailable',
      detail: selectedModel?.search
        ? t('agent.profile.degradation.searchNative')
        : chatConfig.searchMode && chatConfig.searchMode !== 'off'
          ? t('agent.profile.degradation.searchPartial')
          : t('agent.profile.degradation.searchUnavailable'),
    },
    {
      key: 'voice',
      label: t('agent.profile.degradation.voice'),
      state: chatConfig.voice?.ttsProvider || chatConfig.voice?.sttProvider ? 'partial' : 'unavailable',
      detail: chatConfig.voice?.ttsProvider || chatConfig.voice?.sttProvider
        ? t('agent.profile.degradation.voicePartial')
        : t('agent.profile.degradation.voiceUnavailable'),
    },
  ];
  const modelLabel = selectedModel?.display_name || agent.model || t('agent.profile.defaultModel');
  const workbenchSignals: WorkbenchSignal[] = [
    {
      key: 'model',
      icon: <Cpu size={16} />,
      label: t('agent.profile.workbench.signal.model'),
      value: modelLabel,
      ready: Boolean(agent.model || selectedModel),
      targetTab: 'model',
    },
    {
      key: 'tools',
      icon: <Wrench size={16} />,
      label: t('agent.profile.workbench.signal.tools'),
      value: t('agent.profile.workbench.countSummary', {
        count: boundTools.length + mcpServers.length + boundSkills.length,
      }),
      ready: boundTools.length + mcpServers.length + boundSkills.length > 0 || agent.toolsProfile !== 'minimal',
      targetTab: 'tools',
    },
    {
      key: 'knowledge',
      icon: <Database size={16} />,
      label: t('agent.profile.workbench.signal.knowledge'),
      value: t('agent.profile.knowledge.count', { count: knowledgeResources.length }),
      ready: knowledgeResources.length > 0 || Boolean(workspaceRoot),
      targetTab: 'knowledge',
    },
    {
      key: 'diagnostics',
      icon: <Activity size={16} />,
      label: t('agent.profile.workbench.signal.diagnostics'),
      value: t('agent.profile.workbench.diagnosticsValue'),
      ready: true,
      targetTab: 'diagnostics',
    },
  ];
  const workbenchSteps: WorkbenchStep[] = [
    {
      key: 'identity',
      label: t('agent.profile.workbench.step.identity'),
      description: t('agent.profile.workbench.step.identityDesc'),
      complete: Boolean(agent.title && agent.description && systemPrompt.trim()),
      targetTab: 'overview',
    },
    {
      key: 'runtime',
      label: t('agent.profile.workbench.step.runtime'),
      description: t('agent.profile.workbench.step.runtimeDesc'),
      complete: Boolean(agent.model || selectedModel),
      targetTab: 'model',
    },
    {
      key: 'context',
      label: t('agent.profile.workbench.step.context'),
      description: t('agent.profile.workbench.step.contextDesc'),
      complete: Boolean(workspaceRoot || knowledgeResources.length > 0 || chatConfig.memory?.enabled),
      targetTab: 'knowledge',
    },
    {
      key: 'launch',
      label: t('agent.profile.workbench.step.launch'),
      description: t('agent.profile.workbench.step.launchDesc'),
      complete: openingQuestions.length > 0 || Boolean(agent.openingMessage),
      targetTab: 'collaboration',
    },
  ];
  const completedWorkbenchSteps = workbenchSteps.filter((step) => step.complete).length;
  const workbenchProgress = Math.round(
    (completedWorkbenchSteps / Math.max(workbenchSteps.length, 1)) * 100,
  );
  const activeTabLabel = t(
    TAB_KEYS.find((tab) => tab.key === activeTab)?.labelKey || 'agent.profile.tab.overview',
  );
  const firstIncompleteStep = workbenchSteps.find((step) => !step.complete);
  const builderContextSummary = [
    {
      label: t('agent.builder.context.model'),
      value: modelLabel,
      ready: Boolean(agent.model || selectedModel),
      targetTab: 'model' as ProfileTab,
    },
    {
      label: t('agent.builder.context.checklist'),
      value: t('agent.profile.workbench.progress', {
        done: completedWorkbenchSteps,
        total: workbenchSteps.length,
        progress: workbenchProgress,
      }),
      ready: completedWorkbenchSteps === workbenchSteps.length,
      targetTab: (firstIncompleteStep?.targetTab || 'overview') as ProfileTab,
    },
    {
      label: t('agent.builder.context.capabilities'),
      value: t('agent.profile.bindingSummary', {
        tools: boundTools.length,
        skills: boundSkills.length,
        mcp: mcpServers.length,
        knowledge: knowledgeResources.length,
      }),
      ready: hasLocalToolBindings,
      targetTab: 'tools' as ProfileTab,
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
      tags: agentTags,
      is_default: agent.isDefault,
      system_prompt_configured: Boolean(systemPrompt.trim()),
      opening_message_configured: Boolean(agent.openingMessage),
      opening_questions_count: openingQuestions.length,
    },
    workbench: {
      active_tab: activeTab,
      active_tab_label: activeTabLabel,
      progress: {
        completed: completedWorkbenchSteps,
        total: workbenchSteps.length,
        percent: workbenchProgress,
      },
      signals: workbenchSignals.map(({ key, label, value, ready, targetTab }) => ({
        key,
        label,
        value,
        ready,
        target_tab: targetTab,
      })),
      checklist: workbenchSteps.map(({ key, label, description, complete, targetTab }) => ({
        key,
        label,
        description,
        complete,
        target_tab: targetTab,
      })),
    },
    runtime: {
      model_id: agent.model || '',
      model_label: modelLabel,
      model_type: selectedModel?.type || '',
      context_window: selectedModel?.context_window || null,
      params,
      capabilities: runtimeCapabilities.map(({ key, label, state, detail }) => ({
        key,
        label,
        state,
        detail,
      })),
    },
    context: {
      workspace_root_configured: Boolean(workspaceRoot),
      workspace_root: workspaceRoot || '',
      memory_enabled: Boolean(chatConfig.memory?.enabled),
      search_mode: chatConfig.searchMode || '',
    },
    bindings: {
      tools_profile: agent.toolsProfile || '',
      tools: boundTools,
      mcp_servers: mcpServers,
      skills: boundSkills,
      knowledge_resources: knowledgeResources.map((resource) => ({
        id: resource.id,
        type: resource.type,
        title: resource.title,
        policy: resource.policy,
        status: resource.status,
      })),
    },
  };

  return (
    <Flexbox horizontal style={{ height: '100%', width: '100%', overflow: 'hidden' }}>
      {/* ── Left: Profile Editor ── */}
      <Flexbox flex={1} style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
            padding: '0 40px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              minHeight: 0,
              maxWidth: 1040,
              margin: '0 auto',
              width: '100%',
            }}
          >
            {/* ── Workbench Hero ── */}
            <div style={{ flexShrink: 0, paddingTop: 24, overflow: 'auto', maxHeight: '58%' }}>
              <AgentWorkbenchHero
                agent={agent}
                modelLabel={modelLabel}
                workspaceRoot={workspaceRoot}
                signals={workbenchSignals}
                steps={workbenchSteps}
                activeTab={activeTab}
                onSelectTab={setActiveTab}
                onStartChat={() => onStartChat(agent.name)}
                onOpenSettings={() => setSettingsOpen(true)}
                onAvatarChange={handleAvatarChange}
              />

              <Flexbox
                horizontal
                align="center"
                gap={8}
                style={{
                  marginTop: 12,
                  marginBottom: 12,
                  padding: '8px 10px',
                  borderRadius: 12,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorFillQuaternary,
                }}
              >
                <FolderOpen size={14} style={{ color: token.colorTextSecondary }} />
                <span style={{ fontSize: 12, color: token.colorTextSecondary }}>
                  {t('agent.profile.workspace')}
                </span>
                {workspaceRoot ? (
                  <>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 12,
                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                        color: token.colorText,
                      }}
                      title={workspaceRoot}
                    >
                      {workspaceRoot}
                    </span>
                    <Tag color="green">{t('agent.profile.workspacePolicy.workspaceOnly')}</Tag>
                  </>
                ) : (
                  <span style={{ flex: 1, fontSize: 12, color: token.colorTextDescription }}>
                    {t('agent.profile.workspaceNotSet')}
                  </span>
                )}
              </Flexbox>

              <div style={{ marginBottom: 12 }}>
                <SkillAppletTagBar
                  onNavigateSkills={onNavigateSkills}
                  onNavigateApplets={onNavigateApplets}
                />
              </div>
            </div>

            <Divider style={{ margin: '8px 0 0' }} />

            {/* ── Tab bar (no font-weight change to prevent wobble) ── */}
            <div style={{ display: 'flex', gap: 0, flexShrink: 0 }}>
              {TAB_KEYS.map((tab) => (
                <div
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '10px 16px',
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: 500,
                    color:
                      activeTab === tab.key ? token.colorText : token.colorTextSecondary,
                    borderBottom: `2px solid ${
                      activeTab === tab.key ? token.colorPrimary : 'transparent'
                    }`,
                    transition: 'color 0.2s, border-color 0.2s',
                  }}
                >
                  {tab.icon}
                  {t(tab.labelKey)}
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
                paddingTop: 8,
                paddingBottom: 16,
                overflow: 'hidden',
              }}
            >
              {activeTab === 'overview' && (
                <Flexbox gap={12} style={{ overflow: 'auto' }}>
                  <ProfileCard
                    title={t('agent.metadata.title')}
                    description={t('agent.metadata.description')}
                    action={
                      <Button
                        size="small"
                        icon={<Sparkles size={14} />}
                        loading={metadataGenerating}
                        onClick={handleGenerateMetadata}
                      >
                        {t('agent.metadata.generate')}
                      </Button>
                    }
                  >
                    <Flexbox gap={8}>
                      <textarea
                        value={metadataIntent}
                        onChange={(event) => setMetadataIntent(event.target.value)}
                        placeholder={t('agent.metadata.intentPlaceholder')}
                        rows={3}
                        style={{
                          width: '100%',
                          resize: 'vertical',
                          minHeight: 72,
                          padding: '10px 12px',
                          borderRadius: 8,
                          border: `1px solid ${token.colorBorderSecondary}`,
                          background: token.colorBgContainer,
                          color: token.colorText,
                          outline: 'none',
                          fontFamily: 'inherit',
                          fontSize: 13,
                          lineHeight: 1.6,
                        }}
                      />
                      <span style={{ fontSize: 12, color: token.colorTextDescription }}>
                        {t('agent.metadata.previewRule')}
                      </span>
                      {metadataError && (
                        <span style={{ fontSize: 12, color: token.colorError }}>
                          {t('agent.metadata.failed', { error: metadataError })}
                        </span>
                      )}
                      {metadataDraft && (
                        <Flexbox gap={8}>
                          <InfoRow label={t('agent.metadata.previewTitle')} value={metadataDraft.title} />
                          <InfoRow label={t('agent.metadata.previewDescription')} value={metadataDraft.description} />
                          <InfoRow label={t('agent.metadata.previewTags')} value={<PillList values={metadataDraft.tags} emptyText={t('agent.profile.empty')} />} />
                          <InfoRow label={t('agent.metadata.previewOpeningMessage')} value={metadataDraft.openingMessage} />
                          <InfoRow label={t('agent.metadata.previewOpeningQuestions')} value={<PillList values={metadataDraft.openingQuestions} emptyText={t('agent.profile.empty')} />} />
                          <Flexbox gap={4}>
                            <span style={{ fontSize: 12, color: token.colorTextSecondary }}>
                              {t('agent.metadata.previewPrompt')}
                            </span>
                            <pre
                              style={{
                                margin: 0,
                                maxHeight: 160,
                                overflow: 'auto',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                padding: 10,
                                borderRadius: 8,
                                border: `1px solid ${token.colorBorderSecondary}`,
                                background: token.colorFillQuaternary,
                                fontSize: 12,
                                lineHeight: 1.6,
                                color: token.colorTextSecondary,
                              }}
                            >
                              {metadataDraft.systemPrompt}
                            </pre>
                          </Flexbox>
                          <Flexbox horizontal justify="flex-end" gap={8}>
                            <Button size="small" onClick={() => setMetadataDraft(null)}>
                              {t('agent.metadata.discard')}
                            </Button>
                            <Button
                              size="small"
                              type="primary"
                              loading={metadataApplying}
                              onClick={handleApplyMetadataDraft}
                            >
                              {t('agent.metadata.apply')}
                            </Button>
                          </Flexbox>
                        </Flexbox>
                      )}
                    </Flexbox>
                  </ProfileCard>
                  <ProfileCard
                    title={t('agent.profile.section.identity')}
                    description={t('agent.profile.section.identityDesc')}
                    action={<Button size="small" onClick={() => setSettingsOpen(true)}>{t('agent.profile.editSettings')}</Button>}
                  >
                    <InfoRow label={t('agent.profile.field.name')} value={agent.name} />
                    <InfoRow label={t('agent.profile.field.tags')} value={<PillList values={agentTags} emptyText={t('agent.profile.empty')} />} />
                    <InfoRow label={t('agent.profile.field.pinned')} value={agent.pinned ? t('agent.profile.enabled') : t('agent.profile.disabled')} />
                    <InfoRow label={t('agent.profile.field.favorite')} value={agent.favorite ? t('agent.profile.enabled') : t('agent.profile.disabled')} />
                  </ProfileCard>
                  <ProfileCard title={t('agent.profile.section.routing')} description={t('agent.profile.section.routingDesc')}>
                    <InfoRow label={t('agent.profile.field.provider')} value={agent.provider || selectedModel?.provider_id || t('agent.profile.defaultValue')} />
                    <InfoRow label={t('agent.profile.field.model')} value={agent.model || t('agent.profile.defaultValue')} />
                    <InfoRow label={t('agent.profile.field.workspace')} value={workspaceRoot || t('agent.profile.workspaceNotSet')} />
                  </ProfileCard>
                </Flexbox>
              )}

              {activeTab === 'prompt' && (
                <Flexbox flex={1} gap={6} style={{ minHeight: 0 }}>
                  <textarea
                    value={systemPrompt}
                    onChange={handlePromptChange}
                    onBlur={handlePromptBlur}
                    placeholder={t('agent.profile.promptPlaceholder')}
                    style={{
                      flex: 1,
                      width: '100%',
                      minHeight: 200,
                      padding: '12px 16px',
                      borderRadius: 8,
                      border: `1px solid ${token.colorBorderSecondary}`,
                      background: token.colorBgContainer,
                      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                      fontSize: 13,
                      lineHeight: 1.7,
                      resize: 'none',
                      outline: 'none',
                      color: token.colorText,
                    }}
                    onFocus={(e) => {
                      (e.target as HTMLElement).style.borderColor = token.colorPrimary;
                    }}
                    onBlurCapture={(e) => {
                      (e.target as HTMLElement).style.borderColor =
                        token.colorBorderSecondary;
                    }}
                  />
                  <Flexbox horizontal align="center" justify="space-between" gap={12} style={{ flexShrink: 0 }}>
                    <span style={{ fontSize: 12, color: token.colorTextDescription }}>
                      {t('agent.profile.promptHelp')}
                    </span>
                    <Tag color={invalidPromptVariables.length > 0 ? 'red' : 'blue'}>
                      {t('agent.profile.promptTokenEstimate', { count: estimatePromptTokens(systemPrompt) })}
                    </Tag>
                  </Flexbox>
                  <Flexbox horizontal gap={8} style={{ flexShrink: 0, flexWrap: 'wrap' }}>
                    <Tag color={invalidPromptVariables.length > 0 ? 'red' : 'green'}>
                      {invalidPromptVariables.length > 0
                        ? t('agent.profile.promptInvalidVariablesInline', { variables: invalidPromptVariables.join(', ') })
                        : t('agent.profile.promptVariablesValid')}
                    </Tag>
                    {PROMPT_VARIABLES.map((variable) => (
                      <Tag key={variable}>{`{{${variable}}}`}</Tag>
                    ))}
                  </Flexbox>
                  <ProfileCard title={t('agent.profile.promptPreview')} description={t('agent.profile.promptPreviewDesc')}>
                    <pre
                      style={{
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        maxHeight: 140,
                        overflow: 'auto',
                        fontSize: 12,
                        lineHeight: 1.6,
                        color: token.colorTextSecondary,
                      }}
                    >
                      {promptPreview || t('agent.profile.empty')}
                    </pre>
                  </ProfileCard>
                </Flexbox>
              )}

              {activeTab === 'model' && (
                <Flexbox gap={12} style={{ overflow: 'auto' }}>
                  <ProfileCard title={t('agent.profile.section.model')} description={t('agent.profile.section.modelDesc')}>
                    <ModelSelect
                      models={availableModels}
                      value={agent.model || undefined}
                      onChange={handleModelChange}
                      placeholder={t('agent.profile.defaultModel')}
                      size="middle"
                      style={{ minWidth: 260 }}
                    />
                    <InfoRow label={t('agent.profile.field.temperature')} value={params.temperature ?? t('agent.profile.defaultValue')} />
                    <InfoRow label={t('agent.profile.field.topP')} value={params.top_p ?? t('agent.profile.defaultValue')} />
                    <InfoRow label={t('agent.profile.field.maxTokens')} value={params.max_tokens ?? t('agent.profile.defaultValue')} />
                  </ProfileCard>
                  <ProfileCard title={t('agent.profile.section.modelCapabilities')} description={t('agent.profile.section.modelCapabilitiesDesc')}>
                    <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
                      <CapabilityBadge
                        icon={<Wrench size={13} />}
                        label={t('agent.profile.capability.tools')}
                        enabled={!!selectedModel?.function_call}
                      />
                      <CapabilityBadge
                        icon={<Eye size={13} />}
                        label={t('agent.profile.capability.vision')}
                        enabled={!!selectedModel?.vision}
                      />
                      <CapabilityBadge
                        icon={<Sparkles size={13} />}
                        label={t('agent.profile.capability.reasoning')}
                        enabled={!!selectedModel?.reasoning}
                      />
                      <CapabilityBadge
                        icon={<Zap size={13} />}
                        label={t('agent.profile.capability.streaming')}
                        enabled={selectedModel?.enabled !== false && (selectedModel?.type || 'chat') === 'chat'}
                      />
                      <CapabilityBadge
                        icon={<Activity size={13} />}
                        label={t('agent.profile.capability.context', { size: modelContextWindow || t('agent.profile.unknown') })}
                        enabled={!!modelContextWindow}
                      />
                    </Flexbox>
                    <InfoRow label={t('agent.profile.field.provider')} value={selectedModel?.provider_name || selectedModel?.provider_id || agent.provider || t('agent.profile.defaultValue')} />
                    <InfoRow label={t('agent.profile.field.modelType')} value={selectedModel?.type || t('agent.profile.defaultValue')} />
                  </ProfileCard>
                  <ProfileCard title={t('agent.profile.section.runtimeCompatibility')} description={t('agent.profile.section.runtimeCompatibilityDesc')}>
                    <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
                      {runtimeCapabilities.map((capability) => (
                        <RuntimeCapabilityBadge
                          key={capability.key}
                          label={capability.label}
                          state={capability.state}
                          detail={capability.detail}
                        />
                      ))}
                    </Flexbox>
                    <InfoRow
                      label={t('agent.profile.field.protocol')}
                      value={selectedModel?.protocol_override || selectedModel?.provider_id || t('agent.profile.defaultValue')}
                    />
                  </ProfileCard>
                </Flexbox>
              )}

              {activeTab === 'runtime' && (
                <Flexbox gap={12} style={{ overflow: 'auto' }}>
                  <ProfileCard title={t('agent.profile.section.runtime')} description={t('agent.profile.section.runtimeDesc')}>
                    <InfoRow label={t('agent.profile.field.streaming')} value={chatConfig.enableStreaming === false ? t('agent.profile.disabled') : t('agent.profile.enabled')} />
                    <InfoRow label={t('agent.profile.field.historyCount')} value={chatConfig.enableHistoryCount ? chatConfig.historyCount ?? t('agent.profile.defaultValue') : t('agent.profile.disabled')} />
                    <InfoRow label={t('agent.profile.field.contextCompression')} value={chatConfig.enableContextCompression ? t('agent.profile.enabled') : t('agent.profile.disabled')} />
                    <InfoRow label={t('agent.profile.field.contextWindow')} value={chatConfig.contextWindowSize ? t('agent.profile.tokens', { count: chatConfig.contextWindowSize }) : t('agent.profile.defaultValue')} />
                    <InfoRow label={t('agent.profile.field.searchMode')} value={chatConfig.searchMode || t('agent.profile.disabled')} />
                    <InfoRow label={t('agent.profile.field.memoryPolicy')} value={chatConfig.memory?.enabled ? t('agent.profile.memorySummary', { effort: chatConfig.memory.effort || t('agent.profile.defaultValue') }) : t('agent.profile.disabled')} />
                    <InfoRow label={t('agent.profile.field.providerFallback')} value={chatConfig.providerFallback?.enabled === false ? t('agent.profile.disabled') : t('agent.profile.providerFallbackSummary', { retries: chatConfig.providerFallback?.maxRetries ?? 3 })} />
                    <InfoRow label={t('agent.profile.field.toolPolicy')} value={agent.toolsProfile || t('agent.profile.defaultValue')} />
                  </ProfileCard>
                  <ProfileCard title={t('agent.profile.section.workspace')} description={t('agent.profile.section.workspaceDesc')}>
                    <InfoRow label={t('agent.profile.field.workspaceRoot')} value={workspaceRoot || t('agent.profile.workspaceNotSet')} />
                    <InfoRow label={t('agent.profile.field.workspacePolicy')} value={workspaceRoot ? t('agent.profile.workspacePolicy.workspaceOnly') : t('agent.profile.disabled')} />
                  </ProfileCard>
                </Flexbox>
              )}

              {activeTab === 'tools' && (
                <Flexbox gap={12} style={{ overflow: 'auto' }}>
                  <ProfileCard title={t('agent.profile.section.tools')} description={t('agent.profile.section.toolsDesc')} action={<Button size="small" onClick={() => setSettingsOpen(true)}>{t('agent.profile.editSettings')}</Button>}>
                    <InfoRow label={t('agent.profile.field.toolsProfile')} value={agent.toolsProfile || t('agent.profile.defaultValue')} />
                    <InfoRow label={t('agent.profile.field.allowedTools')} value={<PillList values={boundTools} emptyText={t('agent.profile.empty')} />} />
                    <InfoRow label={t('agent.profile.field.toolsAllow')} value={agent.toolsAllow || t('agent.profile.empty')} />
                    <InfoRow label={t('agent.profile.field.toolsDeny')} value={agent.toolsDeny || t('agent.profile.empty')} />
                  </ProfileCard>
                </Flexbox>
              )}

              {activeTab === 'mcp' && (
                <Flexbox gap={12} style={{ overflow: 'auto' }}>
                  <ProfileCard title={t('agent.profile.section.mcp')} description={t('agent.profile.section.mcpDesc')}>
                    <PillList values={mcpServers} emptyText={t('agent.profile.mcpEmpty')} />
                  </ProfileCard>
                </Flexbox>
              )}

              {activeTab === 'skills' && (
                <Flexbox gap={12} style={{ overflow: 'auto' }}>
                  <ProfileCard title={t('agent.profile.section.skills')} description={t('agent.profile.section.skillsDesc')}>
                    <SkillAppletTagBar onNavigateSkills={onNavigateSkills} onNavigateApplets={onNavigateApplets} />
                    <InfoRow label={t('agent.profile.field.boundSkills')} value={<PillList values={boundSkills} emptyText={t('agent.profile.empty')} />} />
                  </ProfileCard>
                </Flexbox>
              )}

              {activeTab === 'memory' && <MemoryTab agentName={agent.name} agentId={agent.id} />}

              {activeTab === 'knowledge' && (
                <Flexbox gap={12} style={{ overflow: 'auto' }}>
                  <ProfileCard title={t('agent.profile.section.knowledge')} description={t('agent.profile.section.knowledgeDesc')}>
                    <InfoRow label={t('agent.profile.field.workspaceRoot')} value={workspaceRoot || t('agent.profile.workspaceNotSet')} />
                    <InfoRow label={t('agent.profile.field.memoryEnabled')} value={chatConfig.memory?.enabled ? t('agent.profile.enabled') : t('agent.profile.disabled')} />
                    <InfoRow label={t('agent.profile.field.knowledgeResources')} value={t('agent.profile.knowledge.count', { count: knowledgeResources.length })} />
                  </ProfileCard>
                  <ProfileCard title={t('agent.profile.knowledge.bindTitle')} description={t('agent.profile.knowledge.bindDesc')}>
                    <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
                      <Select<AgentKnowledgeResourceType>
                        value={knowledgeType}
                        onChange={setKnowledgeType}
                        style={{ minWidth: 140 }}
                        options={KNOWLEDGE_RESOURCE_TYPES.map((type) => ({
                          value: type,
                          label: t(`agent.profile.knowledge.type.${type}`),
                        }))}
                      />
                      <Select<AgentKnowledgeResourcePolicy>
                        value={knowledgePolicy}
                        onChange={setKnowledgePolicy}
                        style={{ minWidth: 140 }}
                        options={KNOWLEDGE_RESOURCE_POLICIES.map((policy) => ({
                          value: policy,
                          label: t(`agent.profile.knowledge.policy.${policy}`),
                        }))}
                      />
                    </Flexbox>
                    <Input
                      value={knowledgeTitle}
                      onChange={(event) => setKnowledgeTitle(event.target.value)}
                      placeholder={t('agent.profile.knowledge.titlePlaceholder')}
                    />
                    <Input
                      value={knowledgeSource}
                      onChange={(event) => setKnowledgeSource(event.target.value)}
                      placeholder={t('agent.profile.knowledge.sourcePlaceholder')}
                      onPressEnter={handleAddKnowledgeResource}
                    />
                    <Flexbox horizontal justify="flex-end">
                      <Button icon={<Plus size={13} />} onClick={handleAddKnowledgeResource}>
                        {t('agent.profile.knowledge.add')}
                      </Button>
                    </Flexbox>
                  </ProfileCard>
                  <ProfileCard title={t('agent.profile.knowledge.boundTitle')} description={t('agent.profile.knowledge.boundDesc')}>
                    <KnowledgeResourceList resources={knowledgeResources} onRemove={handleRemoveKnowledgeResource} />
                  </ProfileCard>
                </Flexbox>
              )}

              {activeTab === 'collaboration' && (
                <Flexbox gap={12} style={{ overflow: 'auto' }}>
                  <ProfileCard title={t('agent.profile.sharing.title')} description={t('agent.profile.sharing.desc')}>
                    <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
                      <Button
                        icon={<ShieldCheck size={13} />}
                        loading={exportingAgentPackage}
                        onClick={() => handleExportAgentPackage(false)}
                      >
                        {t('agent.profile.sharing.exportShareSafe')}
                      </Button>
                      <Button
                        icon={<Download size={13} />}
                        loading={exportingAgentPackage}
                        onClick={() => handleExportAgentPackage(true)}
                      >
                        {t('agent.profile.sharing.exportWithLocalPaths')}
                      </Button>
                    </Flexbox>
                    <InfoRow label={t('agent.profile.sharing.policy')} value={t('agent.profile.sharing.policyDesc')} />
                  </ProfileCard>
                  <ProfileCard title={t('agent.profile.section.opening')} description={t('agent.profile.section.openingDesc')}>
                    <InfoRow label={t('agent.profile.field.openingMessage')} value={agent.openingMessage || t('agent.profile.empty')} />
                    <InfoRow label={t('agent.profile.field.openingQuestions')} value={<PillList values={openingQuestions} emptyText={t('agent.profile.empty')} />} />
                  </ProfileCard>
                  <CronTab agentName={agent.name} onNavigateCron={onNavigateCron} />
                </Flexbox>
              )}

              {activeTab === 'diagnostics' && (
                <Flexbox gap={12} style={{ overflow: 'auto' }}>
                  <ProfileCard title={t('agent.profile.section.diagnostics')} description={t('agent.profile.section.diagnosticsDesc')}>
                    <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
                      <Button
                        icon={<Download size={13} />}
                        onClick={handleExportTurnDiagnostics}
                      >
                        {t('agent.profile.diagnostics.exportTurnTrace')}
                      </Button>
                    </Flexbox>
                    <InfoRow label={t('agent.profile.field.agentId')} value={agent.id} />
                    <InfoRow label={t('agent.profile.field.createdAt')} value={agent.createdAt || t('agent.profile.empty')} />
                    <InfoRow label={t('agent.profile.field.updatedAt')} value={agent.updatedAt || t('agent.profile.empty')} />
                    <InfoRow label={t('agent.profile.field.bindings')} value={t('agent.profile.bindingSummary', { tools: boundTools.length, skills: boundSkills.length, mcp: mcpServers.length, knowledge: knowledgeResources.length })} />
                  </ProfileCard>
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
        welcomeAvatar="🏗️"
        suggestQuestions={[
          t('agent.builder.suggest.customerSupport'),
          t('agent.builder.suggest.codeReview'),
          t('agent.builder.suggest.researchAnalyst'),
        ]}
        contextSummary={builderContextSummary}
        onContextItemClick={(targetTab) => setActiveTab(targetTab as ProfileTab)}
        contextPayload={builderContextPayload}
        expand={showBuilder}
        onExpandChange={setShowBuilder}
        defaultWidth={400}
        minWidth={320}
        maxWidth={560}
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
