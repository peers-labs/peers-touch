import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { Flexbox } from 'react-layout-kit';
import { EmojiPicker } from '@lobehub/ui';
import {
  theme,
  Button,
  Divider,
  Tag,
  Empty,
  message as antMessage,
} from 'antd';
import {
  Settings2,
  Play,
  Clock,
  Brain,
  Zap,
  Plus,
} from 'lucide-react';
import { useChatStore } from '../store/chat';
import {
  api,
  type Agent,
  parseAgentChatConfig,
} from '../services/desktop_api';
import { ModelSelect } from '../components/ModelSelect';
import { AgentSettingsModal } from '../components/AgentSettingsModal';
import { BuilderPanel } from '../components/BuilderPanel';
import { SkillAppletTagBar } from '../components/SkillAppletSelector';

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
          Add Task
        </Button>
      </Flexbox>
      <Flexbox style={{ flex: 1, overflow: 'auto' }}>
        {jobs.length === 0 ? (
          <span style={{ fontSize: 13, color: token.colorTextDescription, padding: '16px 0' }}>
            No scheduled tasks for this agent.
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
                  {job.enabled ? 'Active' : 'Paused'}
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
        setLoadError(err?.message || 'Failed to load memories');
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
          Loading memory brain...
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
          All ({memories.length})
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
                ? 'No memories for this agent yet.'
                : 'No memories in this layer.'}
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
                      accessed {m.access_count}x
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

type ProfileTab = 'prompt' | 'cron' | 'memories';

const TABS: { key: ProfileTab; label: string; icon: ReactNode }[] = [
  { key: 'prompt', label: 'Prompt', icon: null },
  { key: 'cron', label: 'Scheduled Tasks', icon: <Clock size={13} /> },
  { key: 'memories', label: 'Memories', icon: <Brain size={13} /> },
];

export function AgentProfilePage({
  agentName,
  onBack,
  onStartChat,
  onNavigateCron,
  onNavigateSkills,
  onNavigateApplets,
}: AgentProfilePageProps) {
  const { token } = theme.useToken();
  const { agents, availableModels, loadAgents, loadModels } = useChatStore();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [promptDirty, setPromptDirty] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showBuilder, setShowBuilder] = useState(true);
  const [activeTab, setActiveTab] = useState<ProfileTab>('prompt');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    loadAgents();
    loadModels();
  }, [loadAgents, loadModels]);

  // Refresh agent data when Agent Builder modifies the agent
  useEffect(() => {
    const handler = () => loadAgents();
    window.addEventListener('agent-builder:stream-end', handler);
    return () => window.removeEventListener('agent-builder:stream-end', handler);
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
        antMessage.error(err.message || 'Failed to save');
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
        antMessage.error(err.message || 'Failed to update model');
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
        antMessage.error(err.message || 'Failed to update avatar');
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
        <Empty description="Agent not found" />
        {onBack && (
          <Button type="link" onClick={onBack}>
            Go back
          </Button>
        )}
      </Flexbox>
    );
  }

  parseAgentChatConfig(agent);

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
                      Built-in
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
                  placeholder="Default model"
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
                  Advanced Settings
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
                  Start Conversation
                </Button>
              </div>
            </div>

            <Divider style={{ margin: '8px 0 0' }} />

            {/* ── Tab bar (no font-weight change to prevent wobble) ── */}
            <div style={{ display: 'flex', gap: 0, flexShrink: 0 }}>
              {TABS.map((tab) => (
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
                    userSelect: 'none',
                  }}
                >
                  {tab.icon}
                  {tab.label}
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
              {activeTab === 'prompt' && (
                <Flexbox flex={1} gap={6} style={{ minHeight: 0 }}>
                  <textarea
                    value={systemPrompt}
                    onChange={handlePromptChange}
                    onBlur={handlePromptBlur}
                    placeholder="You are a helpful assistant that..."
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
                    The agent&apos;s personality, instructions, and behavior. This is sent as
                    the system message at the start of every conversation.
                  </span>
                </Flexbox>
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
        welcomeTitle="Agent Builder"
        welcomeDescription="Tell me your use case. Writing, coding, or data analysis &mdash; anything works. You own the goal and standards; I'll break it down into collaborative, runnable Agents."
        welcomeAvatar="🏗️"
        suggestQuestions={[
          'Help me design a customer support agent',
          'Create a code review assistant',
          'Build a research analyst agent',
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
