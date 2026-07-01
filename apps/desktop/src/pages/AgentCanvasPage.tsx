import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Tag } from '@lobehub/ui';
import { Empty, Input, theme } from 'antd';
import {
  Activity,
  ArrowLeft,
  Bot,
  ChevronRight,
  CheckCircle2,
  CircleStop,
  Layers3,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { CollaborationEngineType, CollaborationTaskStatus, TaskNodeStatus } from '../gen/proto/domain/agent/orchestration_pb';
import { api, streamAgentCollaborationEvents } from '../services/desktop_api';
import type { Agent } from '../services/desktop_api';
import { AgentIconTile } from '../components/agent/AgentIconTile';
import { useAgentStore } from '../store/agent';

type CanvasRunState = 'idle' | 'matched' | 'running' | 'completed' | 'failed' | 'cancelled';

interface CanvasNode {
  id: string;
  agent: Agent;
  status: CanvasRunState;
  turnId?: string;
  resultSummary?: string;
}

interface AgentCanvasPageProps {
  onBack: () => void;
  onCreateAgent: (agentName: string) => void;
}

function inferEngine(prompt: string, nodes: CanvasNode[], t: (key: string) => string) {
  const source = prompt.toLowerCase();
  if (/review|validate|risk|评审|风险|验收/.test(source)) return t('agent.canvas.engine.review');
  if (/build|implement|code|实现|落地|代码/.test(source)) return t('agent.canvas.engine.delivery');
  if (/summary|report|总结|汇总|报告/.test(source)) return t('agent.canvas.engine.synthesis');
  return nodes.length > 1 ? t('agent.canvas.engine.parallel') : t('agent.canvas.engine.single');
}

function inferEngineType(prompt: string) {
  const source = prompt.toLowerCase();
  if (/review|validate|risk|评审|风险|验收/.test(source)) return CollaborationEngineType.EXPERT_HIERARCHY;
  if (/build|implement|code|实现|落地|代码/.test(source)) return CollaborationEngineType.HIERARCHY;
  if (/debate|比较|取舍|争论/.test(source)) return CollaborationEngineType.DEBATE_JUDGE;
  return CollaborationEngineType.EXPERT_MESH;
}

function enumName(value: unknown) {
  return String(value ?? '').toUpperCase();
}

function nodeStatusToRunState(status: TaskNodeStatus | string | undefined): CanvasRunState {
  const name = enumName(status);
  if (status === TaskNodeStatus.RUNNING || name.includes('RUNNING')) return 'running';
  if (status === TaskNodeStatus.COMPLETED || name.includes('COMPLETED')) return 'completed';
  if (status === TaskNodeStatus.FAILED || name.includes('FAILED')) return 'failed';
  if (status === TaskNodeStatus.SKIPPED || name.includes('SKIPPED')) return 'cancelled';
  return 'matched';
}

function taskStatusToRunState(status?: CollaborationTaskStatus | string): CanvasRunState {
  const name = enumName(status);
  if (status === CollaborationTaskStatus.FAILED || name.includes('FAILED')) return 'failed';
  if (status === CollaborationTaskStatus.COMPLETED || name.includes('COMPLETED')) return 'completed';
  if (status === CollaborationTaskStatus.CANCELLED || name.includes('CANCELLED')) return 'cancelled';
  return 'running';
}


function formatCanvasResultSummary(summary: string | undefined, t: (key: string) => string) {
  if (!summary) return '';
  if (/no credentials|credential|provider/i.test(summary)) return t('agent.canvas.resultRuntimeUnavailable');
  return summary;
}

function fieldString(value: unknown, ...keys: string[]) {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const raw = record[key];
    if (raw !== undefined && raw !== null) return String(raw);
  }
  return '';
}

export function AgentCanvasPage({ onBack, onCreateAgent }: AgentCanvasPageProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const { agents, loadAgents, setAgentSurface, setSelectedAgent } = useAgentStore();
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [prompt, setPrompt] = useState('');
  const [runState, setRunState] = useState<CanvasRunState>('idle');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [runError, setRunError] = useState('');
  const [agentSearch, setAgentSearch] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(true);
  const streamControllersRef = useRef<AbortController[]>([]);
  const taskEventSeqRef = useRef<Record<string, number>>({});
  const runSeqRef = useRef(0);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  useEffect(() => () => {
    streamControllersRef.current.forEach((controller) => controller.abort());
    streamControllersRef.current = [];
  }, []);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const engineLabel = useMemo(() => inferEngine(prompt, nodes, t), [nodes, prompt, t]);
  const canRun = nodes.length > 0 && prompt.trim().length > 0;
  const isRunning = runState === 'running';
  const visibleAgents = useMemo(() => {
    const query = agentSearch.trim().toLowerCase();
    if (!query) return agents;
    return agents.filter((agent) =>
      [agent.title, agent.name, agent.description, agent.tags].some((value) =>
        String(value || '').toLowerCase().includes(query),
      ),
    );
  }, [agentSearch, agents]);
  const canvasTemplates = useMemo(() => [
    {
      id: 'architecture-review',
      title: t('agent.canvas.template.review'),
      description: t('agent.canvas.template.reviewDesc'),
      prompt: t('agent.canvas.template.reviewPrompt'),
      count: 3,
    },
    {
      id: 'delivery',
      title: t('agent.canvas.template.delivery'),
      description: t('agent.canvas.template.deliveryDesc'),
      prompt: t('agent.canvas.examplePrompt'),
      count: 4,
    },
    {
      id: 'research-summary',
      title: t('agent.canvas.template.research'),
      description: t('agent.canvas.template.researchDesc'),
      prompt: t('agent.canvas.template.researchPrompt'),
      count: 3,
    },
  ], [t]);
  const completedNodes = nodes.filter((node) => node.status === 'completed');
  const failedNodes = nodes.filter((node) => node.status === 'failed');
  const hasResult = runState === 'completed' || runState === 'failed' || runState === 'cancelled' || nodes.some((node) => node.resultSummary);
  const resultCards = useMemo(() => {
    const contributionLines = nodes.length
      ? nodes.map((node) => `${node.agent.title || node.agent.name}: ${formatCanvasResultSummary(node.resultSummary, t) || t(`agent.canvas.status.${node.status}`)}`)
      : [t('agent.canvas.resultNoNodes')];
    return [
      {
        title: t('agent.canvas.resultFinal'),
        tone: 'purple' as const,
        lines: [
          prompt.trim() || t('agent.canvas.resultNoPrompt'),
          t('agent.canvas.resultEngine', { engine: engineLabel }),
          t('agent.canvas.resultState', { state: t(`agent.canvas.status.${runState}`) }),
        ],
      },
      {
        title: t('agent.canvas.resultContributions'),
        tone: 'blue' as const,
        lines: contributionLines,
      },
      {
        title: t('agent.canvas.resultQualityCheck'),
        tone: 'green' as const,
        lines: [
          t('agent.canvas.resultCoverageNodes', { completed: completedNodes.length, total: nodes.length }),
          t('agent.canvas.resultCoverageTask', { taskId: taskId || t('agent.canvas.none') }),
          t('agent.canvas.resultCoverageTrace', { traced: nodes.filter((node) => node.turnId).length, total: nodes.length }),
        ],
      },
      {
        title: t('agent.canvas.resultRisks'),
        tone: failedNodes.length ? 'red' as const : 'orange' as const,
        lines: failedNodes.length
          ? failedNodes.map((node) => `${node.agent.title || node.agent.name}: ${formatCanvasResultSummary(node.resultSummary, t) || t('agent.canvas.failed')}`)
          : [
            t('agent.canvas.resultRiskCancel'),
            t('agent.canvas.resultRiskE2e'),
            t('agent.canvas.resultNextStep'),
          ],
      },
    ];
  }, [completedNodes.length, engineLabel, failedNodes, nodes, prompt, runState, t, taskId]);

  const fillExamplePrompt = useCallback(() => {
    if (isRunning) return;
    setPrompt(t('agent.canvas.examplePrompt'));
    setRunState(nodes.length ? 'matched' : 'idle');
  }, [isRunning, nodes.length, t]);

  const addAgent = useCallback((agent: Agent) => {
    if (isRunning) return;
    setNodes((current) => {
      if (current.some((node) => node.agent.id === agent.id)) return current;
      return [...current, { id: `${agent.id}:${Date.now()}`, agent, status: 'idle' }];
    });
    setRunState(prompt.trim() ? 'matched' : 'idle');
  }, [isRunning, prompt]);

  const handleCreateAgent = useCallback(async () => {
    if (isRunning) return;
    const suffix = Date.now().toString(36);
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
    await loadAgents();
    setAgentSurface(created.name, 'profile');
    setSelectedAgent(created.name);
    onCreateAgent(created.name);
  }, [isRunning, loadAgents, onCreateAgent, setAgentSurface, setSelectedAgent, t]);

  const removeNode = useCallback((nodeId: string) => {
    if (isRunning) return;
    setNodes((current) => {
      const next = current.filter((node) => node.id !== nodeId);
      setRunState(next.length > 0 && prompt.trim() ? 'matched' : 'idle');
      return next;
    });
    setSelectedNodeId((current) => (current === nodeId ? '' : current));
  }, [isRunning, prompt]);

  const runCanvas = useCallback(() => {
    if (!canRun) return;
    const runSeq = runSeqRef.current + 1;
    runSeqRef.current = runSeq;
    const agentById = new Map(nodes.map((node) => [node.agent.id, node.agent]));
    streamControllersRef.current.forEach((controller) => controller.abort());
    streamControllersRef.current = [];
    const startTaskStreams = (nextTaskId: string) => {
      streamControllersRef.current.forEach((controller) => controller.abort());
      const afterEventSeq = taskEventSeqRef.current[nextTaskId] || 0;
      streamControllersRef.current = nodes.map((node) => streamAgentCollaborationEvents(
        node.agent.id,
        (event) => {
          if (runSeqRef.current !== runSeq) return;
          if (!event.event.startsWith('agent.collaboration.')) return;
          const payload = (event.data?.payload || {}) as Record<string, any>;
          const metadata = (event.data?.metadata || {}) as Record<string, any>;
          const eventTaskId = String(payload.task_id || metadata.task_id || nextTaskId);
          const eventSeq = Number(metadata.event_seq || 0);
          if (eventTaskId && Number.isFinite(eventSeq) && eventSeq > (taskEventSeqRef.current[eventTaskId] || 0)) {
            taskEventSeqRef.current[eventTaskId] = eventSeq;
          }
          if (eventTaskId) setTaskId(eventTaskId);
          if (event.event === 'agent.collaboration.node.running') {
            setNodes((current) => current.map((currentNode) => {
              if (currentNode.agent.id !== event.agentId) return currentNode;
              return {
                ...currentNode,
                id: String(payload.node_id || currentNode.id),
                status: 'running',
              };
            }));
          }
          if (event.event === 'agent.collaboration.node.completed' || event.event === 'agent.collaboration.node.failed') {
            setNodes((current) => current.map((currentNode) => {
              if (currentNode.agent.id !== event.agentId) return currentNode;
              return {
                ...currentNode,
                id: String(payload.node_id || currentNode.id),
                status: event.event === 'agent.collaboration.node.failed' ? 'failed' : 'completed',
                turnId: typeof payload.turn_id === 'string' ? payload.turn_id : currentNode.turnId,
                resultSummary: typeof payload.result_summary === 'string' ? payload.result_summary : currentNode.resultSummary,
              };
            }));
          }
          if (event.event === 'agent.collaboration.task.completed') {
            setRunState('completed');
          }
          if (event.event === 'agent.collaboration.task.failed') {
            setRunState('failed');
            setRunError((current) => current || t('agent.canvas.failed'));
          }
          if (event.event === 'agent.collaboration.task.cancelled') {
            setRunState('cancelled');
          }
        },
        (error) => {
          if (runSeqRef.current !== runSeq) return;
          // HTTP gateway/dev modes may not expose long-lived Tauri streams yet;
          // the create/get fallback below still keeps the Canvas state correct.
          setRunError((current) => current || error.message);
        },
        { taskId: nextTaskId, afterEventSeq },
      ));
    };
    setRunState('running');
    setNodes((current) => current.map((node) => ({ ...node, status: 'running' })));
    setRunError('');
    void api.createAgentCollaborationTask({
      title: prompt.trim().slice(0, 80) || t('agent.canvas.title'),
      description: prompt.trim(),
      engine_type: inferEngineType(prompt),
      agent_ids: nodes.map((node) => node.agent.id),
    }).then(async (created) => {
      const createdTaskId = fieldString(created.task, 'taskId', 'task_id');
      if (!createdTaskId) throw new Error(t('agent.canvas.errorNoTask'));
      if (runSeqRef.current !== runSeq) return;
      setTaskId(createdTaskId);
      taskEventSeqRef.current[createdTaskId] = taskEventSeqRef.current[createdTaskId] || 0;
      startTaskStreams(createdTaskId);

      const applyTaskDetail = (detail: Awaited<ReturnType<typeof api.getAgentCollaborationTask>>) => {
        const taskStatus = detail.task?.status;
        const nextRunState = taskStatusToRunState(taskStatus);
        setRunState(nextRunState);
        if (nextRunState === 'failed') {
          const failedNode = detail.nodes.find((node) => nodeStatusToRunState(node.status) === 'failed');
          const failureSummary = fieldString(failedNode, 'resultSummary', 'result_summary');
          setRunError(formatCanvasResultSummary(failureSummary, t) || t('agent.canvas.failed'));
        }
        setNodes((current) => {
          const byNodeAgent = new Map(detail.nodes.map((node) => [fieldString(node, 'agentId', 'agent_id'), node]));
          return current.map((node, index) => {
            const persisted = byNodeAgent.get(node.agent.id) || detail.nodes[index];
            return {
              ...node,
              id: fieldString(persisted, 'nodeId', 'node_id') || node.id,
              agent: agentById.get(node.agent.id) || node.agent,
              status: persisted ? nodeStatusToRunState(persisted.status) : node.status,
              turnId: fieldString(persisted, 'turnId', 'turn_id') || node.turnId,
              resultSummary: fieldString(persisted, 'resultSummary', 'result_summary'),
            };
          });
        });
        return nextRunState;
      };

      const pollTask = async (attempt = 0): Promise<void> => {
        const detail = await api.getAgentCollaborationTask(createdTaskId);
        if (runSeqRef.current !== runSeq) return;
        const nextRunState = applyTaskDetail(detail);
        if (nextRunState === 'running' && attempt < 120) {
          window.setTimeout(() => {
            void pollTask(attempt + 1);
          }, 1500);
        }
      };
      await pollTask();
    }).catch((error) => {
      if (runSeqRef.current !== runSeq) return;
      setRunState('failed');
      setRunError(error instanceof Error ? error.message : String(error));
      setNodes((current) => current.map((node) => ({ ...node, status: 'failed' })));
    });
  }, [canRun, nodes, prompt, t]);

  const resetCanvas = useCallback(() => {
    runSeqRef.current += 1;
    streamControllersRef.current.forEach((controller) => controller.abort());
    streamControllersRef.current = [];
    setNodes([]);
    setPrompt('');
    setSelectedNodeId('');
    setTaskId('');
    setRunError('');
    setRunState('idle');
  }, []);

  const stopCanvas = useCallback(() => {
    runSeqRef.current += 1;
    const currentTaskId = taskId;
    streamControllersRef.current.forEach((controller) => controller.abort());
    streamControllersRef.current = [];
    if (currentTaskId) {
      void api.cancelAgentCollaborationTask(currentTaskId).catch((error) => {
        setRunError(error instanceof Error ? error.message : String(error));
      });
    }
    setRunState('cancelled');
    setNodes((current) => current.map((node) => (node.status === 'running' ? { ...node, status: 'cancelled' } : node)));
  }, [taskId]);

  const applyCanvasTemplate = useCallback((template: (typeof canvasTemplates)[number]) => {
    if (isRunning) return;
    const selectedAgents = agents.slice(0, Math.min(template.count, agents.length));
    setNodes(selectedAgents.map((agent, index) => ({
      id: `${agent.id}:template:${template.id}:${index}`,
      agent,
      status: 'idle',
    })));
    setSelectedNodeId('');
    setTaskId('');
    setRunError('');
    setPrompt(template.prompt);
    setRunState(selectedAgents.length ? 'matched' : 'idle');
  }, [agents, canvasTemplates, isRunning]);

  return (
    <div
      style={{
        height: '100%',
        minWidth: 0,
        display: 'flex',
        background: token.colorBgLayout,
        color: token.colorText,
        overflow: 'hidden',
      }}
    >
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header
          style={{
            flexShrink: 0,
            minHeight: 86,
            padding: '16px 22px',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            background: 'rgba(255, 255, 255, 0.82)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <Flexbox horizontal align="center" gap={12} style={{ minWidth: 0 }}>
            <Button
              size="small"
              icon={<ArrowLeft size={15} />}
              onClick={onBack}
              title={t('agent.canvas.back')}
              aria-label={t('agent.canvas.back')}
              style={{ width: 32, height: 32, padding: 0 }}
            />
            <Flexbox gap={2} style={{ minWidth: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 750, color: token.colorTextTertiary, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                {t('agent.canvas.eyebrow')}
              </span>
              <span style={{ fontSize: 22, fontWeight: 850, color: token.colorText, letterSpacing: -0.4 }}>
                {t('agent.canvas.title')}
              </span>
              <span style={{ fontSize: 12, color: token.colorTextSecondary }}>
                {t('agent.canvas.subtitle')}
              </span>
            </Flexbox>
          </Flexbox>
          <Flexbox horizontal align="center" gap={8} style={{ flexShrink: 0 }}>
            <Tag color="purple" style={{ margin: 0 }}>{engineLabel}</Tag>
            <Tag color="green" style={{ margin: 0 }}>{t('agent.canvas.goalKeeperEnabled')}</Tag>
          </Flexbox>
        </header>

        <section
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: `${libraryOpen ? '250px' : '56px'} minmax(520px, 1fr) 320px`,
            gap: 16,
            padding: 16,
            overflow: 'auto',
          }}
        >
          <aside
            style={{
              minHeight: 0,
              borderRadius: 22,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: 'rgba(255,255,255,0.92)',
              boxShadow: '0 18px 48px rgba(15, 23, 42, 0.06)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            {libraryOpen ? (
              <>
            <Flexbox horizontal align="center" justify="space-between" gap={12} style={{ padding: 14, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
              <Flexbox gap={2} style={{ minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: token.colorText }}>{t('agent.canvas.library')}</span>
                <span style={{ fontSize: 11, color: token.colorTextTertiary }}>{t('agent.canvas.libraryHint')}</span>
              </Flexbox>
              <Flexbox horizontal gap={6} style={{ flexShrink: 0 }}>
                <Button size="small" icon={<Plus size={14} />} onClick={handleCreateAgent} title={t('agent.sidebar.createAgent')} disabled={isRunning} />
                <Button size="small" icon={<PanelLeftClose size={14} />} onClick={() => setLibraryOpen(false)} title={t('agent.canvas.collapseLibrary')} />
              </Flexbox>
            </Flexbox>
            <div style={{ padding: '12px 12px 8px' }}>
              <Input
                value={agentSearch}
                onChange={(event) => setAgentSearch(event.target.value)}
                prefix={<Search size={14} color={token.colorTextQuaternary} />}
                placeholder={t('agent.sidebar.searchAgents')}
                style={{ height: 36, borderRadius: 10 }}
              />
            </div>
            <Flexbox gap={8} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 12px 12px' }}>
              {visibleAgents.map((agent) => {
                const selected = nodes.some((node) => node.agent.id === agent.id);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => addAgent(agent)}
                    disabled={isRunning}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      minHeight: 58,
                      padding: '9px 10px',
                      borderRadius: 14,
                      border: `1px solid ${selected ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
                      background: selected ? token.colorPrimaryBg : token.colorBgContainer,
                      color: token.colorText,
                      cursor: isRunning ? 'not-allowed' : 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <AgentIconTile agent={agent} size={34} selected={selected} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 750, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {agent.title || agent.name}
                      </span>
                      <span style={{ display: 'block', fontSize: 11, color: token.colorTextTertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {agent.description || t('agent.canvas.agentFallback')}
                      </span>
                    </span>
                    <Plus size={14} color={token.colorTextTertiary} />
                  </button>
                );
              })}
              {visibleAgents.length === 0 && <Empty description={t('agent.sidebar.noMatchingAgents')} image={Empty.PRESENTED_IMAGE_SIMPLE} />}
            </Flexbox>
            <div style={{ padding: 12, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
              <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 800, color: token.colorText }}>{t('agent.canvas.templates')}</div>
              <Flexbox gap={6}>
                {canvasTemplates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => applyCanvasTemplate(template)}
                    disabled={isRunning}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '9px 10px',
                      border: 0,
                      borderRadius: 12,
                      background: token.colorFillQuaternary,
                      color: token.colorText,
                      cursor: isRunning ? 'not-allowed' : 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 12, fontWeight: 800 }}>{template.title}</span>
                      <span style={{ display: 'block', fontSize: 11, color: token.colorTextTertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{template.description}</span>
                    </span>
                    <ChevronRight size={14} color={token.colorTextTertiary} />
                  </button>
                ))}
              </Flexbox>
            </div>
              </>
            ) : (
              <Flexbox align="center" gap={10} style={{ height: '100%', padding: '12px 0' }}>
                <Button size="small" icon={<PanelLeftOpen size={14} />} onClick={() => setLibraryOpen(true)} title={t('agent.canvas.expandLibrary')} />
                <span style={{ width: 26, height: 1, background: token.colorBorderSecondary }} />
                <Flexbox align="center" gap={8} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                  {visibleAgents.map((agent) => {
                    const selected = nodes.some((node) => node.agent.id === agent.id);
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => addAgent(agent)}
                        disabled={isRunning}
                        title={agent.title || agent.name}
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 12,
                          border: 0,
                          background: selected ? token.colorPrimaryBg : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: isRunning ? 'not-allowed' : 'pointer',
                        }}
                      >
                        <AgentIconTile agent={agent} size={28} selected={selected} subtle />
                      </button>
                    );
                  })}
                </Flexbox>
              </Flexbox>
            )}
          </aside>

          <section style={{ minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div
              style={{
                flexShrink: 0,
                padding: '14px 16px',
                borderRadius: '22px 22px 0 0',
                border: `1px solid ${token.colorBorderSecondary}`,
                borderBottom: 0,
                background: 'rgba(255,255,255,0.92)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <Flexbox gap={2}>
                <span style={{ fontSize: 14, fontWeight: 800, color: token.colorText }}>{t('agent.canvas.boardTitle')}</span>
                <span style={{ fontSize: 12, color: token.colorTextTertiary }}>{t('agent.canvas.boardHint')}</span>
              </Flexbox>
              <Button
                size="small"
                icon={<RotateCcw size={14} />}
                onClick={resetCanvas}
                title={t('agent.canvas.reset')}
                aria-label={t('agent.canvas.reset')}
                style={{ width: 32, height: 32, padding: 0 }}
              />
            </div>
            <div
              style={{
                flex: 1,
                minHeight: 220,
                overflow: 'auto',
                padding: 16,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderBottom: 0,
                background: 'rgba(255,255,255,0.68)',
              }}
            >
              {nodes.length === 0 ? (
                <Flexbox align="center" justify="center" gap={10} style={{ height: '100%', minHeight: 240, color: token.colorTextTertiary, textAlign: 'center' }}>
                  <MousePointer2 size={28} />
                  <span style={{ maxWidth: 360, fontSize: 15, fontWeight: 750, color: token.colorTextSecondary }}>{t('agent.canvas.emptyTitle')}</span>
                  <span style={{ maxWidth: 360, fontSize: 12 }}>{t('agent.canvas.empty')}</span>
                </Flexbox>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
                  {nodes.map((node, index) => {
                    const selected = selectedNodeId === node.id;
                    const statusStyle = node.status === 'completed'
                      ? { color: token.colorSuccessText, background: token.colorSuccessBg }
                      : node.status === 'running'
                        ? { color: token.colorPrimaryText, background: token.colorPrimaryBg }
                        : node.status === 'failed'
                          ? { color: token.colorErrorText, background: token.colorErrorBg }
                          : node.status === 'cancelled'
                            ? { color: token.colorWarningText, background: token.colorWarningBg }
                            : { color: token.colorTextSecondary, background: token.colorFillQuaternary };
                    return (
                      <div
                        key={node.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedNodeId(node.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedNodeId(node.id);
                          }
                        }}
                        style={{
                          minHeight: 140,
                          borderRadius: 18,
                          border: `1px solid ${selected ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
                          background: selected ? token.colorPrimaryBg : token.colorBgContainer,
                          padding: 14,
                          textAlign: 'left',
                          cursor: 'pointer',
                          boxShadow: selected ? '0 14px 34px rgba(15, 23, 42, 0.08)' : '0 10px 28px rgba(15, 23, 42, 0.05)',
                        }}
                      >
                        <Flexbox horizontal align="center" justify="space-between" gap={10}>
                          <Flexbox horizontal align="center" gap={10} style={{ minWidth: 0 }}>
                            <AgentIconTile agent={node.agent} size={38} selected={selected} />
                            <Flexbox style={{ minWidth: 0 }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: token.colorTextTertiary }}>
                                Agent {index + 1}
                              </span>
                              <span style={{ fontSize: 14, fontWeight: 800, color: token.colorText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {node.agent.title || node.agent.name}
                              </span>
                            </Flexbox>
                          </Flexbox>
                          <button
                            type="button"
                            title={t('agent.canvas.removeNode')}
                            disabled={isRunning}
                            onClick={(event) => {
                              event.stopPropagation();
                              removeNode(node.id);
                            }}
                            style={{
                              width: 26,
                              height: 26,
                              border: 0,
                              borderRadius: 9,
                              background: token.colorFillQuaternary,
                              color: token.colorTextSecondary,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: isRunning ? 'not-allowed' : 'pointer',
                              flexShrink: 0,
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </Flexbox>
                        <span style={{ ...statusStyle, display: 'inline-flex', marginTop: 12, borderRadius: 999, padding: '4px 8px', fontSize: 11, fontWeight: 750 }}>
                          {t(`agent.canvas.status.${node.status}`)}
                        </span>
                        <p style={{ margin: '10px 0 0', fontSize: 12, lineHeight: 1.5, color: token.colorTextSecondary }}>
                          {node.agent.description || t('agent.canvas.agentFallback')}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div
              style={{
                flexShrink: 0,
                padding: 16,
                borderRadius: '0 0 22px 22px',
                border: `1px solid ${token.colorBorderSecondary}`,
                background: 'rgba(255,255,255,0.92)',
              }}
            >
              <Flexbox horizontal align="center" justify="space-between" gap={12} style={{ marginBottom: 10 }}>
                <Flexbox gap={2}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: token.colorText }}>{t('agent.canvas.promptTitle')}</span>
                  <span style={{ fontSize: 12, color: token.colorTextTertiary }}>{t('agent.canvas.promptHint')}</span>
                </Flexbox>
                <Button size="small" icon={<Sparkles size={14} />} onClick={fillExamplePrompt} disabled={isRunning}>
                  {t('agent.canvas.fillExample')}
                </Button>
              </Flexbox>
              <Input.TextArea
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  setRunState(event.target.value.trim() && nodes.length > 0 ? 'matched' : 'idle');
                }}
                placeholder={t('agent.canvas.promptPlaceholder')}
                disabled={isRunning}
                autoSize={{ minRows: 4, maxRows: 7 }}
                style={{ borderRadius: 16, padding: 12, boxShadow: 'none' }}
              />
            </div>
          </section>

          <aside style={{ minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <section style={{ padding: 14, borderRadius: 20, border: `1px solid ${token.colorBorderSecondary}`, background: 'rgba(255,255,255,0.92)', boxShadow: '0 18px 48px rgba(15, 23, 42, 0.06)' }}>
              <Flexbox horizontal align="center" gap={8} style={{ marginBottom: 12 }}>
                <Layers3 size={16} color={token.colorPrimary} />
                <span style={{ fontSize: 14, fontWeight: 800, color: token.colorText }}>{t('agent.canvas.engineTitle')}</span>
              </Flexbox>
              <Flexbox gap={8}>
                <InfoRow icon={<Layers3 size={14} />} label={t('agent.canvas.matchedEngine')} value={engineLabel} />
                <InfoRow icon={<Bot size={14} />} label={t('agent.canvas.nodeCount')} value={String(nodes.length)} />
                <InfoRow icon={<CircleStop size={14} />} label={t('agent.canvas.runState')} value={t(`agent.canvas.status.${runState}`)} />
              </Flexbox>
              <Flexbox horizontal gap={8} style={{ marginTop: 12 }}>
                {runState === 'running' && (
                  <Button size="small" icon={<CircleStop size={14} />} onClick={stopCanvas}>
                    {t('agent.canvas.stop')}
                  </Button>
                )}
                <Button size="small" type="primary" icon={<Play size={14} />} disabled={!canRun || runState === 'running'} onClick={runCanvas} style={{ flex: 1 }}>
                  {t('agent.canvas.run')}
                </Button>
              </Flexbox>
            </section>

            <section style={{ padding: 14, borderRadius: 20, border: `1px solid ${token.colorBorderSecondary}`, background: 'rgba(255,255,255,0.92)' }}>
              <Flexbox horizontal align="center" gap={8} style={{ marginBottom: 12 }}>
                <Activity size={16} color={token.colorPrimary} />
                <span style={{ fontSize: 14, fontWeight: 800, color: token.colorText }}>{t('agent.canvas.progressTitle')}</span>
              </Flexbox>
              <Flexbox gap={8}>
                {nodes.length === 0 ? (
                  <span style={{ fontSize: 12, color: token.colorTextTertiary }}>{t('agent.canvas.progressEmpty')}</span>
                ) : nodes.map((node) => (
                  <InfoRow key={node.id} icon={<CheckCircle2 size={14} />} label={node.agent.title || node.agent.name} value={t(`agent.canvas.status.${node.status}`)} />
                ))}
              </Flexbox>
            </section>

            <section style={{ padding: 14, borderRadius: 20, border: `1px solid ${token.colorBorderSecondary}`, background: 'rgba(255,255,255,0.92)' }}>
              <Flexbox horizontal align="center" gap={8} style={{ marginBottom: 12 }}>
                <Bot size={16} color={token.colorPrimary} />
                <span style={{ fontSize: 14, fontWeight: 800, color: token.colorText }}>{selectedNode ? t('agent.canvas.nodeSettings') : t('agent.canvas.agentDetails')}</span>
              </Flexbox>
              <Flexbox gap={8}>
                <InfoRow icon={<MousePointer2 size={14} />} label={t('agent.canvas.selectedNode')} value={selectedNode?.agent.title || selectedNode?.agent.name || t('agent.canvas.none')} />
                <InfoRow icon={<Layers3 size={14} />} label={t('agent.canvas.taskId')} value={taskId || t('agent.canvas.none')} />
                <InfoRow icon={<Layers3 size={14} />} label={t('agent.canvas.nodeId')} value={selectedNode?.id || t('agent.canvas.none')} />
                <InfoRow icon={<Bot size={14} />} label={t('agent.canvas.turnId')} value={selectedNode?.turnId || t('agent.canvas.none')} />
                {selectedNode?.resultSummary && (
                  <div style={{ padding: 10, borderRadius: 12, border: `1px solid ${token.colorBorderSecondary}`, background: token.colorFillQuaternary }}>
                    <div style={{ marginBottom: 4, fontSize: 12, fontWeight: 700, color: token.colorText }}>{t('agent.canvas.resultSummary')}</div>
                    <div style={{ fontSize: 12, lineHeight: 1.5, color: token.colorTextSecondary }}>{formatCanvasResultSummary(selectedNode.resultSummary, t)}</div>
                  </div>
                )}
                {selectedNode && (
                  <Button
                    size="small"
                    icon={<Trash2 size={14} />}
                    onClick={() => removeNode(selectedNode.id)}
                    disabled={isRunning}
                    title={t('agent.canvas.removeNode')}
                    aria-label={t('agent.canvas.removeNode')}
                    style={{ width: 32, height: 32, padding: 0 }}
                  />
                )}
              </Flexbox>
            </section>

            <section style={{ padding: 14, borderRadius: 20, border: `1px solid ${token.colorBorderSecondary}`, background: 'rgba(255,255,255,0.92)' }}>
              <Flexbox horizontal align="center" justify="space-between" style={{ marginBottom: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: token.colorText }}>{t('agent.canvas.resultTitle')}</span>
                <Tag style={{ margin: 0 }}>{t(`agent.canvas.status.${runState}`)}</Tag>
              </Flexbox>
              {hasResult ? (
                <Flexbox gap={10}>
                  {resultCards.map((card) => (
                    <ResultCard key={card.title} title={card.title} tone={card.tone} lines={card.lines} />
                  ))}
                </Flexbox>
              ) : (
                <Flexbox horizontal align="center" gap={10} style={{ padding: 14, borderRadius: 16, border: `1px dashed ${token.colorBorder}`, background: token.colorFillQuaternary, color: token.colorTextSecondary }}>
                  <Activity size={18} />
                  <span style={{ fontSize: 12, lineHeight: 1.5 }}>{t('agent.canvas.resultIdle')}</span>
                </Flexbox>
              )}
              {runState === 'failed' && runError && (
                <div style={{ marginTop: 10, fontSize: 12, color: token.colorErrorText }}>{runError}</div>
              )}
            </section>
          </aside>
        </section>
      </main>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  const { token } = theme.useToken();
  return (
    <Flexbox horizontal align="center" gap={8} style={{ padding: 10, borderRadius: 10, border: `1px solid ${token.colorBorderSecondary}` }}>
      <span style={{ color: token.colorTextTertiary, display: 'flex' }}>{icon}</span>
      <span style={{ flex: 1, fontSize: 12, color: token.colorTextSecondary }}>{label}</span>
      <span style={{ maxWidth: 150, fontSize: 12, fontWeight: 650, color: token.colorText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </Flexbox>
  );
}

function ResultCard({
  title,
  tone,
  lines,
}: {
  title: string;
  tone: 'purple' | 'blue' | 'green' | 'orange' | 'red';
  lines: string[];
}) {
  const { token } = theme.useToken();
  const toneColor = {
    purple: token.colorPrimary,
    blue: token.colorInfo,
    green: token.colorSuccess,
    orange: token.colorWarning,
    red: token.colorError,
  }[tone];

  return (
    <div
      style={{
        minHeight: 150,
        padding: 14,
        borderRadius: 18,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        boxShadow: '0 12px 36px rgba(15, 23, 42, 0.05)',
      }}
    >
      <Flexbox horizontal align="center" gap={8} style={{ marginBottom: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: toneColor }} />
        <span style={{ fontSize: 13, fontWeight: 750, color: token.colorText }}>{title}</span>
      </Flexbox>
      <Flexbox gap={7}>
        {lines.map((line, index) => (
          <div key={`${title}-${index}`} style={{ fontSize: 12, lineHeight: 1.55, color: token.colorTextSecondary }}>
            {line}
          </div>
        ))}
      </Flexbox>
    </div>
  );
}
