/**
 * peers-touch Desktop — Agent management / edit surface (prototype).
 *
 * Rebuilt to a single-Agent configuration page,
 * not a thin profile form. Mirrors the LobeHub blueprint
 * (docs/architecture/agent/agent-lobehub-blueprint.md P3-1: Agent Profile split
 * into understandable tabs; §7.1 Desktop Web owns Agent Profile/Settings).
 *
 * Three columns:
 *   - left  : My Agents roster (pinned + all) + new
 *   - center: the selected Agent's editor
 *       · identity   — avatar + A2A description (with an inline ✨ AI icon
 *                      that rewrites the description; the placeholder carries
 *                      the guidance, no separate tip block)
 *       · compose row — Provider → Model · effort
 *                       (a provider may be a direct LLM endpoint or a reused
 *                        CLI Agent — Codex / Claude Code / Trae — that still
 *                        drives a selected model, P5-3)
 *       · Configure / Activity modes
 *           Configure: SOUL/AGENTS · Capabilities (Skills + Tools) · Workspace
 *           Activity : Tasks · Memories · Agent Events (read-only projection)
 *   - right : Agent Builder — a chat-style assistant that turns a use case into
 *             a runnable Agent (so you don't hand-write everything).
 *
 * Boundary note (carried from the prior discussion): the provider/model here is
 * the Agent's own brain. CLI-wrapped providers are just reused ecosystem Agents
 * acting as a provider. None of this is the atelier multi-agent *collaboration*
 * engine (EnginePolicy), which is decided by the collaboration runtime per task
 * and must not live on an Agent.
 *
 * Standalone web prototype: mock-data only, no real store / kernel / tauri.
 */
import { useMemo, useState } from 'react';
import {
  Bot,
  Plus,
  Pin,
  Sparkles,
  Upload,
  Play,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  PanelRightClose,
  PanelRightOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Folder,
  FileText,
  Wrench,
  ScrollText,
  Clock,
  Brain,
  Radio,
  Copy,
  type LucideIcon,
} from 'lucide-react';
import { T } from './theme';

// ── domain (mock) ──────────────────────────────────────────────────────────

/**
 * The "model + agent" composition (per execution-plan P3-3 Model/Provider):
 * an Agent (persona / skills / tools / memory / workspace) is paired with a
 * Provider → Model. Station TurnService runs the turn loop.
 *
 * A provider is either a direct LLM endpoint (OpenAI-compatible / Anthropic /
 * Ollama) or a CLI-wrapped heterogeneous Agent we reuse from the ecosystem
 * (Codex / Claude Code / Trae, per P5-3). Either way you still pick the LLM the
 * provider drives — the CLI is just another way to reach a model.
 */
interface ModelOption {
  id: string;
  name: string;
}

interface Provider {
  id: string;
  name: string;
  /** cli-wrapped heterogeneous agent reused as a provider (P5-3) */
  cli?: boolean;
  models: ModelOption[];
}

/**
 * Provider catalog (mock). Direct LLM endpoints first, then CLI-wrapped agents
 * we reuse from the ecosystem — each still drives a selectable model.
 */
const PROVIDERS: Provider[] = [
  {
    id: 'openai',
    name: 'OpenAI-compatible',
    models: [
      { id: 'gpt-5.4', name: 'gpt-5.4' },
      { id: 'gpt-5.4-mini', name: 'gpt-5.4-mini' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: [
      { id: 'claude-sonnet', name: 'claude-sonnet' },
      { id: 'claude-haiku', name: 'claude-haiku' },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    models: [
      { id: 'qwen-max', name: 'qwen-max' },
      { id: 'deepseek-v3', name: 'deepseek-v3' },
    ],
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    cli: true,
    models: [
      { id: 'gpt-5.4', name: 'gpt-5.4' },
      { id: 'gpt-5.4-mini', name: 'gpt-5.4-mini' },
    ],
  },
  {
    id: 'claude-code',
    name: 'Claude Code CLI',
    cli: true,
    models: [
      { id: 'claude-sonnet', name: 'claude-sonnet' },
      { id: 'claude-haiku', name: 'claude-haiku' },
    ],
  },
  {
    id: 'trae',
    name: 'Trae CLI',
    cli: true,
    models: [
      { id: 'gpt-5.4', name: 'gpt-5.4' },
      { id: 'claude-sonnet', name: 'claude-sonnet' },
    ],
  },
];

/** Reasoning / effort levels. */
const EFFORTS: string[] = ['Low', 'Medium', 'High'];

/** Skill = reusable capability package. MCP is NOT a skill — it lives in Tools. */
type SkillKind = 'script' | 'prompt';

interface Skill {
  id: string;
  name: string;
  kind: SkillKind;
  source: string;
  enabled: boolean;
  desc: string;
}

interface Tool {
  id: string;
  name: string;
  /** transport / origin, e.g. mcp:stdio / builtin */
  origin: string;
  enabled: boolean;
}

interface Agent {
  id: string;
  name: string;
  /** emoji / monogram for the avatar tile */
  glyph: string;
  pinned: boolean;
  status: 'enabled' | 'draft';
  /** A2A self-description: used to route the right agent */
  description: string;
  /** provider/model pairing (the "model + agent" composition) */
  providerId: string;
  model: string;
  effort: string;
  /** workspace */
  workspacePath: string;
  isolation: boolean;
  isolationMode: 'shared' | 'independent';
  isolationDays: number;
  /** SOUL.md / AGENTS.md bodies (system-prompt assembly) */
  soul: string;
  agentsMd: string;
  skills: Skill[];
  tools: Tool[];
}

const SKILL_KIND_LABEL: Record<SkillKind, string> = {
  script: '脚本',
  prompt: 'Prompt 技能',
};

const KIND_COLOR: Record<SkillKind, string> = {
  script: '#722ed1',
  prompt: '#1677ff',
};

const INITIAL_AGENTS: Agent[] = [
  {
    id: 'a-research',
    name: '科研助理',
    glyph: '🔬',
    pinned: true,
    status: 'enabled',
    description: '帮你检索文献、梳理论证脉络、整理实验记录与综述提纲。',
    providerId: 'anthropic',
    model: 'claude-sonnet',
    effort: 'Medium',
    workspacePath: '/home/me/.peers-touch/workspace/research',
    isolation: true,
    isolationMode: 'independent',
    isolationDays: 7,
    soul: '# SOUL.md\n\n## Identity\n你是一名严谨的科研助理，重证据、重出处，不臆测结论。',
    agentsMd: '# AGENTS.md\n\n你负责文献检索与论证梳理，引用必须可追溯，结论标注置信度。',
    skills: [],
    tools: [],
  },
  {
    id: 'a-writing',
    name: '写作伙伴',
    glyph: '✍️',
    pinned: false,
    status: 'enabled',
    description: '协助起草、润色与改写，把零散素材整理成结构清晰的文稿。',
    providerId: 'openai',
    model: 'gpt-5.4',
    effort: 'Medium',
    workspacePath: '/home/me/.peers-touch/workspace/writing',
    isolation: false,
    isolationMode: 'shared',
    isolationDays: 7,
    soul: '# SOUL.md\n\n## Identity\n你是务实的写作伙伴，语气自然、以可读性为先。',
    agentsMd:
      '# AGENTS.md\n\n你把零散素材整理成结构清晰的文稿，先列提纲再展开，保留作者原意。',
    skills: [
      { id: 's-summ', name: 'meeting-digest', kind: 'prompt', source: 'github://peers/skills/meeting-digest', enabled: true, desc: '把会议纪要压缩成可跟踪的行动项。' },
      { id: 's-trans', name: 'translate-pro', kind: 'prompt', source: 'github://peers/skills/translate-pro', enabled: true, desc: '保留术语与语气的高质量翻译。' },
    ],
    tools: [
      { id: 't-read', name: 'read_file', origin: 'builtin', enabled: true },
      { id: 't-fs', name: 'filesystem', origin: 'mcp:stdio · integrated_browser', enabled: true },
      { id: 't-web', name: 'web_search', origin: 'mcp:http', enabled: true },
      { id: 't-shell', name: 'run_shell', origin: 'builtin', enabled: false },
    ],
  },
  {
    id: 'a-data',
    name: '数据分析师',
    glyph: '📊',
    pinned: false,
    status: 'draft',
    description: '协助清洗数据、跑统计与可视化，给出可解释的分析结论。',
    providerId: 'codex',
    model: 'gpt-5.4',
    effort: 'High',
    workspacePath: '/home/me/.peers-touch/workspace/data',
    isolation: true,
    isolationMode: 'independent',
    isolationDays: 14,
    soul: '# SOUL.md\n\n## Identity\n你是数据分析师，先问清口径再动手，结论必须可复现。',
    agentsMd: '# AGENTS.md\n\n你负责数据清洗、统计与可视化，输出附计算口径与样本范围。',
    skills: [],
    tools: [],
  },
];

// ── small UI atoms ──────────────────────────────────────────────────────────

function Pill({ text, color, soft }: { text: string; color: string; soft?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 11,
        padding: '1px 7px',
        borderRadius: 5,
        color: soft ? color : T.white,
        backgroundColor: soft ? 'transparent' : color,
        border: soft ? `1px solid ${color}` : 'none',
      }}
    >
      {text}
    </span>
  );
}

function Select({
  value,
  options,
  onChange,
  width,
}: {
  value: string;
  options: { id: string; label: string }[];
  onChange: (v: string) => void;
  width?: number | string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width,
        height: 36,
        boxSizing: 'border-box',
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        padding: '0 10px',
        fontSize: 13,
        color: T.text,
        backgroundColor: T.bg,
        outline: 'none',
        cursor: 'pointer',
      }}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 13,
  outline: 'none',
  color: T.text,
  backgroundColor: T.bg,
};

const monoStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
  lineHeight: '18px',
};

// ── tabs ─────────────────────────────────────────────────────────────────────
//
// Information architecture (per design review): the editor mixes two different
// axes — "what this Agent IS" (configuration) vs "what this Agent DID" (runtime
// observation). They are split into two top-level modes so the configuration
// surface stays focused and read-only runtime data never masquerades as editable.
//
//   Configure : SOUL/AGENTS · Capabilities (Skills + Tools) · Workspace
//   Activity  : Tasks · Memories · Agent Events  (observation only)

type Mode = 'configure' | 'activity';
type ConfigTab = 'soul' | 'capabilities' | 'workspace';
type ActivityTab = 'tasks' | 'memories' | 'events';

const CONFIG_TABS: { id: ConfigTab; label: string; icon: LucideIcon }[] = [
  { id: 'soul', label: 'SOUL / AGENTS', icon: ScrollText },
  { id: 'capabilities', label: 'Capabilities', icon: Wrench },
  { id: 'workspace', label: 'Workspace', icon: Folder },
];

const ACTIVITY_TABS: { id: ActivityTab; label: string; icon: LucideIcon }[] = [
  { id: 'tasks', label: 'Tasks', icon: Clock },
  { id: 'memories', label: 'Memories', icon: Brain },
  { id: 'events', label: 'Agent Events', icon: Radio },
];

function SoulTab({ agent, onPatch }: { agent: Agent; onPatch: (p: Partial<Agent>) => void }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ flex: 1, fontSize: 12, color: T.textTertiary }}>
          两段内容分别同步到 AGENTS.md / SOUL.md，并在新会话中注入（系统提示装配）。
        </span>
        <span style={{ fontSize: 12, color: T.textTertiary }}>改动自动保存</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.textSecondary, marginBottom: 6 }}>AGENTS.md</div>
          <textarea
            value={agent.agentsMd}
            onChange={(e) => onPatch({ agentsMd: e.target.value })}
            rows={10}
            style={{ ...inputStyle, ...monoStyle, resize: 'vertical' }}
          />
          <div style={{ fontSize: 11, color: T.textTertiary, marginTop: 6 }}>
            对应会话工作区的 AGENTS.md：持久指令、范围、工作流、护栏。
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.textSecondary, marginBottom: 6 }}>SOUL.md</div>
          <textarea
            value={agent.soul}
            onChange={(e) => onPatch({ soul: e.target.value })}
            rows={10}
            style={{ ...inputStyle, ...monoStyle, resize: 'vertical' }}
          />
          <div style={{ fontSize: 11, color: T.textTertiary, marginTop: 6 }}>
            对应 SOUL.md：身份、语气、风格与长期偏好。
          </div>
        </div>
      </div>
    </div>
  );
}

function CapabilitiesTab({ agent, onPatch }: { agent: Agent; onPatch: (p: Partial<Agent>) => void }) {
  const [importing, setImporting] = useState(false);
  const [imp, setImp] = useState<{ name: string; kind: SkillKind; source: string }>({ name: '', kind: 'prompt', source: '' });

  const patchSkill = (id: string, p: Partial<Skill>) =>
    onPatch({ skills: agent.skills.map((s) => (s.id === id ? { ...s, ...p } : s)) });
  const removeSkill = (id: string) => onPatch({ skills: agent.skills.filter((s) => s.id !== id) });
  const patchTool = (id: string, p: Partial<Tool>) =>
    onPatch({ tools: agent.tools.map((t) => (t.id === id ? { ...t, ...p } : t)) });

  const doImport = () => {
    if (!imp.name.trim()) return;
    const skill: Skill = {
      id: `s-${Date.now()}`,
      name: imp.name.trim(),
      kind: imp.kind,
      source: imp.source.trim() || `${imp.kind}://${imp.name.trim()}`,
      enabled: true,
      desc: '（导入后请补充说明）',
    };
    onPatch({ skills: [...agent.skills, skill] });
    setImporting(false);
    setImp({ name: '', kind: 'prompt', source: '' });
  };

  return (
    <div>
      {/* — Skills: reusable capability packages (prompt / script / MCP) — */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Skills</div>
          <div style={{ fontSize: 12, color: T.textTertiary, marginTop: 2 }}>
            可复用能力包（Prompt / 脚本 / MCP）。导入并绑定到该 Agent，不含能力市场。
          </div>
        </div>
        <div
          onClick={() => setImporting((v) => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, backgroundColor: T.primary, color: T.white, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          <Upload size={15} /> 导入 Skill
        </div>
      </div>

      {importing ? (
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, marginBottom: 14, backgroundColor: T.fillQuaternary }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            {(['prompt', 'script'] as SkillKind[]).map((k) => (
              <div
                key={k}
                onClick={() => setImp((s) => ({ ...s, kind: k }))}
                style={{ padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px solid ${imp.kind === k ? KIND_COLOR[k] : T.border}`, color: imp.kind === k ? KIND_COLOR[k] : T.textSecondary, backgroundColor: T.bg }}
              >
                {SKILL_KIND_LABEL[k]}
              </div>
            ))}
          </div>
          <input value={imp.name} onChange={(e) => setImp((s) => ({ ...s, name: e.target.value }))} placeholder="技能名（必填）" style={{ ...inputStyle, marginBottom: 8 }} />
          <input value={imp.source} onChange={(e) => setImp((s) => ({ ...s, source: e.target.value }))} placeholder="来源（URL / 路径 / MCP server，可留空自动生成）" style={{ ...inputStyle, marginBottom: 12 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <div onClick={doImport} style={{ padding: '6px 14px', borderRadius: 8, backgroundColor: T.primary, color: T.white, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>导入</div>
            <div onClick={() => setImporting(false)} style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${T.border}`, color: T.textSecondary, fontSize: 13, cursor: 'pointer' }}>取消</div>
          </div>
        </div>
      ) : null}

      {agent.skills.length === 0 ? (
        <div style={{ padding: '28px 0', textAlign: 'center', color: T.textQuaternary, fontSize: 13 }}>还没有技能，点右上角「导入 Skill」。</div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {agent.skills.map((s) => (
            <div key={s.id} style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Pill text={SKILL_KIND_LABEL[s.kind]} color={KIND_COLOR[s.kind]} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: T.text }}>{s.name}</span>
                <span style={{ display: 'block', fontSize: 11, color: T.textTertiary }}>{s.source} · {s.desc}</span>
              </span>
              <Toggle on={s.enabled} onClick={() => patchSkill(s.id, { enabled: !s.enabled })} />
              <Trash2 size={15} color={T.textTertiary} style={{ cursor: 'pointer' }} onClick={() => removeSkill(s.id)} />
            </div>
          ))}
        </div>
      )}

      {/* — Tools: atomic tool / MCP-server toggles the Agent may call — */}
      <div style={{ marginTop: 26, marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Tools</div>
        <div style={{ fontSize: 12, color: T.textTertiary, marginTop: 2 }}>
          该 Agent 可调用的原子工具 / MCP server 开关。每次调用都经过策略检查与审计（架构蓝本 §6.5）。
        </div>
      </div>
      {agent.tools.length === 0 ? (
        <div style={{ padding: '28px 0', textAlign: 'center', color: T.textQuaternary, fontSize: 13 }}>暂无工具绑定。</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {agent.tools.map((tl) => (
            <div key={tl.id} style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Wrench size={15} color={T.textTertiary} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', color: T.text, ...monoStyle, fontSize: 13, fontWeight: 700 }}>{tl.name}</span>
                <span style={{ display: 'block', fontSize: 11, color: T.textTertiary }}>{tl.origin}</span>
              </span>
              <Toggle on={tl.enabled} onClick={() => patchTool(tl.id, { enabled: !tl.enabled })} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkspaceTab({ agent, onPatch }: { agent: Agent; onPatch: (p: Partial<Agent>) => void }) {
  const [advanced, setAdvanced] = useState(false);
  return (
    <div style={{ maxWidth: 720 }}>
      {/* workspace path */}
      <div style={{ fontSize: 12, fontWeight: 700, color: T.textSecondary, marginBottom: 6 }}>Workspace path</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 12px', marginBottom: 20 }}>
        <Folder size={15} color={T.textTertiary} />
        <span style={{ flex: 1, ...monoStyle, color: T.textSecondary }}>{agent.workspacePath}</span>
        <Copy size={14} color={T.textTertiary} style={{ cursor: 'pointer' }} />
      </div>

      {/* workspace isolation (moved here from the main area per request) */}
      <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <Folder size={18} color={T.textSecondary} style={{ marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Workspace Isolation</div>
            <div style={{ fontSize: 12, color: T.textTertiary, marginTop: 2 }}>新话题可以在临时的 Workspace 副本里运行。</div>
          </div>
          {agent.isolation ? <Pill text="isolation ready" color="#389e0d" soft /> : null}
          <Toggle on={agent.isolation} onClick={() => onPatch({ isolation: !agent.isolation })} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, opacity: agent.isolation ? 1 : 0.45, pointerEvents: agent.isolation ? 'auto' : 'none' }}>
          {(['shared', 'independent'] as const).map((m) => (
            <div
              key={m}
              onClick={() => onPatch({ isolationMode: m })}
              style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px solid ${agent.isolationMode === m ? T.primary : T.border}`, color: agent.isolationMode === m ? T.primary : T.textSecondary, backgroundColor: agent.isolationMode === m ? T.primaryWash : T.bg }}
            >
              {m === 'shared' ? 'Shared Workspace' : 'Independent Workspace'}
            </div>
          ))}
          <input
            type="number"
            value={agent.isolationDays}
            onChange={(e) => onPatch({ isolationDays: Number(e.target.value) || 0 })}
            style={{ ...inputStyle, width: 80 }}
          />
          <span style={{ fontSize: 13, color: T.textTertiary }}>days</span>
        </div>

        <div onClick={() => setAdvanced((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 14, fontSize: 13, color: T.textSecondary, cursor: 'pointer' }}>
          {advanced ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Advanced Settings
        </div>
        {advanced ? (
          <div style={{ marginTop: 10, padding: 12, borderRadius: 8, backgroundColor: T.fillQuaternary, fontSize: 12, color: T.textTertiary, lineHeight: '18px' }}>
            副本清理策略、保留份数、写回主工作区的规则等高级项（原型占位）。
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ActivityPlaceholder({ label, hint }: { label: string; hint: string }) {
  return (
    <div style={{ border: `1px dashed ${T.border}`, borderRadius: 12, padding: '40px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: T.textSecondary, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 12, color: T.textTertiary, lineHeight: '18px', maxWidth: 460, margin: '0 auto' }}>{hint}</div>
      <div style={{ marginTop: 12, display: 'inline-block', padding: '3px 10px', borderRadius: 6, fontSize: 11, color: T.textTertiary, backgroundColor: T.fillQuaternary }}>
        只读 · 运行时投影（原型占位）
      </div>
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <span
      onClick={onClick}
      style={{ width: 36, height: 20, borderRadius: 10, flexShrink: 0, backgroundColor: on ? T.primary : T.fillTertiary, position: 'relative', cursor: 'pointer', transition: 'background-color .15s' }}
    >
      <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: 8, backgroundColor: T.white, transition: 'left .15s' }} />
    </span>
  );
}

// ── compose row: the "model + agent" composition ─────────────────────────────
//
// Primary axis = Provider → Model (P3-3): the Agent persona is paired with a
// provider/model. A provider may be a direct LLM endpoint or a CLI-wrapped
// heterogeneous Agent we reuse (Codex / Claude Code / Trae, P5-3) — in both
// cases you still pick the LLM it drives.

function ComposeRow({ agent, onPatch }: { agent: Agent; onPatch: (p: Partial<Agent>) => void }) {
  const provider = PROVIDERS.find((p) => p.id === agent.providerId) ?? PROVIDERS[0];

  const onProvider = (pid: string) => {
    const p = PROVIDERS.find((pp) => pp.id === pid) ?? PROVIDERS[0];
    onPatch({ providerId: pid, model: p.models[0].id });
  };

  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, padding: 14, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Select value={provider.id} onChange={onProvider} options={PROVIDERS.map((p) => ({ id: p.id, label: p.name }))} width={190} />
        <Select value={agent.model} onChange={(v) => onPatch({ model: v })} options={provider.models.map((m) => ({ id: m.id, label: m.name }))} width={180} />
        <Select value={agent.effort} onChange={(v) => onPatch({ effort: v })} options={EFFORTS.map((e) => ({ id: e, label: e }))} width={110} />
        {provider.cli ? (
          <span style={{ fontSize: 11, color: T.textTertiary }}>复用业界 CLI Agent 充当 provider，仍由其驱动上面选定的模型</span>
        ) : null}
      </div>
    </div>
  );
}

// ── Agent Builder (right rail, mock chat) ────────────────────────────────────

const BUILDER_SUGGESTIONS = [
  "Optimize this Agent's A2A description",
  'Help me design a customer support agent',
  'Create a code review assistant',
  'Build a research analyst agent',
];

function AgentBuilder({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [input, setInput] = useState('');

  const send = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setMessages((m) => [
      ...m,
      { role: 'user', text: t },
      { role: 'assistant', text: '好的，我把它拆成可协作、可运行的 Agent：先定身份与边界（SOUL/AGENTS），再绑定所需 skills 与工具，最后给出一版可直接保存的配置。（原型 mock 回复）' },
    ]);
    setInput('');
  };

  return (
    <div style={{ width: 320, flexShrink: 0, height: '100%', borderLeft: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', backgroundColor: T.navBg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 14px 10px' }}>
        <Sparkles size={16} color={T.primary} />
        <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>Agent Builder</span>
        <PanelRightClose size={16} color={T.textTertiary} style={{ cursor: 'pointer' }} onClick={onClose} />
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '8px 14px' }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 4px' }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>🏗️</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 6 }}>Agent Builder</div>
            <div style={{ fontSize: 12, color: T.textTertiary, lineHeight: '18px', marginBottom: 16 }}>
              说出你的用例——写作、编码或数据分析都行。你定目标与标准，我来拆成可协作、可运行的 Agent。
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {BUILDER_SUGGESTIONS.map((s) => (
                <div key={s} onClick={() => send(s)} style={{ padding: '9px 12px', borderRadius: 9, border: `1px solid ${T.border}`, backgroundColor: T.bg, fontSize: 12, color: T.textSecondary, cursor: 'pointer', textAlign: 'center' }}>
                  {s}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ justifySelf: m.role === 'user' ? 'end' : 'start', maxWidth: '88%', padding: '8px 11px', borderRadius: 10, fontSize: 12, lineHeight: '18px', color: m.role === 'user' ? T.white : T.text, backgroundColor: m.role === 'user' ? T.primary : T.bg, border: m.role === 'user' ? 'none' : `1px solid ${T.border}` }}>
                {m.text}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: 12, borderTop: `1px solid ${T.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${T.border}`, borderRadius: 10, padding: '6px 8px 6px 12px', backgroundColor: T.bg }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(input); }}
            placeholder="Ask, create, or start a task…"
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, backgroundColor: 'transparent', color: T.text }}
          />
          <Play size={16} color={T.primary} style={{ cursor: 'pointer' }} onClick={() => send(input)} />
        </div>
      </div>
    </div>
  );
}

// ── shell ────────────────────────────────────────────────────────────────────

export function AgentAdmin() {
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
  const [selectedId, setSelectedId] = useState(INITIAL_AGENTS[1].id);
  const [mode, setMode] = useState<Mode>('configure');
  const [configTab, setConfigTab] = useState<ConfigTab>('soul');
  const [activityTab, setActivityTab] = useState<ActivityTab>('tasks');
  const [builderOpen, setBuilderOpen] = useState(true);
  const [rosterOpen, setRosterOpen] = useState(true);
  const [aiBusy, setAiBusy] = useState(false);

  const selected = useMemo(() => agents.find((a) => a.id === selectedId), [agents, selectedId]);

  const patch = (p: Partial<Agent>) =>
    setAgents((list) => list.map((a) => (a.id === selectedId ? { ...a, ...p } : a)));

  const createAgent = () => {
    const id = `a-${Date.now()}`;
    const fresh: Agent = {
      id,
      name: '新建 Agent',
      glyph: '🤖',
      pinned: false,
      status: 'draft',
      description: '',
      providerId: 'openai',
      model: 'gpt-5.4',
      effort: 'Medium',
      workspacePath: `/home/me/.peers-touch/workspace/${id}`,
      isolation: false,
      isolationMode: 'shared',
      isolationDays: 7,
      soul: '# SOUL.md\n\n## Identity\n',
      agentsMd: '# AGENTS.md\n\n',
      skills: [],
      tools: [],
    };
    setAgents((list) => [fresh, ...list]);
    setSelectedId(id);
    setMode('configure');
    setConfigTab('soul');
  };

  /** Mock AI rewrite of the A2A description (inline ✨ icon in the textarea). */
  const aiRewriteDescription = () => {
    if (!selected || aiBusy) return;
    setAiBusy(true);
    window.setTimeout(() => {
      patch({
        description:
          (selected.description ? selected.description.trim() + ' ' : '') +
          '[AI 优化] 明确角色、能力域、边界与交接条件，便于 A2A 路由命中。',
      });
      setAiBusy(false);
    }, 600);
  };

  const pinned = agents.filter((a) => a.pinned);
  const others = agents.filter((a) => !a.pinned);

  return (
    <div style={{ height: '100%', display: 'flex', backgroundColor: T.bg, color: T.text, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* ── roster ── */}
      {rosterOpen ? (
        <div style={{ width: 264, flexShrink: 0, borderRight: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', backgroundColor: T.navBg }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '16px 16px 10px' }}>
            <Bot size={18} color={T.primary} />
            <span style={{ fontSize: 15, fontWeight: 700, marginLeft: 8, flex: 1 }}>My Agents</span>
            <Plus size={17} color={T.textSecondary} style={{ cursor: 'pointer', marginRight: 10 }} onClick={createAgent} />
            <PanelLeftClose size={16} color={T.textTertiary} style={{ cursor: 'pointer' }} onClick={() => setRosterOpen(false)} />
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '0 8px 12px' }}>
            {pinned.length > 0 ? <RosterGroup label="Pinned" /> : null}
            {pinned.map((a) => (
              <RosterItem key={a.id} agent={a} active={a.id === selectedId} onClick={() => setSelectedId(a.id)} />
            ))}
            <RosterGroup label="All Agents" />
            {others.map((a) => (
              <RosterItem key={a.id} agent={a} active={a.id === selectedId} onClick={() => setSelectedId(a.id)} />
            ))}
          </div>
        </div>
      ) : (
        <div style={{ width: 48, flexShrink: 0, borderRight: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '16px 0', backgroundColor: T.navBg }}>
          <PanelLeftOpen size={18} color={T.textSecondary} style={{ cursor: 'pointer' }} onClick={() => setRosterOpen(true)} />
          <Plus size={18} color={T.textSecondary} style={{ cursor: 'pointer' }} onClick={createAgent} />
        </div>
      )}

      {/* ── editor ── */}
      {selected ? (
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
          <div style={{ flex: 1, padding: '24px 32px 32px', maxWidth: 980, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
            {/* name */}
            <input
              value={selected.name}
              onChange={(e) => patch({ name: e.target.value })}
              style={{ border: 'none', outline: 'none', fontSize: 24, fontWeight: 800, color: T.text, backgroundColor: 'transparent', width: '100%', marginBottom: 16 }}
            />

            {/* identity row: avatar + A2A description (with inline AI icon) */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
              <div style={{ width: 64, height: 64, borderRadius: 16, flexShrink: 0, background: `linear-gradient(135deg, ${T.primary}, #9a8df0)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>
                {selected.glyph}
              </div>
              <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                <textarea
                  value={selected.description}
                  onChange={(e) => patch({ description: e.target.value })}
                  rows={3}
                  placeholder="用一句话说明这个 Agent 的角色、能力域与边界，供 A2A 选择正确的 Agent…"
                  style={{ ...inputStyle, height: 64, resize: 'vertical', lineHeight: '20px', paddingRight: 38 }}
                />
                <span
                  title="AI 优化描述"
                  onClick={aiRewriteDescription}
                  style={{ position: 'absolute', right: 8, bottom: 10, width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: aiBusy ? T.textQuaternary : T.primary, backgroundColor: T.primaryWash }}
                >
                  <Sparkles size={14} />
                </span>
              </div>
            </div>

            {/* model + agent composition: Provider → Model (+ caps) · effort · runtime */}
            <ComposeRow agent={selected} onPatch={patch} />

            {/* mode switch: Configure (what the Agent is) / Activity (what it did) */}
            <div style={{ display: 'inline-flex', gap: 2, padding: 3, borderRadius: 10, backgroundColor: T.fillQuaternary, marginBottom: 18 }}>
              {([
                { id: 'configure', label: 'Configure' },
                { id: 'activity', label: 'Activity' },
              ] as { id: Mode; label: string }[]).map((m) => {
                const on = mode === m.id;
                return (
                  <div
                    key={m.id}
                    onClick={() => setMode(m.id)}
                    style={{ padding: '6px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: on ? T.text : T.textTertiary, backgroundColor: on ? T.bg : 'transparent', boxShadow: on ? '0 1px 2px rgba(0,0,0,0.06)' : 'none' }}
                  >
                    {m.label}
                  </div>
                );
              })}
            </div>

            {/* tab strip — scoped to the active mode */}
            <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${T.border}`, marginBottom: 18, flexWrap: 'wrap' }}>
              {mode === 'configure'
                ? CONFIG_TABS.map((tb) => {
                    const on = configTab === tb.id;
                    const Icon = tb.icon;
                    return (
                      <div
                        key={tb.id}
                        onClick={() => setConfigTab(tb.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: on ? T.primary : T.textSecondary, borderBottom: `2px solid ${on ? T.primary : 'transparent'}`, marginBottom: -1 }}
                      >
                        <Icon size={14} /> {tb.label}
                      </div>
                    );
                  })
                : ACTIVITY_TABS.map((tb) => {
                    const on = activityTab === tb.id;
                    const Icon = tb.icon;
                    return (
                      <div
                        key={tb.id}
                        onClick={() => setActivityTab(tb.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: on ? T.primary : T.textSecondary, borderBottom: `2px solid ${on ? T.primary : 'transparent'}`, marginBottom: -1 }}
                      >
                        <Icon size={14} /> {tb.label}
                      </div>
                    );
                  })}
            </div>

            {mode === 'configure' ? (
              <>
                {configTab === 'soul' ? <SoulTab agent={selected} onPatch={patch} /> : null}
                {configTab === 'capabilities' ? <CapabilitiesTab agent={selected} onPatch={patch} /> : null}
                {configTab === 'workspace' ? <WorkspaceTab agent={selected} onPatch={patch} /> : null}
              </>
            ) : (
              <>
                {activityTab === 'tasks' ? (
                  <ActivityPlaceholder label="Tasks" hint="该 Agent 正在运行与历史的协作任务。任务由协作 runtime 编排执行，这里只做投影展示。（原型未细化）" />
                ) : null}
                {activityTab === 'memories' ? (
                  <ActivityPlaceholder label="Memories" hint="Station 产出的记忆条目（candidate → confirmed），用户确认后才入长期记忆。这里只读展示，不在编辑面直接改写。（原型未细化）" />
                ) : null}
                {activityTab === 'events' ? (
                  <ActivityPlaceholder label="Agent Events" hint="工具调用、审批、错误、重试、回退等运行时事件的 trace / audit 投影（架构蓝本 §6.5）。（原型未细化）" />
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* ── agent builder ── */}
      {builderOpen ? (
        <AgentBuilder onClose={() => setBuilderOpen(false)} />
      ) : (
        <div style={{ width: 40, flexShrink: 0, borderLeft: `1px solid ${T.border}`, backgroundColor: T.navBg, display: 'flex', justifyContent: 'center', paddingTop: 14 }}>
          <PanelRightOpen size={18} color={T.textTertiary} style={{ cursor: 'pointer' }} onClick={() => setBuilderOpen(true)} />
        </div>
      )}
    </div>
  );
}

function RosterGroup({ label }: { label: string }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: T.textTertiary, padding: '10px 8px 6px' }}>{label}</div>;
}

function RosterItem({ agent, active, onClick }: { agent: Agent; active: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 10px', borderRadius: 9, marginBottom: 4, cursor: 'pointer', backgroundColor: active ? T.primaryWash : 'transparent' }}
    >
      <span style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: `linear-gradient(135deg, ${T.primary}, #9a8df0)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>
        {agent.glyph}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: active ? T.primary : T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agent.name}</span>
          {agent.pinned ? <Pin size={11} color={T.textQuaternary} /> : null}
          {agent.status === 'draft' ? <Pill text="草稿" color={T.textQuaternary} soft /> : null}
        </span>
        <span style={{ display: 'block', fontSize: 11, color: T.textTertiary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agent.description || '（待补充简介）'}</span>
      </span>
    </div>
  );
}
