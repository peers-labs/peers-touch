import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Avatar, Button, Tag } from '@lobehub/ui';
import { Empty, Input, theme } from 'antd';
import {
  Activity,
  ArrowLeft,
  Bot,
  CheckCircle2,
  CircleStop,
  Layers3,
  MousePointer2,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { CollaborationEngineType, CollaborationTaskStatus, TaskNodeStatus } from '../gen/proto/domain/agent/orchestration_pb';
import { api, streamAgentCollaborationEvents } from '../services/desktop_api';
import type { Agent } from '../services/desktop_api';
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

function nodeStatusToRunState(status: TaskNodeStatus): CanvasRunState {
  if (status === TaskNodeStatus.RUNNING) return 'running';
  if (status === TaskNodeStatus.COMPLETED) return 'completed';
  if (status === TaskNodeStatus.FAILED) return 'failed';
  if (status === TaskNodeStatus.SKIPPED) return 'cancelled';
  return 'matched';
}

function taskStatusToRunState(status?: CollaborationTaskStatus): CanvasRunState {
  if (status === CollaborationTaskStatus.FAILED) return 'failed';
  if (status === CollaborationTaskStatus.COMPLETED) return 'completed';
  if (status === CollaborationTaskStatus.CANCELLED) return 'cancelled';
  return 'running';
}

export function AgentCanvasPage({ onBack }: AgentCanvasPageProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const { agents, loadAgents } = useAgentStore();
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [prompt, setPrompt] = useState('');
  const [runState, setRunState] = useState<CanvasRunState>('idle');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [runError, setRunError] = useState('');
  const streamControllersRef = useRef<AbortController[]>([]);
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
  const completedNodes = nodes.filter((node) => node.status === 'completed');
  const failedNodes = nodes.filter((node) => node.status === 'failed');
  const hasResult = runState === 'completed' || runState === 'failed' || runState === 'cancelled' || nodes.some((node) => node.resultSummary);
  const resultCards = useMemo(() => {
    const contributionLines = nodes.length
      ? nodes.map((node) => `${node.agent.title || node.agent.name}: ${node.resultSummary || t(`agent.canvas.status.${node.status}`)}`)
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
        title: t('agent.canvas.resultGoalKeeper'),
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
          ? failedNodes.map((node) => `${node.agent.title || node.agent.name}: ${node.resultSummary || t('agent.canvas.failed')}`)
          : [
            t('agent.canvas.resultRiskCancel'),
            t('agent.canvas.resultRiskE2e'),
            t('agent.canvas.resultNextStep'),
          ],
      },
    ];
  }, [completedNodes.length, engineLabel, failedNodes, nodes, prompt, runState, t, taskId]);

  const fillExamplePrompt = useCallback(() => {
    setPrompt(t('agent.canvas.examplePrompt'));
    setRunState(nodes.length ? 'matched' : 'idle');
  }, [nodes.length, t]);

  const addAgent = useCallback((agent: Agent) => {
    setNodes((current) => {
      if (current.some((node) => node.agent.id === agent.id)) return current;
      return [...current, { id: `${agent.id}:${Date.now()}`, agent, status: 'idle' }];
    });
    setRunState('idle');
  }, []);

  const removeNode = useCallback((nodeId: string) => {
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setSelectedNodeId((current) => (current === nodeId ? '' : current));
    setRunState('idle');
  }, []);

  const runCanvas = useCallback(() => {
    if (!canRun) return;
    const runSeq = runSeqRef.current + 1;
    runSeqRef.current = runSeq;
    const agentById = new Map(nodes.map((node) => [node.agent.id, node.agent]));
    streamControllersRef.current.forEach((controller) => controller.abort());
    streamControllersRef.current = nodes.map((node) => streamAgentCollaborationEvents(
      node.agent.id,
      (event) => {
        if (runSeqRef.current !== runSeq) return;
        if (!event.event.startsWith('agent.collaboration.')) return;
        const payload = (event.data?.payload || {}) as Record<string, any>;
        const metadata = (event.data?.metadata || {}) as Record<string, any>;
        const eventTaskId = String(payload.task_id || metadata.task_id || '');
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
    ));
    setRunState('running');
    setNodes((current) => current.map((node) => ({ ...node, status: 'running' })));
    setRunError('');
    void api.createAgentCollaborationTask({
      title: prompt.trim().slice(0, 80) || t('agent.canvas.title'),
      description: prompt.trim(),
      engine_type: inferEngineType(prompt),
      agent_ids: nodes.map((node) => node.agent.id),
    }).then(async (created) => {
      const createdTaskId = created.task?.taskId;
      if (!createdTaskId) throw new Error(t('agent.canvas.errorNoTask'));
      if (runSeqRef.current !== runSeq) return;
      setTaskId(createdTaskId);
      const detail = await api.getAgentCollaborationTask(createdTaskId);
      if (runSeqRef.current !== runSeq) return;
      const taskStatus = detail.task?.status;
      setRunState(taskStatusToRunState(taskStatus));
      setNodes((current) => {
        const byNodeAgent = new Map(detail.nodes.map((node) => [node.agentId, node]));
        return current.map((node) => {
          const persisted = byNodeAgent.get(node.agent.id);
          return {
            ...node,
            id: persisted?.nodeId || node.id,
            agent: agentById.get(node.agent.id) || node.agent,
            status: persisted ? nodeStatusToRunState(persisted.status) : node.status,
            turnId: node.turnId,
            resultSummary: persisted?.resultSummary,
          };
        });
      });
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

  return (
    <Flexbox horizontal height="100%" style={{ minWidth: 0, overflow: 'hidden', background: token.colorBgLayout }}>
      <aside
        style={{
          width: 286,
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Flexbox horizontal align="center" gap={8} style={{ padding: 14, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <Button size="small" icon={<ArrowLeft size={14} />} onClick={onBack}>
            {t('agent.canvas.back')}
          </Button>
          <span style={{ fontSize: 14, fontWeight: 700, color: token.colorText }}>
            {t('agent.canvas.library')}
          </span>
        </Flexbox>
        <Flexbox gap={8} style={{ padding: 12, overflow: 'auto' }}>
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => addAgent(agent)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: 10,
                borderRadius: 12,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
                color: token.colorText,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <Avatar avatar={agent.avatar || '🤖'} shape="square" size={30} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {agent.title || agent.name}
                </span>
                <span style={{ display: 'block', fontSize: 11, color: token.colorTextTertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {agent.description || t('agent.canvas.agentFallback')}
                </span>
              </span>
              <Plus size={14} color={token.colorTextTertiary} />
            </button>
          ))}
        </Flexbox>
      </aside>

      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Flexbox horizontal align="center" justify="space-between" style={{ padding: '14px 18px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <Flexbox gap={2}>
            <span style={{ fontSize: 18, fontWeight: 800, color: token.colorText }}>
              {t('agent.canvas.title')}
            </span>
            <span style={{ fontSize: 12, color: token.colorTextSecondary }}>
              {t('agent.canvas.subtitle')}
            </span>
          </Flexbox>
          <Flexbox horizontal align="center" gap={8}>
            <Tag>{engineLabel}</Tag>
            {runState === 'running' && (
              <Button size="small" icon={<CircleStop size={14} />} onClick={stopCanvas}>
                {t('agent.canvas.stop')}
              </Button>
            )}
            <Button size="small" icon={<RotateCcw size={14} />} onClick={resetCanvas}>
              {t('agent.canvas.reset')}
            </Button>
            <Button size="small" type="primary" icon={<Play size={14} />} disabled={!canRun || runState === 'running'} onClick={runCanvas}>
              {t('agent.canvas.run')}
            </Button>
          </Flexbox>
        </Flexbox>

        <Flexbox horizontal flex={1} style={{ minHeight: 0 }}>
          <section style={{ flex: 1, minWidth: 0, padding: 18, overflow: 'auto' }}>
            <Flexbox
              gap={12}
              style={{
                marginBottom: 16,
                padding: 14,
                borderRadius: 20,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
                boxShadow: '0 18px 54px rgba(15, 23, 42, 0.06)',
              }}
            >
              <Flexbox horizontal align="center" justify="space-between" gap={12}>
                <Flexbox gap={2}>
                  <span style={{ fontSize: 14, fontWeight: 750, color: token.colorText }}>
                    {t('agent.canvas.promptTitle')}
                  </span>
                  <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
                    {t('agent.canvas.promptHint')}
                  </span>
                </Flexbox>
                <Button size="small" icon={<Sparkles size={14} />} onClick={fillExamplePrompt}>
                  {t('agent.canvas.fillExample')}
                </Button>
              </Flexbox>
              <Input.TextArea
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  setRunState(event.target.value.trim() ? 'matched' : 'idle');
                }}
                placeholder={t('agent.canvas.promptPlaceholder')}
                autoSize={{ minRows: 3, maxRows: 6 }}
                style={{
                  borderRadius: 16,
                  padding: 12,
                  boxShadow: 'none',
                }}
              />
            </Flexbox>
            {nodes.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('agent.canvas.empty')} />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
                {nodes.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => setSelectedNodeId(node.id)}
                    style={{
                      minHeight: 132,
                      borderRadius: 18,
                      border: `1px solid ${selectedNodeId === node.id ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
                      background: selectedNodeId === node.id ? token.colorPrimaryBg : token.colorBgContainer,
                      padding: 14,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <Flexbox horizontal align="center" gap={10}>
                      <Avatar avatar={node.agent.avatar || '🤖'} shape="square" size={38} />
                      <Flexbox style={{ minWidth: 0 }}>
                        <span style={{ fontSize: 14, fontWeight: 750, color: token.colorText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {node.agent.title || node.agent.name}
                        </span>
                        <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
                          {t(`agent.canvas.status.${node.status}`)}
                        </span>
                      </Flexbox>
                    </Flexbox>
                    <p style={{ margin: '12px 0 0', fontSize: 12, lineHeight: 1.5, color: token.colorTextSecondary }}>
                      {node.agent.description || t('agent.canvas.agentFallback')}
                    </p>
                  </button>
                ))}
              </div>
            )}
            <section style={{ marginTop: 18 }}>
              <Flexbox horizontal align="center" justify="space-between" style={{ marginBottom: 10 }}>
                <Flexbox gap={2}>
                  <span style={{ fontSize: 14, fontWeight: 750, color: token.colorText }}>
                    {t('agent.canvas.resultTitle')}
                  </span>
                  <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
                    {t('agent.canvas.resultHint')}
                  </span>
                </Flexbox>
                <Tag>{t(`agent.canvas.status.${runState}`)}</Tag>
              </Flexbox>
              {hasResult ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                  {resultCards.map((card) => (
                    <ResultCard key={card.title} title={card.title} tone={card.tone} lines={card.lines} />
                  ))}
                </div>
              ) : (
                <Flexbox horizontal align="center" gap={10} style={{ padding: 18, borderRadius: 18, border: `1px dashed ${token.colorBorder}`, background: token.colorFillQuaternary, color: token.colorTextSecondary }}>
                  <Activity size={18} />
                  <span style={{ fontSize: 13 }}>{t('agent.canvas.resultIdle')}</span>
                </Flexbox>
              )}
            </section>
          </section>

          <aside style={{ width: 320, borderLeft: `1px solid ${token.colorBorderSecondary}`, background: token.colorBgContainer, padding: 14 }}>
            <Flexbox gap={12}>
              <Flexbox horizontal align="center" gap={8}>
                <Layers3 size={16} color={token.colorPrimary} />
                <span style={{ fontSize: 14, fontWeight: 700, color: token.colorText }}>
                  {t('agent.canvas.inspector')}
                </span>
              </Flexbox>
              <Flexbox gap={8}>
                <InfoRow icon={<Bot size={14} />} label={t('agent.canvas.nodeCount')} value={String(nodes.length)} />
                <InfoRow icon={<MousePointer2 size={14} />} label={t('agent.canvas.selectedNode')} value={selectedNode?.agent.title || selectedNode?.agent.name || t('agent.canvas.none')} />
                <InfoRow icon={<CircleStop size={14} />} label={t('agent.canvas.runState')} value={t(`agent.canvas.status.${runState}`)} />
                <InfoRow icon={<Layers3 size={14} />} label={t('agent.canvas.taskId')} value={taskId || t('agent.canvas.none')} />
                <InfoRow icon={<Layers3 size={14} />} label={t('agent.canvas.nodeId')} value={selectedNode?.id || t('agent.canvas.none')} />
                <InfoRow icon={<Bot size={14} />} label={t('agent.canvas.turnId')} value={selectedNode?.turnId || t('agent.canvas.none')} />
              </Flexbox>
              {selectedNode && (
                <Flexbox gap={8}>
                  {selectedNode.resultSummary && (
                    <div style={{ padding: 10, borderRadius: 12, border: `1px solid ${token.colorBorderSecondary}`, background: token.colorFillQuaternary }}>
                      <div style={{ marginBottom: 4, fontSize: 12, fontWeight: 700, color: token.colorText }}>
                        {t('agent.canvas.resultSummary')}
                      </div>
                      <div style={{ fontSize: 12, lineHeight: 1.5, color: token.colorTextSecondary }}>
                        {selectedNode.resultSummary}
                      </div>
                    </div>
                  )}
                  <Button size="small" icon={<Trash2 size={14} />} onClick={() => removeNode(selectedNode.id)}>
                    {t('agent.canvas.removeNode')}
                  </Button>
                </Flexbox>
              )}
              {runState === 'completed' && (
                <Flexbox horizontal align="center" gap={8} style={{ padding: 10, borderRadius: 12, background: token.colorSuccessBg }}>
                  <CheckCircle2 size={15} color={token.colorSuccess} />
                  <span style={{ fontSize: 12, color: token.colorSuccessText }}>{t('agent.canvas.completed')}</span>
                </Flexbox>
              )}
              {runState === 'failed' && (
                <Flexbox gap={4} style={{ padding: 10, borderRadius: 12, background: token.colorErrorBg }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: token.colorErrorText }}>{t('agent.canvas.failed')}</span>
                  {runError && <span style={{ fontSize: 11, color: token.colorErrorText }}>{runError}</span>}
                </Flexbox>
              )}
              {runState === 'cancelled' && (
                <Flexbox horizontal align="center" gap={8} style={{ padding: 10, borderRadius: 12, background: token.colorWarningBg }}>
                  <CircleStop size={15} color={token.colorWarning} />
                  <span style={{ fontSize: 12, color: token.colorWarningText }}>{t('agent.canvas.cancelled')}</span>
                </Flexbox>
              )}
            </Flexbox>
          </aside>
        </Flexbox>
      </main>
    </Flexbox>
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
