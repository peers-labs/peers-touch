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
  PackageSearch,
  Download,
  ShieldCheck,
  CheckCircle2,
  Database,
  Clipboard,
  Upload,
  Trash2,
  UsersRound,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useChatStore } from '../store/chat';
import {
  api,
  listA2ATasks,
  startA2AGroupRun,
  updateA2ATask,
  bindKnowledgeResource,
  deleteKnowledgeResource,
  listAgentMarketplaceEntries,
  listKnowledgeResources,
  listTaskReviews,
  updateKnowledgeResource,
  updateTaskReview,
  deleteAgentChannelBinding,
  listAgentChannelBindings,
  toggleAgentChannelBinding,
  upsertAgentChannelBinding,
  type Agent,
  type AgentChannelBinding,
  type A2ARun,
  type A2ATask,
  type AvailableModel,
  type Channel,
  type AgentMarketplaceEntry,
  type KnowledgeResource,
  type MCPServerItem,
  type TaskReview,
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

function CronTab({ agentName, agentId, onNavigateCron }: { agentName: string; agentId: string; onNavigateCron?: () => void }) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const [jobs, setJobs] = useState<any[]>([]);
  const [runsByJob, setRunsByJob] = useState<Record<string, any[]>>({});
  const [reviews, setReviews] = useState<TaskReview[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.listCronJobs(),
      listTaskReviews(agentId).catch(() => ({ reviews: [] })),
    ])
      .then(async ([all, reviewRes]) => {
        const filtered = all.filter((j: any) => j.agentName === agentName || j.agent_name === agentName);
        setJobs(filtered);
        setReviews(reviewRes.reviews || []);
        const entries = await Promise.all(
          filtered.map(async (job: any) => {
            const runs = await api.listCronRuns(job.id).catch(() => []);
            return [job.id, runs] as const;
          }),
        );
        setRunsByJob(Object.fromEntries(entries));
      })
      .catch(() => {
        setJobs([]);
        setReviews([]);
        setRunsByJob({});
      })
      .finally(() => setLoading(false));
  }, [agentId, agentName]);

  const reviewByTarget = useMemo(() => {
    const map = new Map<string, TaskReview>();
    for (const review of reviews) map.set(review.target_id, review);
    return map;
  }, [reviews]);

  const refreshReviews = useCallback(() => {
    listTaskReviews(agentId).then((res) => setReviews(res.reviews || [])).catch(() => setReviews([]));
  }, [agentId]);

  const handleRunNow = useCallback(async (jobId: string) => {
    try {
      await api.runCronJob(jobId);
      antMessage.success(t('agent.taskBoard.runStarted'));
      const runs = await api.listCronRuns(jobId).catch(() => []);
      setRunsByJob((prev) => ({ ...prev, [jobId]: runs }));
    } catch (err: any) {
      antMessage.error(err?.message || t('agent.taskBoard.runFailed'));
    }
  }, [t]);

  const handleReview = useCallback(async (jobId: string, status: string) => {
    try {
      await updateTaskReview({
        agent_id: agentId,
        target_id: jobId,
        target_type: 'cron_job',
        status,
      });
      refreshReviews();
    } catch (err: any) {
      antMessage.error(err?.message || t('agent.taskBoard.reviewFailed'));
    }
  }, [agentId, refreshReviews, t]);

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
                gap={8}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorBgContainer,
                }}
              >
                <Flexbox horizontal align="center" gap={8}>
                  <Zap
                    size={14}
                    style={{ color: job.enabled ? token.colorSuccess : token.colorTextQuaternary }}
                  />
                  <span style={{ flex: 1, fontSize: 13, color: token.colorText }}>{job.name}</span>
                  <Tag>{job.scheduleKind || job.schedule_kind || 'cron'}</Tag>
                  <Tag color={job.enabled ? 'green' : 'default'}>
                    {job.enabled ? t('agent.cron.active') : t('agent.cron.paused')}
                  </Tag>
                  <Tag color={reviewByTarget.get(job.id)?.status === 'accepted' ? 'green' : 'default'}>
                    {reviewByTarget.get(job.id)?.status || t('agent.taskBoard.unreviewed')}
                  </Tag>
                </Flexbox>
                <Flexbox horizontal align="center" justify="space-between" gap={8}>
                  <span style={{ fontSize: 12, color: token.colorTextDescription }}>
                    {runsByJob[job.id]?.[0]?.status || job.lastStatus || job.last_status || t('agent.taskBoard.noRuns')}
                  </span>
                  <Flexbox horizontal gap={6}>
                    <Button size="small" icon={<Play size={13} />} onClick={() => handleRunNow(job.id)}>
                      {t('agent.taskBoard.runNow')}
                    </Button>
                    <Button size="small" onClick={() => handleReview(job.id, 'accepted')}>
                      {t('agent.taskBoard.accept')}
                    </Button>
                    <Button size="small" onClick={() => handleReview(job.id, 'needs_changes')}>
                      {t('agent.taskBoard.needsChanges')}
                    </Button>
                    <Button size="small" onClick={() => handleReview(job.id, 'rejected')}>
                      {t('agent.taskBoard.reject')}
                    </Button>
                  </Flexbox>
                </Flexbox>
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

function CollaborationTab({ agent, agents }: { agent: Agent; agents: Agent[] }) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const [runs, setRuns] = useState<A2ARun[]>([]);
  const [tasks, setTasks] = useState<A2ATask[]>([]);
  const [selectedChildren, setSelectedChildren] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [artifacts, setArtifacts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const agentById = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const item of agents) map.set(item.id, item);
    return map;
  }, [agents]);

  const candidates = useMemo(
    () => agents.filter((item) => item.id !== agent.id),
    [agent.id, agents],
  );

  const loadA2A = useCallback(() => {
    setLoading(true);
    listA2ATasks(agent.id)
      .then((res) => {
        setRuns(res.runs || []);
        setTasks(res.tasks || []);
        const nextArtifacts: Record<string, string> = {};
        for (const task of res.tasks || []) nextArtifacts[task.id] = task.artifact || '';
        setArtifacts(nextArtifacts);
      })
      .catch(() => {
        setRuns([]);
        setTasks([]);
      })
      .finally(() => setLoading(false));
  }, [agent.id]);

  useEffect(() => {
    loadA2A();
  }, [loadA2A]);

  const toggleChild = useCallback((childId: string) => {
    setSelectedChildren((prev) =>
      prev.includes(childId) ? prev.filter((id) => id !== childId) : [...prev, childId],
    );
  }, []);

  const handleStart = useCallback(async () => {
    if (!prompt.trim()) {
      antMessage.warning(t('agent.a2a.promptRequired'));
      return;
    }
    if (selectedChildren.length === 0) {
      antMessage.warning(t('agent.a2a.childRequired'));
      return;
    }
    setSubmitting(true);
    try {
      await startA2AGroupRun({
        parent_agent_id: agent.id,
        parent_agent_name: agent.title || agent.name,
        child_agent_ids: selectedChildren,
        title: title.trim() || undefined,
        prompt: prompt.trim(),
      });
      setTitle('');
      setPrompt('');
      setSelectedChildren([]);
      antMessage.success(t('agent.a2a.started'));
      loadA2A();
    } catch (err: any) {
      antMessage.error(err?.message || t('agent.a2a.startFailed'));
    } finally {
      setSubmitting(false);
    }
  }, [agent, loadA2A, prompt, selectedChildren, title, t]);

  const handleTaskUpdate = useCallback(
    async (task: A2ATask, status: string) => {
      try {
        const artifact = artifacts[task.id] || '';
        await updateA2ATask(task.id, status, artifact);
        antMessage.success(t('agent.a2a.updated'));
        loadA2A();
      } catch (err: any) {
        antMessage.error(err?.message || t('agent.a2a.updateFailed'));
      }
    },
    [artifacts, loadA2A, t],
  );

  const tasksByRun = useMemo(() => {
    const grouped = new Map<string, A2ATask[]>();
    for (const task of tasks) {
      grouped.set(task.run_id, [...(grouped.get(task.run_id) || []), task]);
    }
    return grouped;
  }, [tasks]);

  const visibleRuns = useMemo(() => {
    const runIds = new Set(tasks.map((task) => task.run_id));
    return runs.filter((run) => runIds.has(run.id) || run.parent_agent_id === agent.id);
  }, [agent.id, runs, tasks]);

  const statusColor = (status: string) => {
    if (status === 'completed' || status === 'accepted') return 'green';
    if (status === 'failed') return 'red';
    if (status === 'running') return 'blue';
    return 'default';
  };

  return (
    <Flexbox gap={12} style={{ overflow: 'auto' }}>
      <SectionPanel title={t('agent.a2a.startTitle')} icon={<UsersRound size={15} />}>
        <Flexbox gap={8}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('agent.a2a.titlePlaceholder')}
            style={{
              height: 34,
              borderRadius: 8,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorBgContainer,
              color: token.colorText,
              padding: '0 10px',
              outline: 'none',
            }}
          />
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t('agent.a2a.promptPlaceholder')}
            style={{
              minHeight: 84,
              borderRadius: 8,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorBgContainer,
              color: token.colorText,
              padding: 10,
              resize: 'vertical',
              outline: 'none',
              lineHeight: 1.5,
            }}
          />
          <Flexbox horizontal gap={6} wrap="wrap">
            {candidates.length === 0 && <EmptyValue>{t('agent.a2a.noChildren')}</EmptyValue>}
            {candidates.map((item) => {
              const selected = selectedChildren.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleChild(item.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    minHeight: 30,
                    padding: '4px 9px',
                    borderRadius: 8,
                    border: `1px solid ${selected ? token.colorPrimary : token.colorBorderSecondary}`,
                    background: selected ? token.colorPrimaryBg : token.colorBgContainer,
                    color: selected ? token.colorPrimary : token.colorText,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  <span>{item.avatar || '🤖'}</span>
                  <span>{item.title || item.name}</span>
                </button>
              );
            })}
          </Flexbox>
          <Flexbox horizontal justify="flex-end">
            <Button
              type="primary"
              size="small"
              icon={<Play size={14} />}
              loading={submitting}
              disabled={candidates.length === 0}
              onClick={handleStart}
            >
              {t('agent.a2a.start')}
            </Button>
          </Flexbox>
        </Flexbox>
      </SectionPanel>

      <SectionPanel title={t('agent.a2a.runsTitle')} icon={<Network size={15} />}>
        {loading ? (
          <span style={{ fontSize: 13, color: token.colorTextDescription }}>
            {t('agent.a2a.loading')}
          </span>
        ) : visibleRuns.length === 0 ? (
          <EmptyValue>{t('agent.a2a.empty')}</EmptyValue>
        ) : (
          <Flexbox gap={10}>
            {visibleRuns.map((run) => {
              const runTasks = tasksByRun.get(run.id) || [];
              return (
                <Flexbox
                  key={run.id}
                  gap={8}
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    background: token.colorFillAlter,
                  }}
                >
                  <Flexbox horizontal align="center" gap={8}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: token.colorText }}>
                      {run.title || t('agent.a2a.untitled')}
                    </span>
                    <Tag color={statusColor(run.status)}>{run.status}</Tag>
                    <Tag>{run.transport}</Tag>
                  </Flexbox>
                  <span style={{ fontSize: 12, color: token.colorTextDescription, lineHeight: 1.5 }}>
                    {run.prompt}
                  </span>
                  <Flexbox gap={8}>
                    {runTasks.map((task) => {
                      const child = agentById.get(task.child_agent_id);
                      return (
                        <Flexbox
                          key={task.id}
                          gap={7}
                          style={{
                            padding: 10,
                            borderRadius: 8,
                            border: `1px solid ${token.colorBorderSecondary}`,
                            background: token.colorBgContainer,
                          }}
                        >
                          <Flexbox horizontal align="center" gap={8}>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: token.colorText }}>
                              {child?.title || child?.name || task.child_agent_id}
                            </span>
                            <Tag color={statusColor(task.status)}>{task.status}</Tag>
                            <Tag>{task.audit_event}</Tag>
                          </Flexbox>
                          <textarea
                            value={artifacts[task.id] || ''}
                            onChange={(e) =>
                              setArtifacts((prev) => ({ ...prev, [task.id]: e.target.value }))
                            }
                            placeholder={t('agent.a2a.artifactPlaceholder')}
                            style={{
                              minHeight: 52,
                              borderRadius: 8,
                              border: `1px solid ${token.colorBorderSecondary}`,
                              background: token.colorBgElevated,
                              color: token.colorText,
                              padding: 8,
                              resize: 'vertical',
                              outline: 'none',
                              fontSize: 12,
                              lineHeight: 1.5,
                            }}
                          />
                          <Flexbox horizontal justify="flex-end" gap={6}>
                            <Button
                              size="small"
                              icon={<CheckCircle2 size={13} />}
                              onClick={() => handleTaskUpdate(task, 'accepted')}
                            >
                              {t('agent.a2a.accept')}
                            </Button>
                            <Button
                              size="small"
                              icon={<CheckCircle2 size={13} />}
                              onClick={() => handleTaskUpdate(task, 'completed')}
                            >
                              {t('agent.a2a.complete')}
                            </Button>
                            <Button
                              size="small"
                              icon={<XCircle size={13} />}
                              onClick={() => handleTaskUpdate(task, 'failed')}
                            >
                              {t('agent.a2a.fail')}
                            </Button>
                          </Flexbox>
                        </Flexbox>
                      );
                    })}
                  </Flexbox>
                </Flexbox>
              );
            })}
          </Flexbox>
        )}
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

function KnowledgeTab({ agent }: { agent: Agent }) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const [resources, setResources] = useState<KnowledgeResource[]>([]);
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [resourceType, setResourceType] = useState('document');
  const [policy, setPolicy] = useState('auto');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadResources = useCallback(() => {
    setLoading(true);
    listKnowledgeResources(agent.id)
      .then((res) => setResources(res.resources || []))
      .catch(() => setResources([]))
      .finally(() => setLoading(false));
  }, [agent.id]);

  useEffect(() => {
    loadResources();
  }, [loadResources]);

  const handleBind = useCallback(async () => {
    if (!title.trim() || !source.trim()) {
      antMessage.warning(t('agent.knowledge.required'));
      return;
    }
    setSaving(true);
    try {
      await bindKnowledgeResource({
        agent_id: agent.id,
        title: title.trim(),
        source: source.trim(),
        resource_type: resourceType,
        retrieval_policy: policy,
      });
      setTitle('');
      setSource('');
      antMessage.success(t('agent.knowledge.bound'));
      loadResources();
    } catch (err: any) {
      antMessage.error(err?.message || t('agent.knowledge.bindFailed'));
    } finally {
      setSaving(false);
    }
  }, [agent.id, loadResources, policy, resourceType, source, t, title]);

  const handleToggle = useCallback(
    async (resource: KnowledgeResource) => {
      try {
        await updateKnowledgeResource({ id: resource.id, enabled: !resource.enabled });
        loadResources();
      } catch (err: any) {
        antMessage.error(err?.message || t('agent.knowledge.updateFailed'));
      }
    },
    [loadResources, t],
  );

  const handlePolicy = useCallback(
    async (resource: KnowledgeResource, retrievalPolicy: string) => {
      try {
        await updateKnowledgeResource({ id: resource.id, retrieval_policy: retrievalPolicy });
        loadResources();
      } catch (err: any) {
        antMessage.error(err?.message || t('agent.knowledge.updateFailed'));
      }
    },
    [loadResources, t],
  );

  const handleDelete = useCallback(
    async (resource: KnowledgeResource) => {
      try {
        await deleteKnowledgeResource(resource.id);
        loadResources();
      } catch (err: any) {
        antMessage.error(err?.message || t('agent.knowledge.deleteFailed'));
      }
    },
    [loadResources, t],
  );

  return (
    <Flexbox gap={12} style={{ overflow: 'auto' }}>
      <SectionPanel title={t('agent.knowledge.bindTitle')} icon={<Database size={15} />}>
        <Flexbox gap={8}>
          <Flexbox horizontal gap={8}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('agent.knowledge.titlePlaceholder')}
              style={{
                flex: 1,
                minWidth: 0,
                height: 34,
                borderRadius: 8,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
                color: token.colorText,
                padding: '0 10px',
                outline: 'none',
              }}
            />
            <select
              value={resourceType}
              onChange={(e) => setResourceType(e.target.value)}
              style={{
                width: 118,
                borderRadius: 8,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
                color: token.colorText,
                padding: '0 8px',
              }}
            >
              <option value="document">{t('agent.knowledge.type.document')}</option>
              <option value="project">{t('agent.knowledge.type.project')}</option>
              <option value="notebook">{t('agent.knowledge.type.notebook')}</option>
            </select>
          </Flexbox>
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder={t('agent.knowledge.sourcePlaceholder')}
            style={{
              height: 34,
              borderRadius: 8,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorBgContainer,
              color: token.colorText,
              padding: '0 10px',
              outline: 'none',
            }}
          />
          <Flexbox horizontal justify="space-between" align="center" gap={8}>
            <select
              value={policy}
              onChange={(e) => setPolicy(e.target.value)}
              style={{
                width: 160,
                height: 32,
                borderRadius: 8,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
                color: token.colorText,
                padding: '0 8px',
              }}
            >
              <option value="auto">{t('agent.knowledge.policy.auto')}</option>
              <option value="manual">{t('agent.knowledge.policy.manual')}</option>
              <option value="off">{t('agent.knowledge.policy.off')}</option>
            </select>
            <Button
              type="primary"
              size="small"
              icon={<Plus size={14} />}
              loading={saving}
              onClick={handleBind}
            >
              {t('agent.knowledge.bind')}
            </Button>
          </Flexbox>
        </Flexbox>
      </SectionPanel>

      <SectionPanel title={t('agent.knowledge.resourcesTitle')} icon={<FileText size={15} />}>
        {loading ? (
          <span style={{ fontSize: 13, color: token.colorTextDescription }}>
            {t('agent.knowledge.loading')}
          </span>
        ) : resources.length === 0 ? (
          <EmptyValue>{t('agent.knowledge.empty')}</EmptyValue>
        ) : (
          <Flexbox gap={8}>
            {resources.map((resource) => (
              <Flexbox
                key={resource.id}
                gap={7}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorBgContainer,
                }}
              >
                <Flexbox horizontal align="center" gap={8}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: token.colorText }}>
                    {resource.title}
                  </span>
                  <Tag color={resource.enabled ? 'green' : 'default'}>
                    {resource.enabled ? t('agent.knowledge.enabled') : t('agent.knowledge.disabled')}
                  </Tag>
                  <Tag>{resource.resource_type}</Tag>
                </Flexbox>
                <span style={{ fontSize: 12, color: token.colorTextDescription, lineHeight: 1.5 }}>
                  {resource.source}
                </span>
                <Flexbox horizontal align="center" justify="space-between" gap={8}>
                  <select
                    value={resource.retrieval_policy}
                    onChange={(e) => handlePolicy(resource, e.target.value)}
                    style={{
                      width: 150,
                      height: 30,
                      borderRadius: 8,
                      border: `1px solid ${token.colorBorderSecondary}`,
                      background: token.colorBgElevated,
                      color: token.colorText,
                      padding: '0 8px',
                    }}
                  >
                    <option value="auto">{t('agent.knowledge.policy.auto')}</option>
                    <option value="manual">{t('agent.knowledge.policy.manual')}</option>
                    <option value="off">{t('agent.knowledge.policy.off')}</option>
                  </select>
                  <Flexbox horizontal gap={6}>
                    <Button size="small" onClick={() => handleToggle(resource)}>
                      {resource.enabled ? t('agent.knowledge.disable') : t('agent.knowledge.enable')}
                    </Button>
                    <Button
                      size="small"
                      icon={<Trash2 size={13} />}
                      onClick={() => handleDelete(resource)}
                    >
                      {t('agent.knowledge.delete')}
                    </Button>
                  </Flexbox>
                </Flexbox>
              </Flexbox>
            ))}
          </Flexbox>
        )}
      </SectionPanel>
    </Flexbox>
  );
}

function MarketplaceTab({ onInstalled }: { onInstalled: () => void }) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const [entries, setEntries] = useState<AgentMarketplaceEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [installingId, setInstallingId] = useState('');

  const loadEntries = useCallback(() => {
    setLoading(true);
    listAgentMarketplaceEntries(filter || undefined, q || undefined)
      .then((res) => setEntries(res.entries || []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [filter, q]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const handleInstall = useCallback(
    async (entry: AgentMarketplaceEntry) => {
      setInstallingId(entry.id);
      try {
        if (entry.kind === 'agent') {
          await api.createAgent(entry.manifest as any);
          onInstalled();
        } else if (entry.kind === 'mcp') {
          await api.createMCPServer(entry.manifest as any);
        }
        antMessage.success(t('agent.marketplace.installed'));
      } catch (err: any) {
        antMessage.error(err?.message || t('agent.marketplace.installFailed'));
      } finally {
        setInstallingId('');
      }
    },
    [onInstalled, t],
  );

  const trustColor = (trust: string) => {
    if (trust === 'verified') return 'green';
    if (trust === 'reviewed') return 'blue';
    return 'default';
  };

  return (
    <Flexbox gap={12} style={{ overflow: 'auto' }}>
      <SectionPanel title={t('agent.marketplace.title')} icon={<PackageSearch size={15} />}>
        <Flexbox horizontal gap={8}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('agent.marketplace.searchPlaceholder')}
            style={{
              flex: 1,
              minWidth: 0,
              height: 34,
              borderRadius: 8,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorBgContainer,
              color: token.colorText,
              padding: '0 10px',
              outline: 'none',
            }}
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{
              width: 132,
              borderRadius: 8,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorBgContainer,
              color: token.colorText,
              padding: '0 8px',
            }}
          >
            <option value="">{t('agent.marketplace.kind.all')}</option>
            <option value="agent">{t('agent.marketplace.kind.agent')}</option>
            <option value="mcp">{t('agent.marketplace.kind.mcp')}</option>
          </select>
        </Flexbox>
      </SectionPanel>

      <SectionPanel title={t('agent.marketplace.entries')} icon={<Download size={15} />}>
        {loading ? (
          <span style={{ fontSize: 13, color: token.colorTextDescription }}>
            {t('agent.marketplace.loading')}
          </span>
        ) : entries.length === 0 ? (
          <EmptyValue>{t('agent.marketplace.empty')}</EmptyValue>
        ) : (
          <Flexbox gap={8}>
            {entries.map((entry) => (
              <Flexbox
                key={entry.id}
                gap={8}
                style={{
                  padding: 12,
                  borderRadius: 8,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorBgContainer,
                }}
              >
                <Flexbox horizontal align="center" gap={8}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: token.colorText }}>
                    {entry.name}
                  </span>
                  <Tag>{entry.kind}</Tag>
                  <Tag color={trustColor(entry.trust_level)}>{entry.trust_level}</Tag>
                  <Tag color={entry.verified ? 'green' : 'default'}>
                    {entry.verified ? t('agent.marketplace.verified') : t('agent.marketplace.unverified')}
                  </Tag>
                </Flexbox>
                <span style={{ fontSize: 12, color: token.colorTextDescription, lineHeight: 1.5 }}>
                  {entry.description}
                </span>
                <Flexbox horizontal gap={6} wrap="wrap">
                  <Tag>{entry.publisher}</Tag>
                  <Tag>{entry.source}</Tag>
                  <Tag color={entry.risk === 'low' ? 'green' : 'orange'}>
                    {t('agent.marketplace.risk', { risk: entry.risk })}
                  </Tag>
                  {entry.tags.slice(0, 4).map((tag) => <Tag key={tag}>{tag}</Tag>)}
                </Flexbox>
                <Flexbox horizontal align="center" justify="space-between" gap={8}>
                  <span style={{ fontSize: 12, color: token.colorTextQuaternary }}>
                    {entry.install_hint}
                  </span>
                  <Button
                    size="small"
                    icon={<Download size={13} />}
                    loading={installingId === entry.id}
                    onClick={() => handleInstall(entry)}
                  >
                    {t('agent.marketplace.install')}
                  </Button>
                </Flexbox>
              </Flexbox>
            ))}
          </Flexbox>
        )}
      </SectionPanel>
    </Flexbox>
  );
}

function ChannelBindingsTab({ agent }: { agent: Agent }) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [bindings, setBindings] = useState<AgentChannelBinding[]>([]);
  const [channelId, setChannelId] = useState('');
  const [mirrorMode, setMirrorMode] = useState('inbound_outbound');
  const [topicPolicy, setTopicPolicy] = useState('channel_thread');
  const [executionPolicy, setExecutionPolicy] = useState('manual_approval');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const channelById = useMemo(() => {
    const map = new Map<string, Channel>();
    for (const channel of channels) map.set(channel.id, channel);
    return map;
  }, [channels]);

  const loadBindings = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.listChannels().catch(() => []),
      listAgentChannelBindings(agent.id).catch(() => ({ bindings: [] })),
    ])
      .then(([channelList, bindingRes]) => {
        setChannels(channelList);
        setBindings(bindingRes.bindings || []);
        if (!channelId && channelList[0]) setChannelId(channelList[0].id);
      })
      .finally(() => setLoading(false));
  }, [agent.id, channelId]);

  useEffect(() => {
    loadBindings();
  }, [loadBindings]);

  const handleBind = useCallback(async () => {
    if (!channelId) {
      antMessage.warning(t('agent.channels.channelRequired'));
      return;
    }
    setSaving(true);
    try {
      await upsertAgentChannelBinding({
        agent_id: agent.id,
        channel_id: channelId,
        mirror_mode: mirrorMode,
        topic_policy: topicPolicy,
        execution_policy: executionPolicy,
        enabled: true,
      });
      antMessage.success(t('agent.channels.bound'));
      loadBindings();
    } catch (err: any) {
      antMessage.error(err?.message || t('agent.channels.bindFailed'));
    } finally {
      setSaving(false);
    }
  }, [agent.id, channelId, executionPolicy, loadBindings, mirrorMode, t, topicPolicy]);

  const handleToggle = useCallback(
    async (binding: AgentChannelBinding) => {
      try {
        await toggleAgentChannelBinding(binding.id, !binding.enabled);
        loadBindings();
      } catch (err: any) {
        antMessage.error(err?.message || t('agent.channels.updateFailed'));
      }
    },
    [loadBindings, t],
  );

  const handleDelete = useCallback(
    async (binding: AgentChannelBinding) => {
      try {
        await deleteAgentChannelBinding(binding.id);
        loadBindings();
      } catch (err: any) {
        antMessage.error(err?.message || t('agent.channels.deleteFailed'));
      }
    },
    [loadBindings, t],
  );

  return (
    <Flexbox gap={12} style={{ overflow: 'auto' }}>
      <SectionPanel title={t('agent.channels.bindTitle')} icon={<Link2 size={15} />}>
        <Flexbox gap={8}>
          <Flexbox horizontal gap={8}>
            <select
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              style={{
                flex: 1,
                minWidth: 0,
                height: 34,
                borderRadius: 8,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
                color: token.colorText,
                padding: '0 8px',
              }}
            >
              {channels.length === 0 && <option value="">{t('agent.channels.noChannels')}</option>}
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>{channel.name}</option>
              ))}
            </select>
            <select
              value={mirrorMode}
              onChange={(e) => setMirrorMode(e.target.value)}
              style={{
                width: 170,
                borderRadius: 8,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
                color: token.colorText,
                padding: '0 8px',
              }}
            >
              <option value="inbound_outbound">{t('agent.channels.mirror.both')}</option>
              <option value="inbound_only">{t('agent.channels.mirror.inbound')}</option>
              <option value="outbound_only">{t('agent.channels.mirror.outbound')}</option>
            </select>
          </Flexbox>
          <Flexbox horizontal gap={8}>
            <select
              value={topicPolicy}
              onChange={(e) => setTopicPolicy(e.target.value)}
              style={{
                flex: 1,
                minWidth: 0,
                height: 34,
                borderRadius: 8,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
                color: token.colorText,
                padding: '0 8px',
              }}
            >
              <option value="channel_thread">{t('agent.channels.topic.channelThread')}</option>
              <option value="per_sender">{t('agent.channels.topic.perSender')}</option>
              <option value="single_agent_topic">{t('agent.channels.topic.singleAgent')}</option>
            </select>
            <select
              value={executionPolicy}
              onChange={(e) => setExecutionPolicy(e.target.value)}
              style={{
                width: 180,
                borderRadius: 8,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
                color: token.colorText,
                padding: '0 8px',
              }}
            >
              <option value="manual_approval">{t('agent.channels.policy.manual')}</option>
              <option value="auto_reply">{t('agent.channels.policy.auto')}</option>
              <option value="observe_only">{t('agent.channels.policy.observe')}</option>
            </select>
            <Button
              type="primary"
              size="small"
              loading={saving}
              disabled={channels.length === 0}
              onClick={handleBind}
            >
              {t('agent.channels.bind')}
            </Button>
          </Flexbox>
        </Flexbox>
      </SectionPanel>

      <SectionPanel title={t('agent.channels.bindingsTitle')} icon={<Network size={15} />}>
        {loading ? (
          <span style={{ fontSize: 13, color: token.colorTextDescription }}>
            {t('agent.channels.loading')}
          </span>
        ) : bindings.length === 0 ? (
          <EmptyValue>{t('agent.channels.empty')}</EmptyValue>
        ) : (
          <Flexbox gap={8}>
            {bindings.map((binding) => {
              const channel = channelById.get(binding.channel_id);
              return (
                <Flexbox
                  key={binding.id}
                  gap={7}
                  style={{
                    padding: 10,
                    borderRadius: 8,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    background: token.colorBgContainer,
                  }}
                >
                  <Flexbox horizontal align="center" gap={8}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: token.colorText }}>
                      {channel?.name || binding.channel_id}
                    </span>
                    <Tag color={binding.enabled ? 'green' : 'default'}>
                      {binding.enabled ? t('agent.channels.enabled') : t('agent.channels.disabled')}
                    </Tag>
                    <Tag>{channel?.type || binding.channel_id}</Tag>
                  </Flexbox>
                  <Flexbox horizontal gap={6} wrap="wrap">
                    <Tag>{binding.mirror_mode}</Tag>
                    <Tag>{binding.topic_policy}</Tag>
                    <Tag>{binding.execution_policy}</Tag>
                    <Tag>{binding.audit_event}</Tag>
                  </Flexbox>
                  <Flexbox horizontal justify="flex-end" gap={6}>
                    <Button size="small" onClick={() => handleToggle(binding)}>
                      {binding.enabled ? t('agent.channels.disable') : t('agent.channels.enable')}
                    </Button>
                    <Button size="small" icon={<Trash2 size={13} />} onClick={() => handleDelete(binding)}>
                      {t('agent.channels.delete')}
                    </Button>
                  </Flexbox>
                </Flexbox>
              );
            })}
          </Flexbox>
        )}
      </SectionPanel>
    </Flexbox>
  );
}

function PackageTab({ agent, onImported }: { agent: Agent; onImported: () => void }) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const [packageText, setPackageText] = useState('');
  const [importText, setImportText] = useState('');
  const [working, setWorking] = useState(false);

  const handleExport = useCallback(async () => {
    setWorking(true);
    try {
      const skills = await api.listSkills().catch(() => ({ skills: [] }));
      const enabledSkills = (skills.skills || []).filter((skill: SkillListItem) => skill.enabled);
      const manifest = {
        version: 'peers-touch.agent-package.v1',
        exported_at: new Date().toISOString(),
        agent: {
          name: agent.name,
          title: agent.title,
          description: agent.description,
          avatar: agent.avatar,
          backgroundColor: agent.backgroundColor,
          systemPrompt: agent.systemPrompt,
          model: agent.model,
          provider: agent.provider,
          tags: agent.tags,
          toolsProfile: agent.toolsProfile,
          toolsAllow: agent.toolsAllow,
          toolsDeny: agent.toolsDeny,
          openingMessage: agent.openingMessage,
          openingQuestions: agent.openingQuestions,
          chatConfig: agent.chatConfig,
          params: agent.params,
        },
        skill_bundle: enabledSkills.map((skill: SkillListItem) => ({
          id: skill.id,
          identifier: skill.identifier,
          name: skill.name,
          version: skill.version,
        })),
        provider_preset: {
          provider: agent.provider,
          model: agent.model,
        },
      };
      setPackageText(JSON.stringify(manifest, null, 2));
    } finally {
      setWorking(false);
    }
  }, [agent]);

  const handleImport = useCallback(async () => {
    try {
      const parsed = JSON.parse(importText);
      const source = parsed.agent || parsed;
      if (!source.name) {
        antMessage.warning(t('agent.package.invalid'));
        return;
      }
      await api.createAgent({
        ...source,
        name: `${source.name}-imported-${Date.now().toString(36)}`,
        title: source.title ? `${source.title} Imported` : undefined,
        pinned: false,
      });
      antMessage.success(t('agent.package.imported'));
      setImportText('');
      onImported();
    } catch (err: any) {
      antMessage.error(err?.message || t('agent.package.importFailed'));
    }
  }, [importText, onImported, t]);

  return (
    <Flexbox gap={12} style={{ overflow: 'auto' }}>
      <SectionPanel
        title={t('agent.package.exportTitle')}
        icon={<Clipboard size={15} />}
        action={
          <Button size="small" icon={<Clipboard size={13} />} loading={working} onClick={handleExport}>
            {t('agent.package.export')}
          </Button>
        }
      >
        <textarea
          value={packageText}
          readOnly
          placeholder={t('agent.package.exportPlaceholder')}
          style={{
            minHeight: 190,
            borderRadius: 8,
            border: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
            color: token.colorText,
            padding: 10,
            resize: 'vertical',
            outline: 'none',
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        />
      </SectionPanel>

      <SectionPanel
        title={t('agent.package.importTitle')}
        icon={<Upload size={15} />}
        action={
          <Button size="small" icon={<Upload size={13} />} onClick={handleImport}>
            {t('agent.package.import')}
          </Button>
        }
      >
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder={t('agent.package.importPlaceholder')}
          style={{
            minHeight: 140,
            borderRadius: 8,
            border: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
            color: token.colorText,
            padding: 10,
            resize: 'vertical',
            outline: 'none',
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        />
      </SectionPanel>
    </Flexbox>
  );
}

// ── Main Agent Profile Page ─────────────────────────────────────────

type ProfileTab = 'overview' | 'prompt' | 'runtime' | 'capabilities' | 'collaboration' | 'knowledge' | 'channels' | 'marketplace' | 'package' | 'memories' | 'cron';

const TAB_KEYS: { key: ProfileTab; labelKey: string; icon: ReactNode }[] = [
  { key: 'overview', labelKey: 'agent.profile.tab.overview', icon: <Bot size={13} /> },
  { key: 'prompt', labelKey: 'agent.profile.tab.prompt', icon: <FileText size={13} /> },
  { key: 'runtime', labelKey: 'agent.profile.tab.runtime', icon: <Cpu size={13} /> },
  { key: 'capabilities', labelKey: 'agent.profile.tab.capabilities', icon: <Wrench size={13} /> },
  { key: 'collaboration', labelKey: 'agent.profile.tab.collaboration', icon: <Network size={13} /> },
  { key: 'knowledge', labelKey: 'agent.profile.tab.knowledge', icon: <Database size={13} /> },
  { key: 'channels', labelKey: 'agent.profile.tab.channels', icon: <Link2 size={13} /> },
  { key: 'marketplace', labelKey: 'agent.profile.tab.marketplace', icon: <PackageSearch size={13} /> },
  { key: 'package', labelKey: 'agent.profile.tab.package', icon: <Clipboard size={13} /> },
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

              {activeTab === 'collaboration' && (
                <CollaborationTab agent={agent} agents={agents} />
              )}

              {activeTab === 'knowledge' && (
                <KnowledgeTab agent={agent} />
              )}

              {activeTab === 'marketplace' && (
                <MarketplaceTab onInstalled={loadAgents} />
              )}

              {activeTab === 'channels' && (
                <ChannelBindingsTab agent={agent} />
              )}

              {activeTab === 'package' && (
                <PackageTab agent={agent} onImported={loadAgents} />
              )}

              {activeTab === 'cron' && (
                <CronTab agentName={agent.name} agentId={agent.id} onNavigateCron={onNavigateCron} />
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
