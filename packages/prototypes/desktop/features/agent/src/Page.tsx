// Agent Prototype — Page Shell (Dual-Surface Architecture)
// Two sibling surfaces: "Agents" (list + profile) and "Atelier" (task workbench).
// GlobalNav (56px icon rail) switches between them.
// Switching agents changes both surfaces' context.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { MessageSquare, Users, GitBranch, ChevronRight } from 'lucide-react';
import { T } from './theme';
import type { Agent, Block, Surface, Task, TaskContext, TaskMode, TodoItem } from './types';
import { createMockRuntime, type AgentRuntime } from './runtime';
import { GlobalNav } from './panels/GlobalNav';
import { AgentList } from './panels/AgentList';
import { AgentProfile } from './panels/AgentProfile';
import { BuilderSidebar } from './panels/BuilderSidebar';
import { LeftRail } from './panels/LeftRail';
import { RightPanel } from './panels/RightPanel';
import { ComposerBar } from './panels/ComposerBar';
import { PanelToggleDock } from '../../../shared/PanelToggleButton';

// -- Stream block renderers --

function UserBlock({ block }: { block: Extract<Block, { kind: 'user' }> }) {
  return (
    <div style={styles.userBlock}>
      <div style={styles.userBubble}>{block.text}</div>
      {block.at && <span style={styles.blockTime}>{block.at}</span>}
    </div>
  );
}

function AgentBlock({ block }: { block: Extract<Block, { kind: 'agent' }> }) {
  return (
    <div style={styles.agentBlock}>
      <div style={styles.agentBubble}>
        <p style={{ margin: 0 }}>{block.text}</p>
        {block.bullets && (
          <ul style={styles.bulletList}>
            {block.bullets.map((b, i) => <li key={i} style={styles.bulletItem}>{b}</li>)}
          </ul>
        )}
      </div>
      {block.at && <span style={styles.blockTime}>{block.at}</span>}
    </div>
  );
}

function ToolCallBlock({ block }: { block: Extract<Block, { kind: 'tool-call' }> }) {
  const statusColor = block.status === 'done' ? T.trust.success : block.status === 'failed' ? T.trust.error : T.text.muted;
  return (
    <div style={styles.toolBlock}>
      <span style={{ ...styles.toolDot, backgroundColor: statusColor }} />
      <span style={styles.toolLabel}>{block.tool}</span>
      {block.duration && <span style={styles.toolMeta}>{block.duration}</span>}
      {block.output && <span style={styles.toolMeta}> — {block.output}</span>}
    </div>
  );
}

function NegoBlock({ block, open, onToggle }: { block: Extract<Block, { kind: 'nego' }>; open: boolean; onToggle: () => void }) {
  return (
    <div style={styles.negoBlock}>
      <div style={styles.negoHeader} onClick={onToggle}>
        <Users size={14} color={T.action.primary} />
        <span style={styles.negoTitle}>{block.summary}</span>
        <span style={styles.negoMeta}>{block.agentCount} agents {block.converged ? '· converged' : '· deliberating'}</span>
        <ChevronRight size={12} color={T.text.muted} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
      </div>
      {open && (
        <div style={styles.negoBody}>
          {block.voices.map((v, i) => (
            <div key={i} style={styles.voiceRow}>
              <span style={styles.voiceRole}>{v.role}</span>
              <span style={styles.voiceStance}>{v.stance}</span>
              <span style={styles.voiceText}>{v.text}</span>
            </div>
          ))}
          {block.consensus && <div style={styles.consensus}>Consensus: {block.consensus}</div>}
        </div>
      )}
    </div>
  );
}

function DiffBlock({ block, open, onToggle }: { block: Extract<Block, { kind: 'diff' }>; open: boolean; onToggle: () => void }) {
  return (
    <div style={styles.diffBlock}>
      <div style={styles.diffHeader} onClick={onToggle}>
        <GitBranch size={14} color={T.text.secondary} />
        <span style={styles.diffTitle}>{block.files} files</span>
        <span style={{ ...styles.diffStat, color: T.trust.success }}>+{block.added}</span>
        <span style={{ ...styles.diffStat, color: T.trust.error }}>-{block.removed}</span>
        <ChevronRight size={12} color={T.text.muted} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
      </div>
      {open && (
        <div style={styles.diffBody}>
          {block.paths.map((p, i) => <div key={i} style={styles.diffPath}>{p}</div>)}
        </div>
      )}
    </div>
  );
}

function DecisionBlock({ block }: { block: Extract<Block, { kind: 'decision' }> }) {
  return (
    <div style={styles.decisionBlock}>
      <div style={styles.decisionQuestion}>{block.question}</div>
      {block.spentSoFar && <span style={styles.decisionMeta}>Spent: {block.spentSoFar}</span>}
      <div style={styles.decisionOptions}>
        {block.options.map((opt, i) => (
          <button key={i} style={{ ...styles.decisionBtn, ...(opt.recommended ? styles.decisionBtnRecommended : {}) }}>
            {opt.text}{opt.recommended && ' *'}
          </button>
        ))}
      </div>
    </div>
  );
}

function ArtifactBlock({ block }: { block: Extract<Block, { kind: 'artifact' }> }) {
  return (
    <div style={styles.artifactBlock}>
      <span style={styles.artifactIcon}>📄</span>
      <span style={styles.artifactName}>{block.name}</span>
      <span style={styles.artifactMeta}>{block.fileKind} · by {block.producedBy}</span>
    </div>
  );
}

// -- Page Component --

export function Page({
  initialSurface = 'agents',
  showGlobalNav = true,
}: {
  initialSurface?: Surface;
  showGlobalNav?: boolean;
} = {}) {
  const runtimeRef = useRef<AgentRuntime | null>(null);
  const streamEndRef = useRef<HTMLDivElement | null>(null);
  const atelierRef = useRef<HTMLDivElement | null>(null);
  const atelierNarrowRef = useRef<boolean | null>(null);

  // Surface navigation
  const [surface, setSurface] = useState<Surface>(initialSurface);

  // Agent state (shared across surfaces)
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');

  // Agent profile surface state
  const [agentListCollapsed, setAgentListCollapsed] = useState(false);
  const [builderExpanded, setBuilderExpanded] = useState(true);

  // Atelier state
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [narrowAtelier, setNarrowAtelier] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState('t1');
  const [mode, setMode] = useState<TaskMode>('work');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stream, setStream] = useState<Record<string, Block[]>>({});
  const [context, setContext] = useState<Record<string, TaskContext>>({});
  const [todos, setTodos] = useState<Record<string, TodoItem[]>>({});
  const [inputText, setInputText] = useState('');
  const [negoOpen, setNegoOpen] = useState<Record<string, boolean>>({});
  const [diffOpen, setDiffOpen] = useState<Record<string, boolean>>({});
  const [model, setModel] = useState('Claude Sonnet 4');

  useEffect(() => {
    const rt = createMockRuntime();
    runtimeRef.current = rt;

    const initial = rt.getSnapshot();
    setAgents(initial.agents);
    setSelectedAgentId(initial.selectedAgentId);
    setTasks(initial.tasks);
    setSelectedTaskId(initial.selectedTaskId);
    setStream(initial.stream);
    setContext(initial.context);
    setTodos(initial.todos);
    setModel(initial.model);

    const unsub = rt.subscribe((snap) => {
      setAgents(snap.agents);
      setSelectedAgentId(snap.selectedAgentId);
      setTasks(snap.tasks);
      setSelectedTaskId(snap.selectedTaskId);
      setStream(snap.stream);
      setContext(snap.context);
      setTodos(snap.todos);
      setModel(snap.model);
    });

    return unsub;
  }, []);

  useLayoutEffect(() => {
    const element = atelierRef.current;
    if (!element || surface !== 'atelier') return;
    const syncWidth = (width: number) => {
      if (width <= 0) return;
      const narrow = width < 820;
      const wasNarrow = atelierNarrowRef.current;
      atelierNarrowRef.current = narrow;
      setNarrowAtelier(narrow);
      if (narrow && wasNarrow !== true) {
        setLeftOpen(false);
        setRightOpen(false);
      }
    };
    syncWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => syncWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [surface]);

  // Auto-scroll stream on new blocks
  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [stream, selectedTaskId]);

  // -- Handlers --

  function handleSelectAgent(id: string) {
    runtimeRef.current?.selectAgent(id);
  }

  function handleSend() {
    if (!inputText.trim()) return;
    runtimeRef.current?.sendMessage(selectedTaskId, inputText.trim());
    setInputText('');
  }

  function handleSelectTask(id: string) {
    runtimeRef.current?.selectTask(id);
  }

  function handleNewTask() {
    runtimeRef.current?.addTask('New task', 'peers-touch');
  }

  function toggleNego(id: string) {
    setNegoOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleDiff(id: string) {
    setDiffOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  // Derived state
  const currentAgent = agents.find((a) => a.id === selectedAgentId);
  const currentBlocks = stream[selectedTaskId] ?? [];
  const currentContext = context[selectedTaskId] ?? { usedPct: 0, files: [] };
  const currentTodos = todos[selectedTaskId] ?? [];
  const selectedTask = tasks.find((t) => t.id === selectedTaskId);

  return (
    <div style={styles.shell}>
      {/* Global Navigation Rail */}
      {showGlobalNav && (
        <GlobalNav
          surface={surface}
          onSurfaceChange={setSurface}
          currentAgent={currentAgent}
        />
      )}

      {/* Surface Content */}
      {surface === 'agents' ? (
        // -- Agents Surface: List + Profile + Builder --
        <div style={styles.agentsSurface}>
          <AgentList
            agents={agents}
            selectedId={selectedAgentId}
            onSelect={handleSelectAgent}
            onCreateAgent={() => {}}
            collapsed={agentListCollapsed}
            onToggleCollapse={() => setAgentListCollapsed((v) => !v)}
          />
          {currentAgent && (
            <AgentProfile
              agent={currentAgent}
              onBack={() => setSurface('atelier')}
            />
          )}
          <BuilderSidebar
            modelLabel={currentAgent?.model || 'Not set'}
            capabilitiesSummary="3 tools, 3 skills"
            focusLabel="SOUL / AGENTS"
            expanded={builderExpanded}
            onToggle={() => setBuilderExpanded((v) => !v)}
          />
        </div>
      ) : (
        // -- Atelier Surface: Task List + Stream + Context --
        <div ref={atelierRef} data-testid="desktop-shell-atelier" style={styles.atelierSurface}>
          {/* Left Rail */}
          {leftOpen ? (
            <LeftRail
              mode={mode}
              setMode={setMode}
              tasks={tasks}
              selectedTaskId={selectedTaskId}
              onSelectTask={handleSelectTask}
              onNewTask={handleNewTask}
              onCollapse={() => setLeftOpen(false)}
            />
          ) : (
            <div style={styles.collapsedLeft}>
              <PanelToggleDock
                side="left"
                open={false}
                title="展开任务面板"
                onClick={() => {
                  if (narrowAtelier) setRightOpen(false);
                  setLeftOpen(true);
                }}
              />
            </div>
          )}

          {/* Center Panel */}
          <div style={styles.center}>
            {/* Header */}
            <div style={styles.header}>
              <div style={styles.headerLeft}>
                {!leftOpen && (
                  <span style={styles.headerRailSpacer} />
                )}
                {selectedTask && (
                  <>
                    <MessageSquare size={14} color={T.text.secondary} />
                    <span style={styles.headerTitle}>{selectedTask.title}</span>
                    {selectedTask.running && <span style={styles.runningDot} />}
                  </>
                )}
              </div>
              <div style={styles.headerRight}>
                <span style={styles.headerModel}>{model}</span>
                {!rightOpen && (
                  <span style={styles.headerRailSpacer} />
                )}
              </div>
            </div>

            {/* Stream */}
            <div style={styles.stream}>
              {currentBlocks.length === 0 && (
                <div style={styles.emptyStream}>
                  <MessageSquare size={32} color={T.text.quaternary} />
                  <p style={styles.emptyText}>Start a conversation to begin this task.</p>
                </div>
              )}
              {currentBlocks.map((block) => {
                switch (block.kind) {
                  case 'user': return <UserBlock key={block.id} block={block} />;
                  case 'agent': return <AgentBlock key={block.id} block={block} />;
                  case 'tool-call': return <ToolCallBlock key={block.id} block={block} />;
                  case 'nego': return <NegoBlock key={block.id} block={block} open={!!negoOpen[block.id]} onToggle={() => toggleNego(block.id)} />;
                  case 'diff': return <DiffBlock key={block.id} block={block} open={!!diffOpen[block.id]} onToggle={() => toggleDiff(block.id)} />;
                  case 'decision': return <DecisionBlock key={block.id} block={block} />;
                  case 'artifact': return <ArtifactBlock key={block.id} block={block} />;
                  default: return null;
                }
              })}
              <div ref={streamEndRef} />
            </div>

            {/* Composer */}
            <ComposerBar
              value={inputText}
              onChange={setInputText}
              onSend={handleSend}
              model={model}
              onModelChange={setModel}
            />
          </div>

          {/* Right Panel */}
          {rightOpen ? (
            <RightPanel
              todos={currentTodos}
              context={currentContext}
              onCollapse={() => setRightOpen(false)}
            />
          ) : (
            <div style={styles.collapsedRight}>
              <PanelToggleDock
                side="right"
                open={false}
                title="展开上下文面板"
                onClick={() => {
                  if (narrowAtelier) setLeftOpen(false);
                  setRightOpen(true);
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// -- Styles --

const styles: Record<string, CSSProperties> = {
  shell: {
    display: 'flex',
    height: '100%',
    overflow: 'hidden',
    background: T.surface.canvas,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 13,
    color: T.text.primary,
  },

  // Agents surface
  agentsSurface: {
    flex: 1,
    display: 'flex',
    height: '100%',
    overflow: 'hidden',
  },

  // Atelier surface
  atelierSurface: {
    position: 'relative',
    flex: 1,
    display: 'flex',
    height: '100%',
    overflow: 'hidden',
  },

  // Collapsed rails
  collapsedLeft: {
    width: 48,
    minWidth: 48,
    height: '100%',
    display: 'flex',
    position: 'relative',
    boxSizing: 'border-box' as const,
    borderRight: `1px solid ${T.border.hairline}`,
    background: T.surface.canvas,
  },
  collapsedRight: {
    width: 48,
    minWidth: 48,
    height: '100%',
    display: 'flex',
    position: 'relative',
    boxSizing: 'border-box' as const,
    borderLeft: `1px solid ${T.border.hairline}`,
    background: T.surface.canvas,
  },
  headerRailSpacer: {
    width: 0,
    height: 0,
  },

  // Center (Atelier)
  center: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    overflow: 'hidden',
  },
  header: {
    height: 44,
    minHeight: 44,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `0 ${T.space.lg}px`,
    borderBottom: `1px solid ${T.border.hairline}`,
    background: T.surface.canvas,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: T.space.sm,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: 500,
    color: T.text.primary,
  },
  runningDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: T.trust.success,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
  },
  headerModel: {
    fontSize: 11,
    color: T.text.muted,
    padding: `2px ${T.space.sm}px`,
    borderRadius: T.radius.sm,
    background: T.surface.subtle,
  },

  // Stream
  stream: {
    flex: 1,
    overflowY: 'auto',
    padding: T.space.lg,
    display: 'flex',
    flexDirection: 'column',
    gap: T.space.md,
  },
  emptyStream: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.sm,
  },
  emptyText: {
    color: T.text.muted,
    fontSize: 13,
    margin: 0,
  },

  // User block
  userBlock: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 2,
  },
  userBubble: {
    maxWidth: '75%',
    padding: `${T.space.sm}px ${T.space.md}px`,
    borderRadius: T.radius.lg,
    background: T.action.primary,
    color: '#fff',
    fontSize: 13,
    lineHeight: 1.5,
  },

  // Agent block
  agentBlock: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
  },
  agentBubble: {
    maxWidth: '80%',
    padding: `${T.space.sm}px ${T.space.md}px`,
    borderRadius: T.radius.lg,
    background: T.surface.subtle,
    fontSize: 13,
    lineHeight: 1.5,
  },
  bulletList: {
    margin: `${T.space.xs}px 0 0 0`,
    paddingLeft: T.space.lg,
  },
  bulletItem: {
    fontSize: 12,
    color: T.text.secondary,
    marginBottom: 2,
  },
  blockTime: {
    fontSize: 10,
    color: T.text.quaternary,
    paddingTop: 1,
  },

  // Tool call
  toolBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: T.space.sm,
    padding: `${T.space.xs}px ${T.space.md}px`,
    borderRadius: T.radius.sm,
    background: T.surface.subtle,
    border: `1px solid ${T.border.hairline}`,
  },
  toolDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
  },
  toolLabel: {
    fontSize: 12,
    fontFamily: 'SF Mono, Menlo, Consolas, monospace',
    color: T.text.secondary,
  },
  toolMeta: {
    fontSize: 11,
    color: T.text.muted,
  },

  // Negotiation
  negoBlock: {
    borderRadius: T.radius.md,
    border: `1px solid ${T.border.hairline}`,
    overflow: 'hidden',
  },
  negoHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: T.space.sm,
    padding: `${T.space.sm}px ${T.space.md}px`,
    background: T.surface.subtle,
    cursor: 'pointer',
    userSelect: 'none',
  },
  negoTitle: {
    fontSize: 12,
    fontWeight: 500,
    color: T.text.primary,
    flex: 1,
  },
  negoMeta: {
    fontSize: 11,
    color: T.text.muted,
  },
  negoBody: {
    padding: `${T.space.sm}px ${T.space.md}px`,
    display: 'flex',
    flexDirection: 'column',
    gap: T.space.xs,
  },
  voiceRow: {
    display: 'flex',
    gap: T.space.sm,
    fontSize: 12,
    lineHeight: 1.4,
  },
  voiceRole: {
    fontWeight: 600,
    color: T.action.primary,
    minWidth: 70,
    flexShrink: 0,
  },
  voiceStance: {
    fontSize: 10,
    color: T.text.muted,
    textTransform: 'uppercase',
    minWidth: 60,
    flexShrink: 0,
  },
  voiceText: {
    color: T.text.secondary,
  },
  consensus: {
    marginTop: T.space.xs,
    padding: `${T.space.xs}px ${T.space.sm}px`,
    borderRadius: T.radius.sm,
    background: '#f0f9eb',
    fontSize: 11,
    fontWeight: 500,
    color: T.trust.success,
  },

  // Diff block
  diffBlock: {
    borderRadius: T.radius.md,
    border: `1px solid ${T.border.hairline}`,
    overflow: 'hidden',
  },
  diffHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: T.space.sm,
    padding: `${T.space.sm}px ${T.space.md}px`,
    background: T.surface.subtle,
    cursor: 'pointer',
    userSelect: 'none',
  },
  diffTitle: {
    fontSize: 12,
    fontWeight: 500,
    flex: 1,
  },
  diffStat: {
    fontSize: 11,
    fontFamily: 'SF Mono, Menlo, Consolas, monospace',
    fontWeight: 500,
  },
  diffBody: {
    padding: `${T.space.sm}px ${T.space.md}px`,
  },
  diffPath: {
    fontSize: 11,
    fontFamily: 'SF Mono, Menlo, Consolas, monospace',
    color: T.text.secondary,
    padding: '1px 0',
  },

  // Decision block
  decisionBlock: {
    padding: T.space.md,
    borderRadius: T.radius.md,
    border: `1px solid ${T.border.hairline}`,
    background: T.surface.raised,
  },
  decisionQuestion: {
    fontSize: 13,
    fontWeight: 500,
    marginBottom: T.space.sm,
  },
  decisionMeta: {
    fontSize: 11,
    color: T.text.muted,
  },
  decisionOptions: {
    display: 'flex',
    gap: T.space.sm,
    marginTop: T.space.sm,
    flexWrap: 'wrap',
  },
  decisionBtn: {
    padding: `${T.space.xs}px ${T.space.md}px`,
    borderRadius: T.radius.sm,
    border: `1px solid ${T.border.hairline}`,
    background: T.surface.canvas,
    fontSize: 12,
    cursor: 'pointer',
    color: T.text.primary,
  },
  decisionBtnRecommended: {
    borderColor: T.action.primary,
    color: T.action.primary,
    fontWeight: 500,
  },

  // Artifact block
  artifactBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: T.space.sm,
    padding: `${T.space.sm}px ${T.space.md}px`,
    borderRadius: T.radius.sm,
    border: `1px solid ${T.border.hairline}`,
    background: T.surface.raised,
  },
  artifactIcon: {
    fontSize: 14,
  },
  artifactName: {
    fontSize: 12,
    fontWeight: 500,
    color: T.text.primary,
  },
  artifactMeta: {
    fontSize: 11,
    color: T.text.muted,
  },
};
