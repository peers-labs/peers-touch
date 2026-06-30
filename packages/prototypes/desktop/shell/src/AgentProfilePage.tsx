/**
 * peers-touch Desktop — Agent Profile page prototype.
 *
 * This file is the prototype source for the production AgentProfilePage. It is
 * intentionally page-level, not an "Admin" aggregate: the Chat, Canvas, and
 * Profile surfaces each have their own one-to-one prototype file.
 *
 * Rebuilt to a single-Agent configuration page, not a thin profile form.
 * Mirrors the LobeHub blueprint
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
  BarChart3,
  Upload,
  Send,
  Image as ImageIcon,
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
  Workflow,
  Search,
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
  /** lucide icon for the Agent tile */
  icon: LucideIcon;
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
    icon: Search,
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
    icon: FileText,
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
      { id: 's-outline', name: 'outline-builder', kind: 'prompt', source: 'github://peers/skills/outline-builder', enabled: true, desc: '把零散素材整理成可展开的文章结构。' },
      { id: 's-tone', name: 'tone-keeper', kind: 'prompt', source: 'github://peers/skills/tone-keeper', enabled: true, desc: '保持作者原有语气与表达习惯。' },
      { id: 's-cite', name: 'citation-cleaner', kind: 'script', source: 'github://peers/skills/citation-cleaner', enabled: false, desc: '清理引用格式并标注缺失来源。' },
      { id: 's-brief', name: 'brief-to-draft', kind: 'prompt', source: 'github://peers/skills/brief-to-draft', enabled: true, desc: '把 brief 转成可评审的一版草稿。' },
    ],
    tools: [
      { id: 't-read', name: 'read_file', origin: 'builtin', enabled: true },
      { id: 't-fs', name: 'filesystem', origin: 'mcp:stdio · integrated_browser', enabled: true },
      { id: 't-web', name: 'web_search', origin: 'mcp:http', enabled: true },
      { id: 't-shell', name: 'run_shell', origin: 'builtin', enabled: false },
      { id: 't-grep', name: 'search_code', origin: 'builtin', enabled: true },
      { id: 't-drive', name: 'lark_drive', origin: 'mcp:http · lark', enabled: false },
      { id: 't-doc', name: 'lark_doc', origin: 'mcp:http · lark', enabled: true },
      { id: 't-preview', name: 'open_preview', origin: 'builtin', enabled: true },
    ],
  },
  {
    id: 'a-data',
    name: '数据分析师',
    icon: BarChart3,
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
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.textSecondary, marginBottom: 6 }}>AGENTS.md</div>
          <textarea
            value={agent.agentsMd}
            onChange={(e) => onPatch({ agentsMd: e.target.value })}
            style={{ ...inputStyle, ...monoStyle, flex: 1, minHeight: 360, resize: 'none' }}
          />
        </div>
        <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.textSecondary, marginBottom: 6 }}>SOUL.md</div>
          <textarea
            value={agent.soul}
            onChange={(e) => onPatch({ soul: e.target.value })}
            style={{ ...inputStyle, ...monoStyle, flex: 1, minHeight: 360, resize: 'none' }}
          />
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
    <div style={{ height: '100%', minHeight: 0, display: 'grid', gridTemplateRows: '1fr 1fr', gap: 16 }}>
      <section style={capabilityBlockStyle}>
        <div style={capabilityBlockHeaderStyle}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>Skill Packages</div>
            <div style={{ fontSize: 12, color: T.textTertiary, marginTop: 2 }}>以包的形式绑定到 Agent，包数量多时在本块内滚动。</div>
          </div>
          <button
            onClick={() => setImporting((v) => !v)}
            style={{ height: 34, border: 0, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 12px', borderRadius: 9, backgroundColor: T.primary, color: T.white, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            <Upload size={15} /> 导入 Skill
          </button>
        </div>

        {importing ? (
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, padding: 12, marginBottom: 10, backgroundColor: T.fillQuaternary }}>
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
            <input value={imp.name} onChange={(e) => setImp((s) => ({ ...s, name: e.target.value }))} placeholder="技能包名（必填）" style={{ ...inputStyle, marginBottom: 8 }} />
            <input value={imp.source} onChange={(e) => setImp((s) => ({ ...s, source: e.target.value }))} placeholder="包来源（URL / 路径，可留空自动生成）" style={{ ...inputStyle, marginBottom: 12 }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <div onClick={doImport} style={{ padding: '6px 14px', borderRadius: 8, backgroundColor: T.primary, color: T.white, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>导入</div>
              <div onClick={() => setImporting(false)} style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${T.border}`, color: T.textSecondary, fontSize: 13, cursor: 'pointer' }}>取消</div>
            </div>
          </div>
        ) : null}

        <div style={capabilityScrollStyle}>
          {agent.skills.length === 0 ? (
            <div style={{ padding: '28px 0', textAlign: 'center', color: T.textQuaternary, fontSize: 13 }}>还没有技能包。</div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {agent.skills.map((s) => (
                <div key={s.id} style={{ border: `1px solid ${T.border}`, borderRadius: 14, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, backgroundColor: T.bg }}>
                  <div style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: T.primaryWash, color: T.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800 }}>
                    {s.kind === 'prompt' ? '#' : '</>'}
                  </div>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 750, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                      <Pill text={SKILL_KIND_LABEL[s.kind]} color={KIND_COLOR[s.kind]} soft />
                    </span>
                    <span style={{ display: 'block', fontSize: 11, color: T.textTertiary, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.source}</span>
                    <span style={{ display: 'block', fontSize: 12, color: T.textSecondary, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.desc}</span>
                  </span>
                  <Toggle on={s.enabled} onClick={() => patchSkill(s.id, { enabled: !s.enabled })} />
                  <Trash2 size={15} color={T.textTertiary} style={{ cursor: 'pointer' }} onClick={() => removeSkill(s.id)} />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section style={capabilityBlockStyle}>
        <div style={capabilityBlockHeaderStyle}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>Tools</div>
            <div style={{ fontSize: 12, color: T.textTertiary, marginTop: 2 }}>原子工具 / MCP server 开关，数量多时在本块内滚动。</div>
          </div>
        </div>

        <div style={capabilityScrollStyle}>
          {agent.tools.length === 0 ? (
            <div style={{ padding: '28px 0', textAlign: 'center', color: T.textQuaternary, fontSize: 13 }}>暂无工具绑定。</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {agent.tools.map((tl) => (
                <div key={tl.id} style={{ border: `1px solid ${T.border}`, borderRadius: 12, padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10, backgroundColor: T.bg }}>
                  <Wrench size={15} color={T.textTertiary} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', color: T.text, ...monoStyle, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tl.name}</span>
                    <span style={{ display: 'block', fontSize: 11, color: T.textTertiary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tl.origin}</span>
                  </span>
                  <Toggle on={tl.enabled} onClick={() => patchTool(tl.id, { enabled: !tl.enabled })} />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

const capabilityBlockStyle: React.CSSProperties = {
  minHeight: 0,
  border: `1px solid ${T.border}`,
  borderRadius: 16,
  padding: 14,
  backgroundColor: '#fff',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
};

const capabilityBlockHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginBottom: 12,
  flexShrink: 0,
};

const capabilityScrollStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  paddingRight: 2,
};

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
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: T.navBg, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 14px 10px' }}>
        <Sparkles size={16} color={T.primary} />
        <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>Agent Builder</span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '8px 14px' }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 4px' }}>
            <div style={{ width: 42, height: 42, borderRadius: 14, margin: '0 auto 10px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', backgroundColor: T.primaryWash, color: T.primary }}>
              <Wrench size={22} />
            </div>
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

      <div style={{ padding: '0 14px 24px' }}>
        <div style={builderComposerStyle}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask, create, or start a task…"
            rows={2}
            style={builderComposerInputStyle}
          />
          <div style={builderComposerToolbarStyle}>
            <button style={builderPlainToolButtonStyle} title="Slash commands"><SlashCommandIcon /></button>
            <button style={builderPlainToolButtonStyle} title="Add image"><ImageIcon size={16} /></button>
            <div style={{ flex: 1 }} />
            <button style={builderModelButtonStyle}>composer-2-fast <ChevronDown size={13} /></button>
            <button style={builderSendButtonStyle} title="Send" onClick={() => send(input)}><Send size={16} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SlashCommandIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
      <rect x="2.25" y="2.25" width="12.5" height="12.5" rx="2.25" stroke="currentColor" strokeWidth="2" />
      <path d="M9.9 5.2L7.1 11.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const builderComposerStyle: React.CSSProperties = {
  minHeight: 118,
  border: '1px solid #d9d9d9',
  borderRadius: 22,
  padding: '16px 18px 14px',
  backgroundColor: '#fff',
  boxShadow: '0 14px 48px rgba(0,0,0,0.08)',
  boxSizing: 'border-box',
};

const builderComposerInputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 54,
  resize: 'none',
  border: 'none',
  outline: 'none',
  color: T.text,
  fontSize: 15,
  lineHeight: 1.5,
  fontFamily: 'inherit',
  backgroundColor: 'transparent',
  boxSizing: 'border-box',
};

const builderComposerToolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const builderPlainToolButtonStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  border: 0,
  borderRadius: 10,
  backgroundColor: 'transparent',
  color: T.text,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  padding: 0,
};

const builderModelButtonStyle: React.CSSProperties = {
  height: 34,
  border: 0,
  borderRadius: 10,
  backgroundColor: 'transparent',
  color: T.text,
  padding: '0 8px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  fontSize: 13,
  fontWeight: 650,
  cursor: 'pointer',
};

const builderSendButtonStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  border: 0,
  borderRadius: 13,
  backgroundColor: '#ded8ff',
  color: '#7467d8',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
};

// ── shell ────────────────────────────────────────────────────────────────────

export function AgentProfilePage({ onOpenOrchestration }: { onOpenOrchestration?: () => void }) {
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
  const [selectedId, setSelectedId] = useState(INITIAL_AGENTS[1].id);
  const [mode, setMode] = useState<Mode>('configure');
  const [configTab, setConfigTab] = useState<ConfigTab>('soul');
  const [activityTab, setActivityTab] = useState<ActivityTab>('tasks');
  const [builderOpen, setBuilderOpen] = useState(false);
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
      icon: Bot,
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
      <div style={{ width: rosterOpen ? 264 : 48, flexShrink: 0, borderRight: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', alignItems: 'stretch', padding: rosterOpen ? '14px 12px 58px' : '14px 0 58px', backgroundColor: T.navBg, boxSizing: 'border-box', position: 'relative', overflow: 'hidden' }}>
        {rosterOpen ? (
          <>
            <div style={{ height: 40, display: 'flex', alignItems: 'center', marginBottom: 10 }}>
              <Bot size={18} color={T.primary} />
              <span style={{ fontSize: 15, fontWeight: 700, marginLeft: 8, flex: 1 }}>My Agents</span>
              {onOpenOrchestration ? (
                <Workflow
                  title="打开 Agent 编排"
                  size={17}
                  color={T.textSecondary}
                  style={{ cursor: 'pointer', marginRight: 10 }}
                  onClick={onOpenOrchestration}
                />
              ) : null}
              <Plus size={17} color={T.textSecondary} style={{ cursor: 'pointer', marginRight: 10 }} onClick={createAgent} />
            </div>
            <div style={{ height: 40, border: `1px solid ${T.border}`, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 7, padding: '0 9px', color: T.textQuaternary, backgroundColor: T.bg, fontSize: 12 }}>
              <Search size={14} />
              <span>Search agents...</span>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '0 0 12px' }}>
              {pinned.length > 0 ? <RosterGroup label="Pinned" /> : null}
              {pinned.map((a) => (
                <RosterItem key={a.id} agent={a} active={a.id === selectedId} onClick={() => setSelectedId(a.id)} />
              ))}
              <RosterGroup label="All Agents" />
              {others.map((a) => (
                <RosterItem key={a.id} agent={a} active={a.id === selectedId} onClick={() => setSelectedId(a.id)} />
              ))}
            </div>
          </>
        ) : (
          <>
            <button title="新建 Agent" onClick={createAgent} style={{ width: 40, height: 40, border: 0, borderRadius: 12, backgroundColor: 'transparent', color: T.textSecondary, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', margin: '0 auto 10px' }}>
              <Plus size={16} />
            </button>
            <button title="搜索 Agent" onClick={() => setRosterOpen(true)} style={{ width: 40, height: 40, border: 0, borderRadius: 12, backgroundColor: 'transparent', color: T.textSecondary, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', margin: '0 auto 2px' }}>
              <Search size={16} />
            </button>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, width: '100%' }}>
              <CollapsedRosterGroup />
              {pinned.map((a) => (
                <button
                  key={a.id}
                  title={a.name}
                  onClick={() => {
                    setSelectedId(a.id);
                    setRosterOpen(true);
                  }}
                  style={{ width: 40, height: 48, border: 0, borderRadius: 12, backgroundColor: a.id === selectedId ? T.primaryWash : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                >
                  <AgentIcon icon={a.icon} size={30} iconSize={15} active={a.id === selectedId} />
                </button>
              ))}
              <CollapsedRosterGroup />
              {others.map((a) => (
                <button
                  key={a.id}
                  title={a.name}
                  onClick={() => {
                    setSelectedId(a.id);
                    setRosterOpen(true);
                  }}
                  style={{ width: 40, height: 48, border: 0, borderRadius: 12, backgroundColor: a.id === selectedId ? T.primaryWash : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                >
                  <AgentIcon icon={a.icon} size={30} iconSize={15} active={a.id === selectedId} />
                </button>
              ))}
            </div>
          </>
        )}
        <button title={rosterOpen ? '折叠 Agent 列表' : '展开 Agent 列表'} onClick={() => setRosterOpen((open) => !open)} style={{ width: 34, height: 34, borderRadius: 999, border: 0, backgroundColor: 'transparent', color: T.textSecondary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: 'none', flexShrink: 0, position: 'absolute', left: 7, bottom: 14 }}>
          {rosterOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
      </div>

      {/* ── editor ── */}
      {selected ? (
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, minHeight: 0, padding: '24px 32px 32px', maxWidth: 980, width: '100%', margin: '0 auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
            {/* name */}
            <input
              value={selected.name}
              onChange={(e) => patch({ name: e.target.value })}
              style={{ border: 'none', outline: 'none', fontSize: 24, fontWeight: 800, color: T.text, backgroundColor: 'transparent', width: '100%', marginBottom: 16 }}
            />

            {/* identity row: avatar + A2A description (with inline AI icon) */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
              <AgentIcon icon={selected.icon} size={64} iconSize={28} active />
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

            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: mode === 'configure' && (configTab === 'soul' || configTab === 'capabilities') ? 'hidden' : 'auto' }}>
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
        </div>
      ) : null}

      {/* ── agent builder ── */}
      <div style={{ width: builderOpen ? 320 : 40, flexShrink: 0, borderLeft: `1px solid ${T.border}`, backgroundColor: T.navBg, position: 'relative', boxSizing: 'border-box', overflow: 'hidden' }}>
        {builderOpen ? <AgentBuilder onClose={() => setBuilderOpen(false)} /> : null}
        {!builderOpen ? (
          <div style={{ position: 'absolute', inset: '58px 0 58px', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <span style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', color: T.textSecondary, fontSize: 12, fontWeight: 700, letterSpacing: 0.4 }}>
              Agent Builder
            </span>
          </div>
        ) : null}
        <button title={builderOpen ? '折叠 Agent Builder' : '展开 Agent Builder'} onClick={() => setBuilderOpen((open) => !open)} style={{ width: 34, height: 34, borderRadius: 999, border: 0, backgroundColor: 'transparent', color: T.textSecondary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: 'none', position: 'absolute', right: 3, top: 17 }}>
          {builderOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      </div>
    </div>
  );
}

function RosterGroup({ label }: { label: string }) {
  return <div style={{ height: 18, lineHeight: '18px', fontSize: 11, fontWeight: 700, color: T.textTertiary, margin: '12px 0 6px', padding: '0 8px' }}>{label}</div>;
}

function AgentIcon({ icon: Icon, size, iconSize, active = false }: { icon: LucideIcon; size: number; iconSize: number; active?: boolean }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(8, Math.round(size * 0.25)),
        flexShrink: 0,
        backgroundColor: active ? T.primaryWash : T.navBg,
        color: active ? T.primary : T.textSecondary,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon size={iconSize} />
    </span>
  );
}

function CollapsedRosterGroup() {
  return (
    <div style={{ width: 40, height: 18, margin: '12px auto 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ width: 18, height: 1, backgroundColor: T.border }} />
    </div>
  );
}

function RosterItem({ agent, active, onClick }: { agent: Agent; active: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{ height: 48, display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px', borderRadius: 9, cursor: 'pointer', backgroundColor: active ? T.primaryWash : 'transparent', boxSizing: 'border-box' }}
    >
      <AgentIcon icon={agent.icon} size={32} iconSize={16} active={active} />
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
