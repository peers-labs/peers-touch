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
import { useMemo, useState } from 'react';
import { C, ROLE_COLOR } from './theme';
import { MOCK } from './mock';
import type { Block, TodoItem, TaskHost, TaskStatus, TaskContext, Artifact } from './types';
import { UserBubble, AgentBubble, NegoRow, DecisionCard, ArtifactCard, DiffCard } from './blocks';
import { ArtifactsTray, PreviewPanel } from './preview';
import { PLUGINS, DEFAULT_PLUGIN_ID } from './plugins';

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
 * for Atelier — Atelier is just one agent that consumes it). The engine is not
 * a fixed set of N forms; the entries below are the orchestration patterns the
 * user can pick from (roundtable brainstorm, consensus-by-judge, edict-style
 * hierarchy, …) and the list is open-ended.
 */
const AGENT_FLOWS: { id: string; name: string; sub: string }[] = [
  { id: 'roundtable', name: 'Roundtable 圆桌', sub: '方案发散 / 头脑风暴 · 主持人收敛' },
  { id: 'debate-judge', name: 'Debate Judge 辩论裁决', sub: '多方案冲突 · Judge 裁决达成共识' },
  { id: 'expert-mesh', name: 'Expert Mesh 专家网', sub: '能力互补并行 · 聚合器合并' },
  { id: 'swarm', name: 'Swarm 蜂群', sub: '海量同构并行 · 结果归约 + 多数' },
  { id: 'hierarchy', name: 'Hierarchy 层级（edict）', sub: '长流程强秩序 · 上级签字下令' },
  { id: 'expert-hierarchy', name: 'Expert Hierarchy（默认）', sub: '长流程 + 能力互补 · 终裁签字 + 无未决反对' },
];

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
        <span style={{ fontSize: 12, color: C.textSecondary, marginRight: 3 }}>{label}</span>
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
        <span style={{ fontSize: 12, color: C.textSecondary, marginRight: 3 }}>{activeLabel}</span>
        <span style={{ fontSize: 11, color: C.textTertiary }}>▾</span>
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
                        <div style={{ fontSize: 13, color: picked ? C.primary : C.text }}>{f.name}</div>
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

export function AtelierPage() {
  const [state, setState] = useState(MOCK);
  const [selected, setSelected] = useState(state.selectedTaskId);
  const [pluginId, setPluginId] = useState(DEFAULT_PLUGIN_ID);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'work' | 'code'>('work');
  const [runKind, setRunKind] = useState<RunKind>('agents');
  const [flowId, setFlowId] = useState(AGENT_FLOWS[AGENT_FLOWS.length - 1].id);
  const [railOpen, setRailOpen] = useState(true);
  const [preview, setPreview] = useState<Artifact | null>(null);

  const stream = state.stream[selected] ?? [];
  const todos = state.todos[selected];
  const ctx = state.context[selected];
  const artifacts = state.artifacts[selected] ?? [];
  const selectedTask = state.tasks.find((t) => t.id === selected);
  const hasRightPanel = (todos && todos.length > 0) || !!ctx;

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
        setState((s) => ({
          ...s,
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, status, running: status === 'active' ? t.running : false } : t)),
        })),
      purge: (id) => setState((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== id) })),
      newTask: () => {
        const id = `t-${Date.now()}`;
        const project = selectedTask?.project ?? 'peers-touch';
        setState((s) => ({
          ...s,
          tasks: [{ id, project, title: '新任务', status: 'active' }, ...s.tasks],
          stream: { ...s.stream, [id]: [] },
        }));
        setSelected(id);
        setPreview(null);
      },
    }),
    [state.tasks, selected, selectedTask],
  );

  const choose = (blockId: string, opt: string) => {
    setState((s) => ({
      ...s,
      stream: {
        ...s.stream,
        [selected]: (s.stream[selected] ?? []).map((b) =>
          b.kind === 'decision' && b.id === blockId ? { ...b, chosen: opt } : b,
        ),
      },
    }));
  };

  const renderBlock = (b: Block) => {
    switch (b.kind) {
      case 'user': return <UserBubble key={b.id} m={b} />;
      case 'agent': return <AgentBubble key={b.id} m={b} />;
      case 'nego': return <NegoRow key={b.id} b={b} />;
      case 'decision': return <DecisionCard key={b.id} b={b} onChoose={choose} />;
      case 'artifact': return <ArtifactCard key={b.id} b={b} />;
      case 'diff': return <DiffCard key={b.id} b={b} />;
    }
  };

  const budgetPct = Math.round((state.budgetSpent / state.budgetCap) * 100);

  return (
    <div style={{ height: '100%', display: 'flex', backgroundColor: C.bg, color: C.text, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* ── Left rail ── */}
      {railOpen ? (
        <div
          style={{
            width: 256,
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: C.fillQuaternary,
            borderRight: `1px solid ${C.border}`,
            padding: '14px 10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', padding: '0 4px 12px' }}>
            <span style={{ fontWeight: 'bold', fontSize: 15, marginRight: 8 }}>Atelier</span>
            <span style={{ flex: 1, fontSize: 11, color: C.textTertiary }}>多 Agent 协作工作台</span>
            <span onClick={() => setRailOpen(false)} style={{ fontSize: 14, color: C.textQuaternary, cursor: 'pointer' }}>⟨</span>
          </div>

          {/* Work / Code mode toggle */}
          <div style={{ display: 'flex', padding: 3, backgroundColor: C.primaryWash3, borderRadius: 9, marginBottom: 12 }}>
            {(['work', 'code'] as const).map((m) => (
              <div
                key={m}
                onClick={() => setMode(m)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '5px 0',
                  borderRadius: 7,
                  backgroundColor: mode === m ? C.bg : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 'bold', color: mode === m ? C.primary : C.textTertiary }}>
                  {m === 'work' ? 'Work' : 'Code'}
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
          <div style={{ display: 'flex', alignItems: 'center', padding: '0 8px 6px' }}>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 'bold', color: C.textTertiary }}>Your Task List</span>
            <Picker
              label={plugin.name}
              options={PLUGINS.map((p) => ({ key: p.id, title: p.ready ? p.name : `${p.name}（计划中）`, sub: p.tagline }))}
              onPick={(key) => setPluginId(key)}
            />
          </div>

          <div style={{ flex: 1, overflow: 'auto' }}>
            {plugin.render(host)}
          </div>

          {/* peers footer — the Agent peers collaborating in this workspace */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '10px 6px 0', borderTop: `1px solid ${C.borderSoft}`, marginTop: 8 }}>
            <div style={{ display: 'flex', marginRight: 8 }}>
              {PEERS.map((p, i) => (
                <div
                  key={p.label}
                  title={p.role}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor: ROLE_COLOR[p.role],
                    border: `2px solid ${C.fillQuaternary}`,
                    marginLeft: i === 0 ? 0 : -8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span style={{ color: C.white, fontSize: 11, fontWeight: 'bold' }}>{p.label}</span>
                </div>
              ))}
            </div>
            <span style={{ flex: 1, fontSize: 12, color: C.textSecondary }}>9 个 Agent peer 协作中</span>
          </div>
        </div>
      ) : null}

      {/* ── Centre: conversation ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* top bar */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 24px', borderBottom: `1px solid ${C.border}` }}>
          {!railOpen ? (
            <span onClick={() => setRailOpen(true)} style={{ fontSize: 16, color: C.textTertiary, marginRight: 12, cursor: 'pointer' }}>⟩</span>
          ) : null}
          <span style={{ fontWeight: 'bold', marginRight: 12 }}>{selectedTask?.title}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', backgroundColor: C.primaryWash, borderRadius: 6, padding: '2px 8px', marginRight: 12, fontSize: 12, color: C.textTertiary }}>
            🗂 {selectedTask?.project}
          </span>
          {selectedTask?.branch ? (
            <span style={{ fontSize: 12, color: C.textTertiary, marginRight: 12 }}>⎇ {selectedTask.branch}</span>
          ) : null}
          {runKind === 'agents' ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', marginRight: 12 }}>
              <span style={{ display: 'flex', marginRight: 6 }}>
                {PEERS.slice(0, 4).map((p, i) => (
                  <span
                    key={p.label}
                    title={p.role}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 9,
                      backgroundColor: ROLE_COLOR[p.role],
                      border: `1.5px solid ${C.bg}`,
                      marginLeft: i === 0 ? 0 : -6,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <span style={{ color: C.white, fontSize: 9, fontWeight: 'bold' }}>{p.label}</span>
                  </span>
                ))}
              </span>
              <span style={{ fontSize: 12, color: C.textTertiary }}>
                {AGENT_FLOWS.find((f) => f.id === flowId)?.name} · 多 Agent 协作中
              </span>
            </span>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', marginRight: 12, fontSize: 12, color: C.textTertiary }}>
              ⚡ 直连 {state.model}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: C.primary, marginRight: 12, cursor: 'pointer' }}>↗ Open in IDE</span>
          <span style={{ fontSize: 12, color: C.textTertiary, marginRight: 6 }}>预算</span>
          <Bar pct={budgetPct} danger={budgetPct > 80} width={90} />
          <span style={{ fontSize: 12, marginLeft: 8 }}>${state.budgetSpent}/${state.budgetCap}</span>
        </div>

        {/* stream */}
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 24px 0' }}>
          <div style={{ maxWidth: 760 }}>
            {stream.length === 0 ? (
              <div style={{ color: C.textQuaternary, fontSize: 13, textAlign: 'center', marginTop: 80 }}>
                交给 Atelier 一个目标，它会拆解、协商、推进。
              </div>
            ) : null}
            {stream.map(renderBlock)}
          </div>
        </div>

        {/* composer */}
        <div style={{ padding: '12px 24px 20px', borderTop: `1px solid ${C.border}` }}>
          <ArtifactsTray artifacts={artifacts} openId={preview?.id} onOpen={(a) => setPreview(a)} />
          <div
            style={{
              maxWidth: 760,
              border: `1px solid ${C.border}`,
              borderRadius: 14,
              padding: 10,
              backgroundColor: C.bg,
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={runKind === 'agents'
                ? `交给 ${AGENT_FLOWS.find((f) => f.id === flowId)?.name}：描述目标，多 Agent 协作流会协商、拆解、推进`
                : `直接交给 ${state.model}：描述需求，单模型/CLI 直答，不走协商`}
              style={{ width: '100%', boxSizing: 'border-box', border: 'none', outline: 'none', fontSize: 14, padding: '2px 4px', height: 24, backgroundColor: 'transparent' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 6 }}>
              <span style={{ fontSize: 15, color: C.textTertiary, marginRight: 10 }}>/</span>
              <span style={{ fontSize: 15, color: C.textTertiary }}>＋</span>
              <div style={{ flex: 1 }} />
              {/* one merged dropdown: tab "直接模型" picks a model/CLI, tab "Agents" picks a collaboration flow */}
              <div style={{ marginRight: 10 }}>
                <RunPicker
                  runKind={runKind}
                  model={state.model}
                  flowId={flowId}
                  onPickModel={(m) => { setRunKind('model'); setState((s) => ({ ...s, model: m })); }}
                  onPickFlow={(id) => { setRunKind('agents'); setFlowId(id); }}
                />
              </div>
              <div style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: C.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <span style={{ color: C.white, fontSize: 15 }}>↑</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right panel: preview (when an artifact is open) or Todo + Context ── */}
      {preview ? (
        <div style={{ width: 460, display: 'flex', backgroundColor: C.bg, borderLeft: `1px solid ${C.border}`, overflow: 'hidden' }}>
          <PreviewPanel artifact={preview} onClose={() => setPreview(null)} />
        </div>
      ) : hasRightPanel ? (
        <div
          style={{ width: 272, overflow: 'auto', backgroundColor: C.bg, borderLeft: `1px solid ${C.border}`, padding: '16px 18px' }}
        >
          {todos && todos.length > 0 ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 15, marginRight: 6 }}>☑</span>
                <span style={{ fontWeight: 'bold' }}>Todo</span>
              </div>
              {todos.map((t) => <TodoRow key={t.id} t={t} />)}
            </div>
          ) : null}
          {ctx ? <ContextPanel ctx={ctx} /> : null}
        </div>
      ) : null}
    </div>
  );
}
