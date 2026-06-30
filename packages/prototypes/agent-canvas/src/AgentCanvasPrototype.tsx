import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bot,
  Boxes,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleStop,
  Clock3,
  FileText,
  History,
  Layers3,
  MessageSquareText,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Zap,
  type LucideIcon,
} from 'lucide-react';

type Engine = 'parallel_analysis' | 'review_gate' | 'relay_chain' | 'debate_judge' | 'synthesis' | 'design_to_implementation';
type RunState = 'idle' | 'matched' | 'running' | 'completed' | 'failed';
type AgentStatus = 'idle' | 'queued' | 'running' | 'done' | 'failed';

interface Agent {
  id: string;
  name: string;
  desc: string;
  tags: string[];
  color: string;
  icon: LucideIcon;
}

interface CanvasNode extends Agent {
  nodeId: string;
  localPrompt?: string;
  status: AgentStatus;
}

interface EngineMatch {
  engine: Engine;
  label: string;
  confidence: number;
  reasons: string[];
}

const T = {
  bg: '#f7f7f8',
  panel: 'rgba(255,255,255,0.92)',
  panelStrong: '#ffffff',
  line: '#ececf0',
  lineStrong: '#d8d8e0',
  text: '#1f1b33',
  secondary: '#6a6381',
  tertiary: '#9a92ad',
  purple: '#7156f6',
  purpleDark: '#4d38be',
  purpleSoft: '#f3f3f5',
  green: '#19b27b',
  greenSoft: '#e8fff5',
  orange: '#f59e0b',
  orangeSoft: '#fff6df',
  red: '#e5484d',
  redSoft: '#fff0f0',
  blue: '#2b7fff',
  blueSoft: '#eaf2ff',
};

const AGENTS: Agent[] = [
  {
    id: 'architect',
    name: '架构 Agent',
    desc: '拆系统边界、接口、运行时和落地路径。',
    tags: ['design', 'architecture', 'plan'],
    color: '#7156f6',
    icon: BrainCircuit,
  },
  {
    id: 'risk',
    name: '风险 Agent',
    desc: '发现跑偏、复杂化、不可逆动作和隐藏成本。',
    tags: ['review', 'risk', 'validate'],
    color: '#f59e0b',
    icon: AlertTriangle,
  },
  {
    id: 'coder',
    name: '实现 Agent',
    desc: '把设计拆成可执行改动，生成代码和接口。',
    tags: ['implement', 'code', 'build'],
    color: '#2b7fff',
    icon: Zap,
  },
  {
    id: 'verifier',
    name: '验证 Agent',
    desc: '检查目标覆盖、测试结果和阶段退出条件。',
    tags: ['test', 'verify', 'review'],
    color: '#19b27b',
    icon: Check,
  },
  {
    id: 'research',
    name: '研究 Agent',
    desc: '检索资料、归纳外部方案和事实依据。',
    tags: ['research', 'source', 'summary'],
    color: '#8b5cf6',
    icon: Search,
  },
  {
    id: 'writer',
    name: '总结 Agent',
    desc: '把多个 Agent 的输出收束成结论和下一步。',
    tags: ['synthesis', 'summary', 'report'],
    color: '#14b8a6',
    icon: FileText,
  },
];

const TEMPLATES = [
  {
    id: 'architecture-review',
    name: '架构评审',
    desc: '架构 + 风险 + 验证一起看方案是否能落地',
    agents: ['architect', 'risk', 'verifier'],
    prompt: '请一起评审这个 Agent Canvas 编排方案，重点看是否能落地、是否跑偏、下一步怎么实现。',
  },
  {
    id: 'delivery',
    name: '设计到实现',
    desc: '从目标契约到设计、实现、验证的自治交付',
    agents: ['architect', 'coder', 'verifier', 'writer'],
    prompt: '请完成这个需求的设计、实现和验收，过程中不要让我反复说继续，只有高风险或需求冲突才问我。',
  },
  {
    id: 'research-summary',
    name: '研究汇总',
    desc: '研究 + 风险 + 总结形成报告',
    agents: ['research', 'risk', 'writer'],
    prompt: '请围绕这个主题做资料梳理、风险判断和最终摘要，输出关键结论和下一步建议。',
  },
];

const RUN_STEPS = [
  'GoalKeeper 固化目标契约',
  'EngineMatcher 匹配工作引擎',
  'RunPlanBuilder 生成执行计划',
  'AgentRuns 执行协作步骤',
  'Verifier 检查阶段质量',
  'Reducer 汇总最终结果',
];

function matchEngine(nodes: CanvasNode[], prompt: string): EngineMatch {
  const text = prompt.toLowerCase();
  const tags = nodes.flatMap((node) => node.tags).join(' ');

  if (/实现|落地|代码|build|implement|修复|完成/.test(text)) {
    return {
      engine: 'design_to_implementation',
      label: '设计到实现',
      confidence: 0.91,
      reasons: ['Prompt 包含实现/落地意图', '画板包含可承担设计、实现或验证的 Agent', '需要自治推进而不是单轮讨论'],
    };
  }

  if (/评审|检查|风险|验收|review|validate/.test(text) || tags.includes('review')) {
    return {
      engine: 'review_gate',
      label: '评审协作',
      confidence: 0.86,
      reasons: ['Prompt 包含评审/风险意图', '画板里存在验证或风险能力', '适合产出后再挑战/验收'],
    };
  }

  if (/比较|取舍|争论|哪个更好|debate/.test(text)) {
    return {
      engine: 'debate_judge',
      label: '辩论裁决',
      confidence: 0.82,
      reasons: ['Prompt 包含比较/取舍意图', '需要保留分歧并做裁决'],
    };
  }

  if (/接力|先.*再|然后|chain/.test(text)) {
    return {
      engine: 'relay_chain',
      label: '接力执行',
      confidence: 0.78,
      reasons: ['Prompt 暗示顺序执行', '适合前一 Agent 输出交给后一 Agent'],
    };
  }

  if (/总结|汇总|归纳|报告|synthesis|summary/.test(text) || tags.includes('summary')) {
    return {
      engine: 'synthesis',
      label: '综合归纳',
      confidence: 0.8,
      reasons: ['Prompt 包含总结/报告意图', '适合多来源材料聚合'],
    };
  }

  return {
    engine: 'parallel_analysis',
    label: '并行分析',
    confidence: nodes.length > 1 ? 0.76 : 0.62,
    reasons: ['多个 Agent 被放入画板', '未检测到强顺序/评审/实现意图', '默认并行分析后汇总'],
  };
}

function AgentCanvasPrototype({ onBack, embedded = false }: { onBack?: () => void; embedded?: boolean }) {
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [prompt, setPrompt] = useState('');
  const [runState, setRunState] = useState<RunState>('idle');
  const [activeStep, setActiveStep] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(AGENTS[0]?.id ?? null);
  const [libraryOpen, setLibraryOpen] = useState(true);

  const engineMatch = useMemo(() => {
    if (!nodes.length || !prompt.trim()) return null;
    return matchEngine(nodes, prompt);
  }, [nodes, prompt]);

  const selectedNode = nodes.find((node) => node.nodeId === selectedNodeId) ?? null;
  const activeAgent = AGENTS.find((agent) => agent.id === activeAgentId) ?? null;

  function addAgent(agent: Agent) {
    if (nodes.some((node) => node.id === agent.id)) return;
    setNodes((current) => [
      ...current,
      {
        ...agent,
        nodeId: `${agent.id}-${Date.now()}`,
        status: 'idle',
      },
    ]);
    setRunState('idle');
  }

  function removeNode(nodeId: string) {
    setNodes((current) => current.filter((node) => node.nodeId !== nodeId));
    setSelectedNodeId((current) => (current === nodeId ? null : current));
    setRunState('idle');
  }

  function applyTemplate(templateId: string) {
    const template = TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;
    const nextNodes = template.agents
      .map((agentId) => AGENTS.find((agent) => agent.id === agentId))
      .filter(Boolean)
      .map((agent, index) => ({
        ...(agent as Agent),
        nodeId: `${agent!.id}-template-${index}`,
        status: 'idle' as AgentStatus,
      }));
    setNodes(nextNodes);
    setPrompt(template.prompt);
    setRunState('matched');
    setActiveStep(0);
    setSelectedNodeId(null);
  }

  function resetCanvas() {
    setNodes([]);
    setPrompt('');
    setRunState('idle');
    setActiveStep(0);
    setSelectedNodeId(null);
  }

  function runCanvas() {
    if (!engineMatch) return;
    setRunState('running');
    setActiveStep(0);
    setNodes((current) => current.map((node) => ({ ...node, status: 'queued' })));

    window.setTimeout(() => {
      setActiveStep(1);
      setNodes((current) => current.map((node, index) => ({ ...node, status: index < 2 ? 'running' : 'queued' })));
    }, 350);
    window.setTimeout(() => {
      setActiveStep(2);
      setNodes((current) => current.map((node, index) => ({ ...node, status: index === 0 ? 'done' : 'running' })));
    }, 900);
    window.setTimeout(() => {
      setActiveStep(3);
      setNodes((current) => current.map((node) => ({ ...node, status: 'running' })));
    }, 1450);
    window.setTimeout(() => {
      setActiveStep(4);
      setNodes((current) => current.map((node, index) => ({ ...node, status: index === current.length - 1 ? 'running' : 'done' })));
    }, 2100);
    window.setTimeout(() => {
      setActiveStep(5);
      setNodes((current) => current.map((node) => ({ ...node, status: 'done' })));
    }, 2750);
    window.setTimeout(() => {
      setRunState('completed');
    }, 3400);
  }

  return (
    <div style={{ ...styles.root, width: embedded ? '100%' : '100vw', height: embedded ? '100%' : '100vh' }}>
      {!embedded && (
        <aside style={styles.rail}>
          <div style={styles.logo}>P</div>
          <RailButton icon={Search} active={false} />
          <RailButton icon={MessageSquareText} active={false} />
          <RailButton icon={Bot} active />
          <RailButton icon={Boxes} active={false} />
          <div style={{ flex: 1 }} />
          <RailButton icon={History} active={false} />
          <RailButton icon={Settings} active={false} />
        </aside>
      )}

      <main style={styles.page}>
        <header style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            {onBack && (
              <button style={styles.backButton} onClick={onBack} title="返回" aria-label="返回">
                <ArrowLeft size={16} />
              </button>
            )}
            <div>
              <div style={styles.eyebrow}>Agent / Orchestration</div>
              <h1 style={styles.title}>Agent Canvas</h1>
              <p style={styles.subtitle}>从 Agent 页进入：选已有 Agent，输入目标，系统自动匹配工作引擎。</p>
            </div>
          </div>
          <div style={styles.headerActions}>
            <Pill tone="purple">当前：Canvas 编排</Pill>
            <Pill tone="green">GoalKeeper 已启用</Pill>
          </div>
        </header>

        <section style={{ ...styles.workspace, gridTemplateColumns: `${libraryOpen ? '250px' : '56px'} minmax(520px, 1fr) 320px` }}>
          <aside style={{ ...styles.leftPanel, padding: libraryOpen ? 14 : '12px 0', alignItems: libraryOpen ? 'stretch' : 'center' }}>
            {libraryOpen ? (
              <>
                <div style={styles.panelHeader}>
                  <div>
                    <div style={styles.panelTitle}>已有 Agent</div>
                    <div style={styles.panelHint}>点击看详情，详情卡片里加入画板</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={styles.iconButton} title="新建 Agent">
                      <Plus size={16} />
                    </button>
                    <button style={styles.iconButton} title="折叠 Agent Library" onClick={() => setLibraryOpen(false)}>
                      <PanelLeftClose size={16} />
                    </button>
                  </div>
                </div>

                <div style={styles.searchBox}>
                  <Search size={15} />
                  搜索 Agent / 能力
                </div>

                <div style={styles.agentList}>
                  {AGENTS.map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      selected={nodes.some((node) => node.id === agent.id)}
                      active={activeAgentId === agent.id}
                      onInspect={() => {
                        setActiveAgentId(agent.id);
                        setSelectedNodeId(null);
                      }}
                    />
                  ))}
                </div>

                <div style={styles.templateBox}>
                  <div style={styles.panelTitle}>快速模板</div>
                  {TEMPLATES.map((template) => (
                    <button key={template.id} style={styles.templateButton} onClick={() => applyTemplate(template.id)}>
                      <span>
                        <b>{template.name}</b>
                        <small>{template.desc}</small>
                      </span>
                      <ChevronRight size={15} />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <button style={styles.iconButton} title="展开 Agent Library" onClick={() => setLibraryOpen(true)}>
                  <PanelLeftOpen size={16} />
                </button>
                <div style={{ width: 28, height: 1, background: T.line }} />
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {AGENTS.map((agent) => {
                    const Icon = agent.icon;
                    const selected = nodes.some((node) => node.id === agent.id);
                    const active = activeAgentId === agent.id;
                    return (
                      <button
                        key={agent.id}
                        title={agent.name}
                        onClick={() => {
                          setActiveAgentId(agent.id);
                          setSelectedNodeId(null);
                        }}
                        style={{
                          ...styles.collapsedAgentButton,
                          borderColor: 'transparent',
                          background: active ? T.purpleSoft : selected ? T.greenSoft : 'transparent',
                          color: active ? T.purple : T.secondary,
                        }}
                      >
                        <Icon size={17} />
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </aside>

          <section style={styles.canvasColumn}>
            <div style={styles.canvasHeader}>
              <div>
                <div style={styles.panelTitle}>协作画板</div>
                <div style={styles.panelHint}>Canvas 是入口，真正的编排由 GoalKeeper + RunPlan 在后台完成。</div>
              </div>
              <button style={styles.iconButton} onClick={resetCanvas} title="清空" aria-label="清空">
                <RotateCcw size={15} />
              </button>
            </div>

            <div style={styles.canvas}>
              {nodes.length === 0 ? (
                <div style={styles.emptyCanvas}>
                  <MousePointer2 size={28} />
                  <h2>拖入几个 Agent，输入一个目标，让它们协作。</h2>
                  <p>不需要配置流程，不需要选择角色。系统会自动匹配工作引擎。</p>
                </div>
              ) : (
                <div style={styles.nodeGrid}>
                  {nodes.map((node, index) => (
                    <CanvasNodeCard
                      key={node.nodeId}
                      node={node}
                      index={index}
                      selected={selectedNodeId === node.nodeId}
                      onSelect={() => setSelectedNodeId(node.nodeId)}
                      onRemove={() => removeNode(node.nodeId)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div style={styles.promptPanel}>
              <div style={styles.promptHeader}>
                <div>
                  <div style={styles.panelTitle}>协作 Prompt</div>
                  <div style={styles.panelHint}>描述这次让这些 Agent 一起完成什么。</div>
                </div>
                <button
                  style={styles.secondaryButton}
                  onClick={() =>
                    setPrompt('请一起设计并实现 Agent Canvas 编排内核，要求保留现有 Agent 页、自动匹配工作引擎，并且不要让我反复说继续。')
                  }
                >
                  <Sparkles size={15} />
                  填入示例
                </button>
              </div>
              <textarea
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  if (nodes.length) setRunState('matched');
                }}
                placeholder="例如：请一起评审这个编排方案，重点看能不能落地、哪里会跑偏、下一步怎么实现。"
                style={styles.textarea}
              />
            </div>
          </section>

          <aside style={styles.rightPanel}>
            <section style={styles.card}>
              <div style={styles.panelTitle}>工作引擎</div>
              {engineMatch ? (
                <div style={styles.engineCard}>
                  <div style={styles.engineIcon}>
                    <Layers3 size={20} />
                  </div>
                  <div>
                    <div style={styles.engineName}>自动匹配：{engineMatch.label}</div>
                    <div style={styles.panelHint}>confidence {(engineMatch.confidence * 100).toFixed(0)}%</div>
                  </div>
                </div>
              ) : (
                <div style={styles.placeholderCard}>放入 Agent 并输入 Prompt 后，系统自动匹配工作引擎。</div>
              )}
              {engineMatch && (
                <div style={styles.reasonList}>
                  {engineMatch.reasons.map((reason) => (
                    <div key={reason} style={styles.reasonItem}>
                      <Check size={13} />
                      {reason}
                    </div>
                  ))}
                </div>
              )}
              <button
                style={{
                  ...styles.runButton,
                  opacity: engineMatch && runState !== 'running' ? 1 : 0.48,
                  cursor: engineMatch && runState !== 'running' ? 'pointer' : 'not-allowed',
                }}
                disabled={!engineMatch || runState === 'running'}
                onClick={runCanvas}
              >
                <Play size={17} />
                Run Canvas
              </button>
            </section>

            <section style={styles.card}>
              <div style={styles.panelTitle}>自治进度</div>
              <div style={styles.stepList}>
                {RUN_STEPS.map((step, index) => {
                  const done = runState === 'completed' || (runState === 'running' && index < activeStep);
                  const active = runState === 'running' && index === activeStep;
                  return (
                    <div key={step} style={styles.stepItem}>
                      <span
                        style={{
                          ...styles.stepDot,
                          background: done ? T.green : active ? T.purple : T.lineStrong,
                        }}
                      />
                      <span style={{ color: active ? T.text : T.secondary }}>{step}</span>
                      {active && <Clock3 size={13} color={T.purple} />}
                      {done && <Check size={13} color={T.green} />}
                    </div>
                  );
                })}
              </div>
            </section>

            <section style={styles.card}>
              <div style={styles.panelTitle}>{selectedNode ? '节点设置' : 'Agent 详情'}</div>
              {selectedNode ? (
                <div>
                  <div style={styles.selectedName}>{selectedNode.name}</div>
                  <textarea
                    value={selectedNode.localPrompt ?? ''}
                    onChange={(event) => {
                      setNodes((current) =>
                        current.map((node) =>
                          node.nodeId === selectedNode.nodeId ? { ...node, localPrompt: event.target.value } : node,
                        ),
                      );
                    }}
                    placeholder="可选：给这个 Agent 的局部提示词。"
                    style={{ ...styles.textarea, minHeight: 92 }}
                  />
                </div>
              ) : activeAgent ? (
                <AgentDetailCard
                  agent={activeAgent}
                  selected={nodes.some((node) => node.id === activeAgent.id)}
                  onAdd={() => addAgent(activeAgent)}
                />
              ) : (
                <div style={styles.placeholderCard}>点击左侧 Agent 查看详情，或点击画板节点补充局部 Prompt。</div>
              )}
            </section>
          </aside>
        </section>

        <section style={styles.resultPanel}>
          <div style={styles.resultHeader}>
            <div>
              <div style={styles.panelTitle}>运行结果</div>
              <div style={styles.panelHint}>默认展示汇总、关键贡献、风险和下一步，不展示 Agent 聊天噪音。</div>
            </div>
            {runState === 'running' && (
              <button style={styles.secondaryButton} onClick={() => setRunState('failed')}>
                <CircleStop size={15} />
                停止
              </button>
            )}
          </div>

          {runState === 'completed' ? (
            <div style={styles.resultGrid}>
              <ResultCard
                title="Final Result"
                tone="purple"
                lines={[
                  '建议按 Agent Canvas Orchestration 方向推进：轻入口、强内核、GoalKeeper 自治闭环。',
                  `本次匹配工作引擎：${engineMatch?.label ?? '自动'}`,
                  '下一步应落地 orchestration_service + parallel_analysis/review_gate 两条执行链。',
                ]}
              />
              <ResultCard
                title="Agent Contributions"
                tone="blue"
                lines={nodes.map((node) => `${node.name}: ${node.tags.includes('risk') ? '指出跑偏和复杂化风险' : node.tags.includes('code') ? '拆出服务/API/状态模型' : '提供关键判断和结构化输出'}`)}
              />
              <ResultCard
                title="GoalKeeper Coverage"
                tone="green"
                lines={[
                  '已覆盖：Canvas 入口、自动引擎匹配、RunPlan、自治推进。',
                  '未覆盖：真实 TurnService 对接、失败重试持久化、运行历史。',
                  '未触发人工升级：无高风险副作用、无需求冲突。',
                ]}
              />
              <ResultCard
                title="Risks"
                tone="orange"
                lines={[
                  '不要把 Canvas 做成复杂流程编辑器。',
                  '不要把 Agent Team/Versioning 重新放回主路径。',
                  '先跑通两条引擎，再考虑远程 Agent。'
                ]}
              />
            </div>
          ) : runState === 'failed' ? (
            <div style={styles.failedState}>运行已停止。当前状态会保留，用户可以修改 Prompt 或节点后重新运行。</div>
          ) : (
            <div style={styles.idleResult}>
              <Activity size={22} />
              运行后这里会展示 CanvasRunResult：最终汇总、各 Agent 贡献、GoalKeeper 覆盖、风险与下一步。
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function RailButton({ icon: Icon, active }: { icon: LucideIcon; active: boolean }) {
  return (
    <button
      style={{
        ...styles.railButton,
        color: active ? T.purple : T.secondary,
        background: active ? T.purpleSoft : 'transparent',
      }}
    >
      <Icon size={20} />
    </button>
  );
}

function AgentCard({
  agent,
  selected,
  active,
  onInspect,
}: {
  agent: Agent;
  selected: boolean;
  active: boolean;
  onInspect: () => void;
}) {
  const [hover, setHover] = useState(false);
  const Icon = agent.icon;
  return (
    <button
      style={{
        ...styles.agentCard,
        borderColor: active ? T.purple : selected ? T.green : T.line,
        background: active ? T.purpleSoft : '#fff',
      }}
      onClick={onInspect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={{ ...styles.agentAvatar, background: agent.color }}>
        <Icon size={17} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={styles.agentName}>{agent.name}</div>
      </div>
      {selected ? <Check size={16} color={T.green} /> : <ChevronRight size={16} color={T.tertiary} />}
      {hover && (
        <div style={styles.agentTooltip}>
          <div style={styles.tooltipTitle}>{agent.name}</div>
          <div style={styles.tooltipText}>{agent.desc}</div>
          <div style={styles.tagRow}>
            {agent.tags.map((tag) => (
              <span key={tag} style={styles.tag}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </button>
  );
}

function CanvasNodeCard({
  node,
  index,
  selected,
  onSelect,
  onRemove,
}: {
  node: CanvasNode;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const [hover, setHover] = useState(false);
  const Icon = node.icon;
  const statusStyle =
    node.status === 'done'
      ? { color: T.green, background: T.greenSoft }
      : node.status === 'running'
        ? { color: T.purple, background: T.purpleSoft }
        : node.status === 'failed'
          ? { color: T.red, background: T.redSoft }
          : { color: T.secondary, background: '#f7f5ff' };

  return (
    <div
      style={{ ...styles.nodeCard, borderColor: selected ? T.purple : T.lineStrong }}
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={{ ...styles.agentAvatar, background: node.color }}>
        <Icon size={17} />
      </div>
      <div style={styles.nodeMain}>
        <div style={styles.nodeIndex}>Agent {index + 1}</div>
        <div style={styles.nodeName}>{node.name}</div>
        <span style={{ ...styles.statusPill, ...statusStyle }}>{statusLabel(node.status)}</span>
      </div>
      <button
        style={styles.nodeRemove}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      >
        <Trash2 size={13} />
      </button>
      {hover && (
        <div style={styles.nodeTooltip}>
          <div style={styles.tooltipTitle}>{node.name}</div>
          <div style={styles.tooltipText}>{node.localPrompt || node.desc}</div>
          <div style={styles.tooltipText}>点击打开节点设置卡片。</div>
        </div>
      )}
    </div>
  );
}

function AgentDetailCard({ agent, selected, onAdd }: { agent: Agent; selected: boolean; onAdd: () => void }) {
  const Icon = agent.icon;
  return (
    <div style={styles.agentDetailCard}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <div style={{ ...styles.agentAvatarLarge, background: agent.color }}>
          <Icon size={20} />
        </div>
        <div>
          <div style={styles.selectedName}>{agent.name}</div>
          <div style={styles.panelHint}>{selected ? '已在当前画板' : '可加入当前画板'}</div>
        </div>
      </div>
      <div style={styles.agentDetailDesc}>{agent.desc}</div>
      <div style={styles.tagRow}>
        {agent.tags.map((tag) => (
          <span key={tag} style={styles.tag}>
            {tag}
          </span>
        ))}
      </div>
      <button
        style={{
          ...styles.runButton,
          height: 38,
          marginTop: 14,
          opacity: selected ? 0.5 : 1,
          cursor: selected ? 'not-allowed' : 'pointer',
        }}
        disabled={selected}
        onClick={onAdd}
      >
        <Plus size={15} />
        {selected ? '已加入画板' : '加入画板'}
      </button>
    </div>
  );
}

function ResultCard({ title, lines, tone }: { title: string; lines: string[]; tone: 'purple' | 'blue' | 'green' | 'orange' }) {
  const color = tone === 'purple' ? T.purple : tone === 'blue' ? T.blue : tone === 'green' ? T.green : T.orange;
  const bg = tone === 'purple' ? T.purpleSoft : tone === 'blue' ? T.blueSoft : tone === 'green' ? T.greenSoft : T.orangeSoft;
  return (
    <div style={styles.resultCard}>
      <div style={{ ...styles.resultTitle, color }}>
        <span style={{ ...styles.resultDot, background: bg, borderColor: color }} />
        {title}
      </div>
      {lines.map((line) => (
        <div key={line} style={styles.resultLine}>
          {line}
        </div>
      ))}
    </div>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone: 'purple' | 'green' }) {
  return (
    <span
      style={{
        ...styles.pill,
        color: tone === 'purple' ? T.purpleDark : T.green,
        background: tone === 'purple' ? T.purpleSoft : T.greenSoft,
      }}
    >
      {children}
    </span>
  );
}

function statusLabel(status: AgentStatus) {
  if (status === 'queued') return '排队';
  if (status === 'running') return '运行中';
  if (status === 'done') return '已完成';
  if (status === 'failed') return '失败';
  return '待运行';
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    background: T.bg,
    color: T.text,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    overflow: 'hidden',
  },
  rail: {
    width: 58,
    height: '100%',
    background: 'rgba(255,255,255,0.72)',
    borderRight: `1px solid ${T.line}`,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    padding: '12px 0',
    boxSizing: 'border-box',
  },
  logo: {
    width: 34,
    height: 34,
    borderRadius: 10,
    background: `linear-gradient(135deg, ${T.purple}, #9a8df0)`,
    color: '#fff',
    fontWeight: 800,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  railButton: {
    width: 38,
    height: 38,
    border: 0,
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  page: {
    flex: 1,
    padding: 18,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    minWidth: 0,
  },
  header: {
    minHeight: 72,
    background: T.panel,
    border: `1px solid ${T.line}`,
    borderRadius: 24,
    padding: '16px 22px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    boxShadow: '0 18px 45px rgba(15, 23, 42, 0.06)',
  },
  eyebrow: {
    color: T.purple,
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.4,
  },
  title: {
    margin: '2px 0',
    fontSize: 24,
    lineHeight: 1.1,
  },
  subtitle: {
    margin: 0,
    color: T.secondary,
    fontSize: 13,
  },
  headerActions: {
    display: 'flex',
    gap: 8,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    border: `1px solid ${T.line}`,
    background: '#fff',
    color: T.secondary,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
  },
  workspace: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: '250px minmax(520px, 1fr) 320px',
    gap: 14,
    minHeight: 0,
  },
  leftPanel: {
    background: T.panel,
    border: `1px solid ${T.line}`,
    borderRadius: 24,
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    minHeight: 0,
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  panelTitle: {
    fontSize: 14,
    fontWeight: 800,
    color: T.text,
  },
  panelHint: {
    fontSize: 12,
    color: T.tertiary,
    marginTop: 3,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    border: `1px solid ${T.line}`,
    background: '#fff',
    color: T.purple,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBox: {
    height: 38,
    border: `1px solid ${T.line}`,
    borderRadius: 12,
    background: '#fff',
    color: T.tertiary,
    fontSize: 13,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 12px',
  },
  agentList: {
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    paddingRight: 2,
  },
  agentCard: {
    width: '100%',
    border: `1px solid ${T.line}`,
    background: '#fff',
    borderRadius: 13,
    padding: '8px 9px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    textAlign: 'left',
    cursor: 'pointer',
    position: 'relative',
  },
  collapsedAgentButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    border: '1px solid transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
  },
  agentAvatar: {
    width: 34,
    height: 34,
    flexShrink: 0,
    borderRadius: 12,
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentName: {
    fontWeight: 800,
    fontSize: 13,
  },
  agentDesc: {
    color: T.secondary,
    fontSize: 12,
    lineHeight: 1.45,
    marginTop: 3,
  },
  agentTooltip: {
    position: 'absolute',
    left: 46,
    top: 42,
    zIndex: 20,
    width: 220,
    border: `1px solid ${T.lineStrong}`,
    borderRadius: 14,
    padding: 12,
    background: '#fff',
    boxShadow: '0 18px 42px rgba(15, 23, 42, 0.08)',
    pointerEvents: 'none',
  },
  tooltipTitle: {
    fontSize: 13,
    fontWeight: 850,
    color: T.text,
  },
  tooltipText: {
    marginTop: 6,
    color: T.secondary,
    fontSize: 12,
    lineHeight: 1.5,
  },
  tagRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 7,
  },
  tag: {
    fontSize: 10,
    padding: '3px 6px',
    borderRadius: 999,
    background: T.purpleSoft,
    color: T.purpleDark,
  },
  templateBox: {
    borderTop: `1px solid ${T.line}`,
    paddingTop: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  templateButton: {
    border: `1px solid ${T.line}`,
    background: '#fff',
    borderRadius: 14,
    padding: 11,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    textAlign: 'left',
    cursor: 'pointer',
  },
  canvasColumn: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  canvasHeader: {
    background: T.panel,
    border: `1px solid ${T.line}`,
    borderRadius: 20,
    padding: '14px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  canvas: {
    flex: 1,
    minHeight: 320,
    background:
      'radial-gradient(circle at 1px 1px, rgba(15,23,42,0.06) 1px, transparent 0), rgba(255,255,255,0.72)',
    backgroundSize: '22px 22px',
    border: `1px dashed ${T.lineStrong}`,
    borderRadius: 26,
    position: 'relative',
    overflow: 'hidden',
    padding: 22,
  },
  emptyCanvas: {
    height: '100%',
    minHeight: 320,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    color: T.secondary,
  },
  nodeGrid: {
    height: '100%',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    alignContent: 'start',
  },
  nodeCard: {
    background: 'rgba(255,255,255,0.92)',
    border: `1px solid ${T.line}`,
    borderRadius: 16,
    padding: 10,
    boxShadow: '0 12px 26px rgba(15, 23, 42, 0.06)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    width: 210,
    position: 'relative',
  },
  nodeRemove: {
    border: 0,
    background: T.purpleSoft,
    color: T.secondary,
    width: 24,
    height: 24,
    borderRadius: 9,
    cursor: 'pointer',
    marginLeft: 'auto',
  },
  nodeMain: {
    minWidth: 0,
    flex: 1,
  },
  nodeIndex: {
    color: T.tertiary,
    fontSize: 11,
    fontWeight: 700,
  },
  nodeName: {
    fontSize: 13,
    fontWeight: 850,
    marginTop: 3,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  nodeDesc: {
    fontSize: 12,
    color: T.secondary,
    lineHeight: 1.5,
    minHeight: 36,
    marginTop: 7,
  },
  nodeFooter: {
    marginTop: 14,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  nodeTooltip: {
    position: 'absolute',
    left: 16,
    top: 58,
    zIndex: 30,
    width: 220,
    border: `1px solid ${T.lineStrong}`,
    borderRadius: 14,
    padding: 12,
    background: '#fff',
    boxShadow: '0 18px 42px rgba(15, 23, 42, 0.08)',
    pointerEvents: 'none',
  },
  statusPill: {
    fontSize: 11,
    fontWeight: 750,
    borderRadius: 999,
    padding: '5px 8px',
  },
  promptPanel: {
    background: T.panel,
    border: `1px solid ${T.line}`,
    borderRadius: 22,
    padding: 16,
  },
  promptHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  textarea: {
    width: '100%',
    minHeight: 116,
    resize: 'none',
    border: `1px solid ${T.line}`,
    outline: 'none',
    borderRadius: 16,
    background: '#fff',
    color: T.text,
    padding: 13,
    boxSizing: 'border-box',
    fontSize: 13,
    lineHeight: 1.6,
    fontFamily: 'inherit',
  },
  rightPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    minHeight: 0,
  },
  card: {
    background: T.panel,
    border: `1px solid ${T.line}`,
    borderRadius: 22,
    padding: 16,
  },
  engineCard: {
    marginTop: 12,
    border: `1px solid ${T.lineStrong}`,
    borderRadius: 18,
    padding: 13,
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    background: '#fff',
  },
  engineIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: T.purple,
    background: T.purpleSoft,
  },
  engineName: {
    fontWeight: 850,
    fontSize: 14,
  },
  reasonList: {
    marginTop: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
  },
  reasonItem: {
    color: T.secondary,
    fontSize: 12,
    display: 'flex',
    gap: 7,
    alignItems: 'center',
  },
  runButton: {
    marginTop: 14,
    width: '100%',
    height: 44,
    border: 0,
    borderRadius: 14,
    background: `linear-gradient(135deg, ${T.purple}, #9478ff)`,
    color: '#fff',
    fontWeight: 850,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  stepList: {
    marginTop: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  stepItem: {
    display: 'grid',
    gridTemplateColumns: '14px 1fr 18px',
    gap: 8,
    alignItems: 'center',
    fontSize: 12,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  selectedName: {
    fontWeight: 850,
    margin: '12px 0 8px',
  },
  agentDetailCard: {
    marginTop: 12,
    border: `1px solid ${T.lineStrong}`,
    borderRadius: 16,
    padding: 14,
    background: '#fff',
  },
  agentAvatarLarge: {
    width: 42,
    height: 42,
    flexShrink: 0,
    borderRadius: 14,
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentDetailDesc: {
    marginTop: 12,
    color: T.secondary,
    fontSize: 12,
    lineHeight: 1.55,
  },
  placeholderCard: {
    marginTop: 12,
    border: `1px dashed ${T.lineStrong}`,
    borderRadius: 16,
    padding: 14,
    color: T.tertiary,
    fontSize: 12,
    lineHeight: 1.55,
    background: 'rgba(255,255,255,0.62)',
  },
  resultPanel: {
    minHeight: 190,
    background: T.panel,
    border: `1px solid ${T.line}`,
    borderRadius: 24,
    padding: 16,
  },
  resultHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  resultGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 12,
  },
  resultCard: {
    background: '#fff',
    border: `1px solid ${T.line}`,
    borderRadius: 18,
    padding: 14,
    minHeight: 120,
  },
  resultTitle: {
    fontWeight: 850,
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    marginBottom: 10,
  },
  resultDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    border: '1px solid',
  },
  resultLine: {
    color: T.secondary,
    fontSize: 12,
    lineHeight: 1.55,
    marginTop: 7,
  },
  idleResult: {
    height: 120,
    border: `1px dashed ${T.lineStrong}`,
    borderRadius: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: T.tertiary,
    gap: 9,
    fontSize: 13,
  },
  failedState: {
    height: 120,
    border: `1px solid ${T.redSoft}`,
    background: T.redSoft,
    borderRadius: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: T.red,
    fontSize: 13,
  },
  secondaryButton: {
    height: 34,
    border: `1px solid ${T.line}`,
    borderRadius: 11,
    background: '#fff',
    color: T.secondary,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '0 11px',
    cursor: 'pointer',
    fontWeight: 750,
    fontSize: 12,
  },
  pill: {
    borderRadius: 999,
    padding: '7px 11px',
    fontSize: 12,
    fontWeight: 800,
  },
};

export { AgentCanvasPrototype };
