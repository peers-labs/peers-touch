/**
 * Atelier — main shell (SOLO-style, conversation-first).
 *
 * Shell parity with TRAE Work / SOLO, for a *personal* workbench:
 *   - left rail  : New task + Skills + Automation entries, then a pluggable
 *                  task organizer (default = group by project folder)
 *   - top bar    : task title + repo chip + branch + Open in IDE + budget meter
 *   - centre     : a single conversation stream (rich markdown, Completed +
 *                  feedback bar, diff cards, artifacts) + a rich composer
 *   - right panel: Todo + Context (token usage + touched files)
 *
 * Atelier's soul — multi-agent negotiation — is NOT a separate team board.
 * It is folded into the stream as a collapsible "agents negotiated X" row,
 * and the only thing pushed to the human is an inline decision card.
 *
 * Prototype: mock-data driven, runs as a standalone web page (React + LobeUI/
 * antd + CSS) you open in the browser. It only shows what the end product
 * looks like; the web artifact preview is a real embedded <iframe>.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { C, ROLE_COLOR } from './theme';
import { COLLAB_INPUTS } from './mock';
import type { Block, TodoItem, TaskHost, TaskStatus, TaskContext, Artifact } from './types';
import type { AtelierRuntime, AtelierRuntimeSnapshot } from './runtime';
import { createMockAtelierRuntime } from './runtime';
import { UserBubble, AgentBubble, NegoRow, DecisionCard, ArtifactCard, DiffCard } from './blocks';
import { EngineTrace } from './engineTrace';
import { ArtifactsTray, PreviewPanel } from './preview';
import { PLUGINS, DEFAULT_PLUGIN_ID } from './plugins';
import { PanelToggleButton } from '../../../shared/PanelToggleButton';
import { PromptComposer } from '../../../shared/PromptComposer';

// CLI agents (trae-cli / claude-code) are wrapped as model-style calls,
// so they sit in the same picker as the hosted models.
const MODELS = ['openrouter-3o', 'claude-sonnet', 'gpt-5', 'gemini-pro', 'trae-cli', 'claude-code'];

/**
 * How a goal gets run — chosen from one merged dropdown with two tabs:
 *   model  : hand straight to one model / CLI (no negotiation)
 *   agents : run it through the peers-touch collaboration engine, i.e. one of
 *            its multi-agent orchestration patterns
 */
type RunKind = 'model' | 'agents';

/**
 * The peers-touch agent framework ships a generic multi-agent *collaboration
 * engine* (orchestration is a core framework capability, not something built
 * for Atelier — Atelier is just one agent that consumes it).
 *
 * `batch:1` engines have a REAL pluggable EnginePolicy in this prototype
 * (engine.ts): switching between them re-runs the shared CollaborationSession
 * state machine over the same position pool and produces a visibly different
 * negotiation trace. `batch:2` engines are designed but not yet policy-backed
 * here — they are variants of the same three convergence mechanisms.
 */
const AGENT_FLOWS: { id: string; name: string; sub: string; batch: 1 | 2 }[] = [
  { id: 'expert-hierarchy', name: 'Expert Hierarchy（默认）', sub: '长流程 + 能力互补 · 终裁签字 + 无未决反对', batch: 1 },
  { id: 'roundtable', name: 'Roundtable 圆桌', sub: '方案发散 / 头脑风暴 · 主持人收敛', batch: 1 },
  { id: 'debate-judge', name: 'Debate Judge 辩论裁决', sub: '多方案冲突 · Judge 裁决达成共识', batch: 1 },
  { id: 'expert-mesh', name: 'Expert Mesh 专家网', sub: '能力互补并行 · 聚合器合并', batch: 2 },
  { id: 'swarm', name: 'Swarm 蜂群', sub: '海量同构并行 · 结果归约 + 多数', batch: 2 },
  { id: 'hierarchy', name: 'Hierarchy 层级（edict）', sub: '长流程强秩序 · 上级签字下令', batch: 2 },
];

const DEFAULT_RUNTIME = createMockAtelierRuntime();

/** The nine Agent peers collaborating in the workspace (footer cluster). */
const PEERS: { role: string; label: string }[] = [
  { role: 'GoalOwner', label: 'G' },
  { role: 'Architect', label: 'A' },
  { role: 'Planner', label: 'P' },
  { role: 'Risk', label: 'R' },
  { role: 'Supervisor', label: 'S' },
  { role: 'Executor', label: 'E' },
  { role: 'Verifier', label: 'V' },
  { role: 'Integrator', label: 'I' },
  { role: 'Historian', label: 'H' },
];

/** simple horizontal progress bar (was antd Progress). */
function Bar({ pct, danger, width }: { pct: number; danger?: boolean; width?: number }) {
  return (
    <div style={{ width: width ?? undefined, flex: width ? undefined : 1, height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(100, pct)}%`, height: 6, backgroundColor: danger ? C.error : C.primary, borderRadius: 3 }} />
    </div>
  );
}

function TodoRow({ t }: { t: TodoItem }) {
  const glyph = t.status === 'done' ? '✓' : t.status === 'running' ? '◐' : '○';
  const color = t.status === 'done' ? C.success : t.status === 'running' ? C.primary : C.textQuaternary;
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '6px 0' }}>
      <span style={{ fontSize: 14, color, marginRight: 8 }}>{glyph}</span>
      <span style={{ flex: 1, fontSize: 13, color: t.status === 'done' ? C.textTertiary : C.text }}>{t.text}</span>
    </div>
  );
}

function ContextPanel({ ctx }: { ctx: TaskContext }) {
  const [tab, setTab] = useState<'files' | 'other'>('files');
  const items = ctx.files.filter((f) => f.group === tab);
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ flex: 1, fontWeight: 'bold' }}>Context</span>
        <span style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: '1px 7px', fontSize: 11, color: C.textTertiary }}>compact</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <Bar pct={ctx.usedPct} />
        <span style={{ fontSize: 12, color: C.textTertiary, marginLeft: 8 }}>{ctx.usedPct}%</span>
      </div>
      <div style={{ display: 'flex', marginBottom: 8 }}>
        {(['files', 'other'] as const).map((k) => (
          <span
            key={k}
            onClick={() => setTab(k)}
            style={{ fontSize: 13, fontWeight: 'bold', marginRight: 16, color: tab === k ? C.primary : C.textTertiary, cursor: 'pointer' }}
          >
            {k === 'files' ? 'Files' : 'Other'}
          </span>
        ))}
      </div>
      {items.map((f) => (
        <div key={f.name} style={{ display: 'flex', alignItems: 'center', padding: '5px 0' }}>
          <span style={{ fontSize: 13, color: C.textQuaternary, marginRight: 8 }}>📄</span>
          <span style={{ flex: 1, fontSize: 13, color: C.textSecondary }}>{f.name}</span>
        </div>
      ))}
      {items.length === 0 ? <span style={{ fontSize: 12, color: C.textQuaternary }}>暂无</span> : null}
    </div>
  );
}

/** inline menu picker (replaces antd Dropdown). */
function Picker({
  label,
  options,
  onPick,
}: {
  label: string;
  options: { key: string; title: string; sub?: string }[];
  onPick: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <div onClick={() => setOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
        {label ? <span style={{ fontSize: 12, color: C.textSecondary, marginRight: 3 }}>{label}</span> : null}
        <span style={{ fontSize: 11, color: C.textTertiary }}>▾</span>
      </div>
      {open ? (
        <div
          style={{
            position: 'absolute',
            zIndex: 10,
            marginTop: 4,
            minWidth: 160,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            backgroundColor: C.bg,
            padding: '4px 0',
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          }}
        >
          {options.map((o) => (
            <div
              key={o.key}
              onClick={() => {
                setOpen(false);
                onPick(o.key);
              }}
              style={{ padding: '6px 10px', cursor: 'pointer' }}
            >
              <div style={{ fontSize: 13 }}>{o.title}</div>
              {o.sub ? <div style={{ fontSize: 11, color: C.textTertiary }}>{o.sub}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Merged run-target dropdown with two tabs:
 *   "直接模型" → pick a model / CLI (direct, no negotiation)
 *   "Agents"  → pick a preset multi-agent collaboration flow (collaboration engine)
 * The trigger label shows whichever target is currently active.
 */
function RunPicker({
  runKind,
  model,
  flowId,
  onPickModel,
  onPickFlow,
}: {
  runKind: RunKind;
  model: string;
  flowId: string;
  onPickModel: (m: string) => void;
  onPickFlow: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<RunKind>(runKind);
  const activeLabel = runKind === 'agents'
    ? AGENT_FLOWS.find((f) => f.id === flowId)?.name ?? 'Agents'
    : model;
  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={() => { setTab(runKind); setOpen((v) => !v); }}
        style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
      >
        <span style={{ fontSize: 12, marginRight: 4 }}>{runKind === 'agents' ? '👥' : '⚡'}</span>
        <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 13, color: C.textSecondary, marginRight: 4, whiteSpace: 'nowrap' }}>{activeLabel}</span>
        <span style={{ fontSize: 13, color: C.textTertiary }}>▾</span>
      </div>
      {open ? (
        <div
          style={{
            position: 'absolute',
            zIndex: 10,
            right: 0,
            bottom: 26,
            width: 264,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            backgroundColor: C.bg,
            boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
            overflow: 'hidden',
          }}
        >
          {/* tab strip */}
          <div style={{ display: 'flex', padding: 4, gap: 4, borderBottom: `1px solid ${C.border}` }}>
            {([['model', '⚡ 直接模型'], ['agents', '👥 Agents']] as const).map(([k, t]) => (
              <div
                key={k}
                onClick={() => setTab(k)}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '5px 0',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  backgroundColor: tab === k ? C.primaryWash3 : 'transparent',
                  color: tab === k ? C.primary : C.textTertiary,
                }}
              >
                {t}
              </div>
            ))}
          </div>
          {/* tab body */}
          <div style={{ maxHeight: 280, overflow: 'auto', padding: '4px 0' }}>
            {tab === 'model'
              ? MODELS.map((m) => {
                  const picked = runKind === 'model' && m === model;
                  return (
                    <div
                      key={m}
                      onClick={() => { onPickModel(m); setOpen(false); }}
                      style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', cursor: 'pointer' }}
                    >
                      <span style={{ flex: 1, fontSize: 13, color: picked ? C.primary : C.text }}>{m}</span>
                      {picked ? <span style={{ fontSize: 12, color: C.primary }}>✓</span> : null}
                    </div>
                  );
                })
              : AGENT_FLOWS.map((f) => {
                  const picked = runKind === 'agents' && f.id === flowId;
                  return (
                    <div
                      key={f.id}
                      onClick={() => { onPickFlow(f.id); setOpen(false); }}
                      style={{ display: 'flex', alignItems: 'flex-start', padding: '7px 12px', cursor: 'pointer' }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: picked ? C.primary : C.text }}>
                          {f.name}
                          {f.batch === 1 ? (
                            <span style={{ fontSize: 10, color: C.success, marginLeft: 6, border: `1px solid ${C.success}`, borderRadius: 4, padding: '0 4px' }}>可切换</span>
                          ) : (
                            <span style={{ fontSize: 10, color: C.textQuaternary, marginLeft: 6, border: `1px solid ${C.border}`, borderRadius: 4, padding: '0 4px' }}>第二批</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 1 }}>{f.sub}</div>
                      </div>
                      {picked ? <span style={{ fontSize: 12, color: C.primary, marginLeft: 6 }}>✓</span> : null}
                    </div>
                  );
                })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AtelierPage({ runtime = DEFAULT_RUNTIME }: { runtime?: AtelierRuntime } = {}) {
  const initialSnapshot = runtime.getSnapshot();
  const [state, setState] = useState(initialSnapshot.state);
  const [selected, setSelected] = useState(initialSnapshot.selectedTaskId);
  const [pluginId, setPluginId] = useState(DEFAULT_PLUGIN_ID);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'work' | 'code' | 'design'>('work');
  const [runKind, setRunKind] = useState<RunKind>('agents');
  const [flowId, setFlowId] = useState(AGENT_FLOWS[0].id);
  const [railOpen, setRailOpen] = useState(true);
  const [railRightOpen, setRailRightOpen] = useState(true);
  const [preview, setPreview] = useState<Artifact | null>(null);

  const applySnapshot = useCallback((snapshot: AtelierRuntimeSnapshot) => {
    setState(snapshot.state);
    setSelected(snapshot.selectedTaskId);
  }, []);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = runtime.subscribe?.((snapshot) => {
      if (mounted) applySnapshot(snapshot);
    });
    void runtime.loadWorkspace().then((snapshot) => {
      if (mounted) applySnapshot(snapshot);
    });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [applySnapshot, runtime]);

  const stream = state.stream[selected] ?? [];
  const todos = state.todos[selected];
  const ctx = state.context[selected];
  const artifacts = state.artifacts[selected] ?? [];
  const selectedTask = state.tasks.find((t) => t.id === selected);
  const hasRightPanel = true;

  // selecting a task drops any open preview from the previous task
  const selectTask = (id: string) => {
    setSelected(id);
    setPreview(null);
  };

  const plugin = PLUGINS.find((p) => p.id === pluginId) ?? PLUGINS[0];

  // The shell owns the data; plugins only render + delegate lifecycle moves.
  const host: TaskHost = useMemo(
    () => ({
      tasks: state.tasks,
      selectedId: selected,
      select: (id) => selectTask(id),
      setStatus: (id, status: TaskStatus) =>
        void runtime.setTaskStatus({ taskId: id, status }).then(applySnapshot),
      purge: (id) => void runtime.purgeTask(id).then(applySnapshot),
      newTask: () => {
        setPreview(null);
        void runtime.createProjectFromGoal({
          goal: '新任务',
          project: selectedTask?.project ?? 'peers-touch',
          run: { kind: runKind, model: state.model, flowId },
        }).then(applySnapshot);
      },
    }),
    [applySnapshot, flowId, runKind, runtime, selected, selectedTask, state.model, state.tasks],
  );

  const choose = (blockId: string, opt: string) => {
    void runtime.resolveDecision({ taskId: selected, blockId, choice: opt }).then(applySnapshot);
  };

  const sendDraft = () => {
    const text = draft.trim();
    if (!text || !selected) return;
    setDraft('');
    void runtime.sendMessage({
      taskId: selected,
      text,
      run: { kind: runKind, model: state.model, flowId },
    }).then(applySnapshot);
  };

  const renderBlock = (b: Block) => {
    switch (b.kind) {
      case 'user': return <UserBubble key={b.id} m={b} />;
      case 'agent': return <AgentBubble key={b.id} m={b} />;
      case 'nego': {
        // If this task has an engine-independent position pool AND we are in
        // agents mode, render the LIVE engine-driven trace: switching the
        // engine in the composer re-runs the shared session state machine and
        // visibly reshapes the negotiation. Otherwise fall back to the static
        // folded nego row.
        const collab = COLLAB_INPUTS[selected];
        if (collab && runKind === 'agents') {
          return <EngineTrace key={b.id} input={collab} engineId={flowId} />;
        }
        return <NegoRow key={b.id} b={b} />;
      }
      case 'decision': return <DecisionCard key={b.id} b={b} onChoose={choose} />;
      case 'artifact': return <ArtifactCard key={b.id} b={b} />;
      case 'diff': return <DiffCard key={b.id} b={b} />;
    }
  };

  const budgetPct = Math.round((state.budgetSpent / state.budgetCap) * 100);
  const contentMax = preview
    ? 760
    : !railOpen && !railRightOpen
      ? 1040
      : !railOpen || !railRightOpen
        ? 920
        : 760;

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', overflow: 'hidden', backgroundColor: C.bg, color: C.text, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* ── Left rail ── */}
      {railOpen ? (
        <div
          style={{
            width: 'min(212px, 28%)',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            minHeight: 0,
            boxSizing: 'border-box',
            backgroundColor: C.fillQuaternary,
            borderRight: `1px solid ${C.border}`,
            padding: '10px 8px 8px',
          }}
        >
          <div style={{ height: 28, display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <PanelToggleButton side="left" open={railOpen} title="折叠左栏" onClick={() => setRailOpen(false)} />
          </div>

          {/* Work / Code mode toggle */}
          <div style={{ display: 'flex', padding: 2, backgroundColor: C.fillSecondary, borderRadius: 8, marginBottom: 10 }}>
            {(['work', 'code', 'design'] as const).map((m) => (
              <div
                key={m}
                onClick={() => setMode(m)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '5px 0',
                  borderRadius: 6,
                  backgroundColor: mode === m ? C.bg : 'transparent',
                  cursor: 'pointer',
                  boxShadow: mode === m ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 'bold', color: mode === m ? C.primary : C.textTertiary }}>
                  {m === 'work' ? 'Work' : m === 'code' ? '</> Code' : 'Design'}
                </span>
              </div>
            ))}
          </div>

          {/* global nav */}
          <div onClick={host.newTask} style={{ display: 'flex', alignItems: 'center', padding: '7px 8px', borderRadius: 6, cursor: 'pointer' }}>
            <span style={{ fontSize: 14, color: C.primary, marginRight: 8 }}>＋</span>
            <span style={{ fontSize: 13, color: C.textSecondary }}>New task</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', padding: '7px 8px', borderRadius: 6 }}>
            <span style={{ fontSize: 14, color: C.textTertiary, marginRight: 8 }}>✦</span>
            <span style={{ fontSize: 13, color: C.textSecondary }}>Skills</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', padding: '7px 8px', borderRadius: 6, marginBottom: 14 }}>
            <span style={{ fontSize: 14, color: C.textTertiary, marginRight: 8 }}>⏱</span>
            <span style={{ fontSize: 13, color: C.textSecondary }}>Automation</span>
          </div>

          {/* task list header + plugin switcher */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '10px 4px 6px' }}>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 'bold', color: C.textTertiary }}>Your Task List</span>
            <span style={{ fontSize: 13, color: C.textTertiary, marginRight: 8, cursor: 'pointer' }}>⌁</span>
            <span style={{ fontSize: 13, color: C.textTertiary, marginRight: 8, cursor: 'pointer' }}>≡</span>
            <Picker
              label=""
              options={PLUGINS.map((p) => ({ key: p.id, title: p.ready ? p.name : `${p.name}（计划中）`, sub: p.tagline }))}
              onPick={(key) => setPluginId(key)}
            />
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {plugin.render(host)}
          </div>

        </div>
      ) : null}

      {!railOpen ? (
        <div
          title="展开左栏"
          style={{
            width: 32,
            flexShrink: 0,
            minHeight: 0,
            backgroundColor: C.bg,
            borderRight: `1px solid ${C.border}`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '12px 0',
            boxSizing: 'border-box',
          }}
        >
          <PanelToggleButton side="left" open={railOpen} title="展开左栏" onClick={() => setRailOpen(true)} />
        </div>
      ) : null}

      {/* ── Centre: conversation ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        {/* top bar */}
        <div style={{ display: 'flex', alignItems: 'center', height: 40, flexShrink: 0, padding: '0 18px', borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontWeight: 'bold', fontSize: 13, marginRight: 8 }}>{selectedTask?.title}</span>
          <span style={{ fontSize: 12, color: C.textQuaternary, marginRight: 4 }}>▻</span>
          <span style={{ fontSize: 12, color: C.textTertiary, marginRight: 4 }}>{selectedTask?.project}</span>
          <span style={{ fontSize: 12, color: C.textQuaternary }}>· 11:18</span>
          <div style={{ flex: 1 }} />
          <span style={{ height: 28, display: 'inline-flex', alignItems: 'center', border: `1px solid ${C.border}`, borderRadius: 8, padding: '0 10px', fontSize: 12, color: C.textSecondary, marginRight: 10 }}>
            Open in <span style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: '#10b981', marginLeft: 6 }} />
            <span style={{ marginLeft: 8, color: C.textTertiary }}>⌄</span>
          </span>
          <span style={{ fontSize: 16, color: C.textTertiary, marginRight: 16 }}>□</span>
          <span style={{ fontSize: 16, color: C.textTertiary }}>☰</span>
        </div>

        {/* stream */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '18px 24px 0' }}>
          <div style={{ width: `min(${contentMax}px, 100%)`, margin: '0 auto' }}>
            {stream.length === 0 ? (
              <div style={{ color: C.textQuaternary, fontSize: 13, textAlign: 'center', marginTop: 80 }}>
                交给 Atelier 一个目标，它会拆解、协商、推进。
              </div>
            ) : null}
            {stream.map(renderBlock)}
          </div>
        </div>

        {/* composer */}
        <div style={{ flexShrink: 0, padding: '12px 24px 12px' }}>
          <ArtifactsTray artifacts={artifacts} openId={preview?.id} maxWidth={contentMax} onOpen={(a) => setPreview(a)} />
          <PromptComposer
            value={draft}
            onChange={setDraft}
            maxWidth={contentMax}
            density="compact"
            placeholder="Help you write code, debugs, optimize performance and other development work, deliver production-ready code."
            modelNode={
              <>
                <RunPicker
                  runKind={runKind}
                  model={state.model}
                  flowId={flowId}
                  onPickModel={(m) => {
                    setRunKind('model');
                    void runtime.setModel(m).then(applySnapshot);
                  }}
                  onPickFlow={(id) => { setRunKind('agents'); setFlowId(id); }}
                />
              </>
            }
            onSend={sendDraft}
            sendDisabled={!draft.trim()}
          />
        </div>
      </div>

      {/* ── Right panel: preview (when an artifact is open) or Todo + Context ── */}
      {preview ? (
        <div style={{ width: 460, flexShrink: 0, minHeight: 0, display: 'flex', backgroundColor: C.bg, borderLeft: `1px solid ${C.border}`, overflow: 'hidden' }}>
          <PreviewPanel artifact={preview} onClose={() => setPreview(null)} />
        </div>
      ) : hasRightPanel ? (
        railRightOpen ? (
          <div
            style={{ width: 'min(226px, 30%)', flexShrink: 0, minHeight: 0, boxSizing: 'border-box', overflow: 'auto', backgroundColor: C.bg, borderLeft: `1px solid ${C.border}`, padding: '14px 16px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 4 }}>
              <PanelToggleButton side="right" open={railRightOpen} title="折叠右栏" onClick={() => setRailRightOpen(false)} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontWeight: 'bold', fontSize: 13 }}>Todo</span>
              </div>
              {todos && todos.length > 0 ? (
                <>{todos.map((t) => <TodoRow key={t.id} t={t} />)}</>
              ) : (
                <div style={{ height: 126, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderBottom: `1px solid ${C.border}`, color: C.textQuaternary, textAlign: 'center' }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>☷</div>
                  <div style={{ fontSize: 13, fontWeight: 'bold', color: C.textTertiary }}>No todos yet</div>
                  <div style={{ fontSize: 12, lineHeight: '18px', maxWidth: 170 }}>Progress for complex tasks will appear here</div>
                </div>
              )}
            </div>
            {ctx ? <ContextPanel ctx={ctx} /> : null}
          </div>
        ) : (
          <div
            title="展开 Todo + Context"
            style={{
              width: 32,
              flexShrink: 0,
              minHeight: 0,
              backgroundColor: C.bg,
              borderLeft: `1px solid ${C.border}`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '12px 0',
            }}
          >
            <PanelToggleButton side="right" open={railRightOpen} title="展开右栏" onClick={() => setRailRightOpen(true)} />
          </div>
        )
      ) : null}
    </div>
  );
}
