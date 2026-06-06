import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { EmojiPicker } from '@lobehub/ui';
import {
  theme,
  Divider,
  Empty,
  message as antMessage,
} from 'antd';
import { Tag, Button } from '@lobehub/ui';
import {
  Settings2,
  Play,
  Clock,
  Brain,
  Zap,
  Plus,
  Bot,
  Cpu,
  FileText,
  Link2,
  Network,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { useChatStore } from '../store/chat';
import {
  api,
  type Agent,
  type AvailableModel,
  type MCPServerItem,
  type SkillListItem,
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

function parseLines(value?: string): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // Fall through to comma/newline parsing.
  }
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function SectionPanel({
  title,
  icon,
  children,
  action,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  const { token } = theme.useToken();
  return (
    <Flexbox
      gap={10}
      style={{
        padding: 14,
        borderRadius: 8,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
      }}
    >
      <Flexbox horizontal align="center" justify="space-between" gap={8}>
        <Flexbox horizontal align="center" gap={8}>
          {icon}
          <span style={{ fontSize: 14, fontWeight: 600, color: token.colorText }}>{title}</span>
        </Flexbox>
        {action}
      </Flexbox>
      {children}
    </Flexbox>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <Flexbox horizontal align="center" justify="space-between" gap={12}>
      <span style={{ fontSize: 12, color: token.colorTextSecondary, flexShrink: 0 }}>{label}</span>
      <span
        style={{
          fontSize: 13,
          color: token.colorText,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
    </Flexbox>
  );
}

function EmptyValue({ children }: { children: ReactNode }) {
  const { token } = theme.useToken();
  return <span style={{ color: token.colorTextQuaternary }}>{children}</span>;
}

function OverviewTab({ agent, onStartChat, onOpenSettings }: { agent: Agent; onStartChat: (name: string) => void; onOpenSettings: () => void }) {
  const { t } = useTranslation('agent');
  const tags = parseLines(agent.tags);
  const openingQuestions = parseLines(agent.openingQuestions);
  const chatConfig = parseAgentChatConfig(agent);
  const params = parseAgentParams(agent);

  return (
    <Flexbox gap={12} style={{ overflow: 'auto' }}>
      <SectionPanel
        title={t('agent.profile.overview.identity')}
        icon={<Bot size={15} />}
        action={
          <Button size="small" icon={<Settings2 size={14} />} onClick={onOpenSettings}>
            {t('agent.profile.edit')}
          </Button>
        }
      >
        <InfoRow label={t('agent.profile.overview.slug')} value={agent.name} />
        <InfoRow label={t('agent.profile.overview.description')} value={agent.description || <EmptyValue>{t('agent.profile.empty')}</EmptyValue>} />
        <InfoRow label={t('agent.profile.overview.tags')} value={tags.length ? tags.map((tag) => <Tag key={tag}>{tag}</Tag>) : <EmptyValue>{t('agent.profile.empty')}</EmptyValue>} />
      </SectionPanel>

      <SectionPanel title={t('agent.profile.overview.opening')} icon={<FileText size={15} />}>
        <InfoRow label={t('agent.profile.overview.openingMessage')} value={agent.openingMessage || <EmptyValue>{t('agent.profile.empty')}</EmptyValue>} />
        <InfoRow
          label={t('agent.profile.overview.openingQuestions')}
          value={
            openingQuestions.length
              ? openingQuestions.slice(0, 3).join(' / ')
              : <EmptyValue>{t('agent.profile.empty')}</EmptyValue>
          }
        />
      </SectionPanel>

      <SectionPanel
        title={t('agent.profile.overview.runtimeSnapshot')}
        icon={<Cpu size={15} />}
        action={
          <Button type="primary" size="small" icon={<Play size={14} />} onClick={() => onStartChat(agent.name)}>
            {t('agent.profile.startConversation')}
          </Button>
        }
      >
        <InfoRow label={t('agent.profile.runtime.model')} value={agent.model || <EmptyValue>{t('agent.profile.defaultModel')}</EmptyValue>} />
        <InfoRow label={t('agent.profile.runtime.provider')} value={agent.provider || <EmptyValue>{t('agent.profile.runtime.defaultProvider')}</EmptyValue>} />
        <InfoRow label={t('agent.profile.runtime.streaming')} value={chatConfig.enableStreaming === false ? t('agent.profile.off') : t('agent.profile.on')} />
        <InfoRow label={t('agent.profile.runtime.temperature')} value={params.temperature ?? <EmptyValue>{t('agent.profile.default')}</EmptyValue>} />
      </SectionPanel>
    </Flexbox>
  );
}

function RuntimeTab({
  agent,
  availableModels,
  onModelChange,
  onOpenSettings,
}: {
  agent: Agent;
  availableModels: AvailableModel[];
  onModelChange: (modelId: string) => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation('agent');
  const params = parseAgentParams(agent);
  const workspaceRoot = (agent as any).workspaceRoot || (agent as any).workspace_root || '';

  return (
    <Flexbox gap={12} style={{ overflow: 'auto' }}>
      <SectionPanel title={t('agent.profile.runtime.modelProvider')} icon={<Cpu size={15} />}>
        <ModelSelect
          models={availableModels}
          value={agent.model || undefined}
          onChange={onModelChange}
          placeholder={t('agent.profile.defaultModel')}
          size="middle"
          style={{ maxWidth: 360 }}
        />
        <InfoRow label={t('agent.profile.runtime.provider')} value={agent.provider || <EmptyValue>{t('agent.profile.runtime.defaultProvider')}</EmptyValue>} />
      </SectionPanel>

      <SectionPanel
        title={t('agent.profile.runtime.policy')}
        icon={<ShieldCheck size={15} />}
        action={
          <Button size="small" icon={<Settings2 size={14} />} onClick={onOpenSettings}>
            {t('agent.profile.advancedSettings')}
          </Button>
        }
      >
        <InfoRow label={t('agent.profile.runtime.toolProfile')} value={agent.toolsProfile || 'standard'} />
        <InfoRow label={t('agent.profile.runtime.temperature')} value={params.temperature ?? <EmptyValue>{t('agent.profile.default')}</EmptyValue>} />
        <InfoRow label={t('agent.profile.runtime.maxTokens')} value={params.max_tokens ?? <EmptyValue>{t('agent.profile.default')}</EmptyValue>} />
      </SectionPanel>

      <SectionPanel title={t('agent.profile.runtime.workspace')} icon={<FileText size={15} />}>
        <InfoRow label={t('agent.profile.runtime.workspaceRoot')} value={workspaceRoot || <EmptyValue>{t('agent.profile.runtime.workspaceDefault')}</EmptyValue>} />
        <InfoRow label={t('agent.profile.runtime.artifacts')} value={<EmptyValue>{t('agent.profile.runtime.artifactsDefault')}</EmptyValue>} />
      </SectionPanel>
    </Flexbox>
  );
}

function CapabilitiesTab({
  agent,
  onNavigateSkills,
  onNavigateApplets,
}: {
  agent: Agent;
  onNavigateSkills?: () => void;
  onNavigateApplets?: () => void;
}) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [mcpServers, setMcpServers] = useState<MCPServerItem[]>([]);

  useEffect(() => {
    api.listSkills().then((res) => setSkills(res.skills || [])).catch(() => setSkills([]));
    api.listMCPServers().then(setMcpServers).catch(() => setMcpServers([]));
  }, []);

  const enabledSkills = skills.filter((skill) => skill.enabled);
  const enabledMcp = mcpServers.filter((server) => server.enabled);
  const allowTools = parseLines(agent.toolsAllow);
  const denyTools = parseLines(agent.toolsDeny);

  return (
    <Flexbox gap={12} style={{ overflow: 'auto' }}>
      <SectionPanel
        title={t('agent.profile.capabilities.skills')}
        icon={<Zap size={15} />}
        action={onNavigateSkills && (
          <Button size="small" onClick={onNavigateSkills}>{t('agent.profile.open')}</Button>
        )}
      >
        <InfoRow label={t('agent.profile.capabilities.enabled')} value={enabledSkills.length} />
        <Flexbox horizontal gap={6} wrap="wrap">
          {enabledSkills.slice(0, 8).map((skill) => (
            <Tag key={skill.id}>{skill.name || skill.identifier}</Tag>
          ))}
          {enabledSkills.length === 0 && <EmptyValue>{t('agent.profile.capabilities.none')}</EmptyValue>}
        </Flexbox>
      </SectionPanel>

      <SectionPanel title={t('agent.profile.capabilities.tools')} icon={<Wrench size={15} />}>
        <InfoRow label={t('agent.profile.runtime.toolProfile')} value={agent.toolsProfile || 'standard'} />
        <Flexbox gap={6}>
          <Flexbox horizontal gap={6} wrap="wrap">
            <span style={{ fontSize: 12, color: token.colorTextSecondary }}>{t('agent.profile.capabilities.allow')}</span>
            {allowTools.length ? allowTools.map((tool) => <Tag key={tool} color="green">{tool}</Tag>) : <EmptyValue>{t('agent.profile.capabilities.inherit')}</EmptyValue>}
          </Flexbox>
          <Flexbox horizontal gap={6} wrap="wrap">
            <span style={{ fontSize: 12, color: token.colorTextSecondary }}>{t('agent.profile.capabilities.deny')}</span>
            {denyTools.length ? denyTools.map((tool) => <Tag key={tool} color="red">{tool}</Tag>) : <EmptyValue>{t('agent.profile.capabilities.none')}</EmptyValue>}
          </Flexbox>
        </Flexbox>
      </SectionPanel>

      <SectionPanel
        title={t('agent.profile.capabilities.mcp')}
        icon={<Link2 size={15} />}
        action={onNavigateApplets && (
          <Button size="small" onClick={onNavigateApplets}>{t('agent.profile.open')}</Button>
        )}
      >
        <InfoRow label={t('agent.profile.capabilities.enabled')} value={enabledMcp.length} />
        <Flexbox horizontal gap={6} wrap="wrap">
          {enabledMcp.slice(0, 8).map((server) => (
            <Tag key={server.name}>{server.title || server.name}</Tag>
          ))}
          {enabledMcp.length === 0 && <EmptyValue>{t('agent.profile.capabilities.none')}</EmptyValue>}
        </Flexbox>
      </SectionPanel>

      <SectionPanel title={t('agent.profile.capabilities.collaboration')} icon={<Network size={15} />}>
        <InfoRow label={t('agent.profile.capabilities.a2a')} value={<EmptyValue>{t('agent.profile.capabilities.policyPending')}</EmptyValue>} />
        <InfoRow label={t('agent.profile.capabilities.groups')} value={<EmptyValue>{t('agent.profile.capabilities.policyPending')}</EmptyValue>} />
      </SectionPanel>
    </Flexbox>
  );
}

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

type ProfileTab = 'overview' | 'prompt' | 'runtime' | 'capabilities' | 'memories' | 'cron';

const TAB_KEYS: { key: ProfileTab; labelKey: string; icon: ReactNode }[] = [
  { key: 'overview', labelKey: 'agent.profile.tab.overview', icon: <Bot size={13} /> },
  { key: 'prompt', labelKey: 'agent.profile.tab.prompt', icon: <FileText size={13} /> },
  { key: 'runtime', labelKey: 'agent.profile.tab.runtime', icon: <Cpu size={13} /> },
  { key: 'capabilities', labelKey: 'agent.profile.tab.capabilities', icon: <Wrench size={13} /> },
  { key: 'memories', labelKey: 'agent.profile.tab.memories', icon: <Brain size={13} /> },
  { key: 'cron', labelKey: 'agent.profile.tab.scheduledTasks', icon: <Clock size={13} /> },
];

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
  const { agents, availableModels, loadAgents, loadModels } = useChatStore();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [promptDirty, setPromptDirty] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showBuilder, setShowBuilder] = useState(true);
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');
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
      try {
        await api.updateAgent(agent.id, { systemPrompt: value });
        setPromptDirty(false);
        loadAgents();
      } catch (err: any) {
        antMessage.error(err.message || t('agent.profile.failedToSave'));
      }
    },
    [agent, loadAgents],
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
              maxWidth: 720,
              margin: '0 auto',
              width: '100%',
            }}
          >
            {/* ── Header ── */}
            <div style={{ flexShrink: 0, paddingTop: 24, overflow: 'auto', maxHeight: '50%' }}>
              <Flexbox horizontal gap={16} align="center" style={{ paddingBlock: 16 }}>
                <EmojiPicker
                  value={agent.avatar || '🤖'}
                  size={72}
                  shape="square"
                  background={
                    agent.backgroundColor || 'linear-gradient(135deg, #667eea, #764ba2)'
                  }
                  onChange={handleAvatarChange}
                />
                <Flexbox flex={1} style={{ minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: 28,
                      fontWeight: 600,
                      color: token.colorText,
                      lineHeight: 1.3,
                    }}
                  >
                    {agent.title || agent.name}
                  </span>
                  {agent.description && (
                    <span
                      style={{
                        fontSize: 14,
                        color: token.colorTextDescription,
                        marginTop: 2,
                      }}
                    >
                      {agent.description}
                    </span>
                  )}
                  {agent.isDefault && (
                    <Tag
                      color="blue"
                      style={{ alignSelf: 'flex-start', marginTop: 4, fontSize: 11 }}
                    >
                      {t('agent.profile.builtIn')}
                    </Tag>
                  )}
                </Flexbox>
              </Flexbox>

              {/* Config: Model + Advanced Settings */}
              <Flexbox
                horizontal
                align="center"
                gap={8}
                justify="flex-start"
                style={{ marginBottom: 12 }}
              >
                <ModelSelect
                  models={availableModels}
                  value={agent.model || undefined}
                  onChange={handleModelChange}
                  placeholder={t('agent.profile.defaultModel')}
                  size="middle"
                  style={{ minWidth: 220 }}
                />
                <Button
                  icon={<Settings2 size={14} />}
                  size="small"
                  type="text"
                  style={{ color: token.colorTextSecondary }}
                  onClick={() => setSettingsOpen(true)}
                >
                  {t('agent.profile.advancedSettings')}
                </Button>
              </Flexbox>

              {/* Skill / Applet selector */}
              <div style={{ marginBottom: 12 }}>
                <SkillAppletTagBar
                  onNavigateSkills={onNavigateSkills}
                  onNavigateApplets={onNavigateApplets}
                />
              </div>

              {/* Action Button */}
              <div style={{ marginTop: 8, marginBottom: 8 }}>
                <Button
                  type="primary"
                  icon={<Play size={14} />}
                  onClick={() => onStartChat(agent.name)}
                >
                  {t('agent.profile.startConversation')}
                </Button>
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
                <OverviewTab
                  agent={agent}
                  onStartChat={onStartChat}
                  onOpenSettings={() => setSettingsOpen(true)}
                />
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
                  <span
                    style={{
                      fontSize: 12,
                      color: token.colorTextDescription,
                      flexShrink: 0,
                    }}
                  >
                    {t('agent.profile.promptHelp')}
                  </span>
                </Flexbox>
              )}

              {activeTab === 'runtime' && (
                <RuntimeTab
                  agent={agent}
                  availableModels={availableModels}
                  onModelChange={handleModelChange}
                  onOpenSettings={() => setSettingsOpen(true)}
                />
              )}

              {activeTab === 'capabilities' && (
                <CapabilitiesTab
                  agent={agent}
                  onNavigateSkills={onNavigateSkills}
                  onNavigateApplets={onNavigateApplets}
                />
              )}

              {activeTab === 'cron' && (
                <CronTab agentName={agent.name} onNavigateCron={onNavigateCron} />
              )}

              {activeTab === 'memories' && <MemoryTab agentName={agent.name} agentId={agent.id} />}
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
        contextPayload={{
          target_agent_id: agent.id,
          target_agent_name: agent.name,
        }}
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
