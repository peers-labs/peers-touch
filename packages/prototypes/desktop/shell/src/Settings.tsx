/**
 * peers-touch Desktop — Settings prototype (AI sections).
 *
 * Faithful prototype of the real desktop Settings → AI group:
 *   - Agent     : default LLM config + agents list visibility (private / workspace)
 *   - Providers : provider list, API key / base URL, connectivity test, model CRUD
 *   - Models    : cross-provider model overview, type filter, per-model enable
 *   - Skills    : installed / builtin / market tabs, import (URL / GitHub / ZIP),
 *                 trust + scan metadata
 *   - MCP       : server list, add stdio / http / sse, test connection, tools
 *
 * Agent visibility is intentionally two-level (private / workspace). There is no
 * Hub level — agents are not published to a public hub from here.
 *
 * Standalone web prototype: mock-data only, no real store / kernel / tauri.
 */
import { useState } from 'react';
import {
  Bot,
  Server,
  ScrollText,
  Plug,
  Lock,
  Users,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Github,
  Link as LinkIcon,
  FileArchive,
  FileJson,
  ShieldCheck,
  ShieldAlert,
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  Pencil,
  type LucideIcon,
} from 'lucide-react';
import { T } from './theme';

// ── shared domain (mock) ─────────────────────────────────────────────────────

type ModelKind = 'chat' | 'image' | 'embedding';

interface ModelOption {
  id: string;
  name: string;
  kind: ModelKind;
  enabled: boolean;
}

interface Provider {
  id: string;
  name: string;
  builtin: boolean;
  apiKey: string;
  baseUrl: string;
  models: ModelOption[];
}

const INITIAL_PROVIDERS: Provider[] = [
  {
    id: 'openai',
    name: 'OpenAI-compatible',
    builtin: true,
    apiKey: 'sk-•••••••••••••••••••',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-5.4', name: 'gpt-5.4', kind: 'chat', enabled: true },
      { id: 'gpt-5.4-mini', name: 'gpt-5.4-mini', kind: 'chat', enabled: true },
      { id: 'text-embedding-3', name: 'text-embedding-3', kind: 'embedding', enabled: true },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    builtin: true,
    apiKey: 'sk-ant-•••••••••••••',
    baseUrl: 'https://api.anthropic.com',
    models: [
      { id: 'claude-sonnet', name: 'claude-sonnet', kind: 'chat', enabled: true },
      { id: 'claude-haiku', name: 'claude-haiku', kind: 'chat', enabled: false },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    builtin: false,
    apiKey: '',
    baseUrl: 'http://127.0.0.1:11434',
    models: [
      { id: 'qwen-max', name: 'qwen-max', kind: 'chat', enabled: true },
      { id: 'deepseek-v3', name: 'deepseek-v3', kind: 'chat', enabled: false },
    ],
  },
];

const EFFORTS: string[] = ['Low', 'Medium', 'High'];

const MODEL_KIND_LABEL: Record<ModelKind, string> = {
  chat: '对话',
  image: '图像',
  embedding: '向量',
};

// ── small UI atoms ──────────────────────────────────────────────────────────

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
  boxSizing: 'border-box',
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 13,
  outline: 'none',
  color: T.text,
  backgroundColor: T.bg,
};

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div
      onClick={onToggle}
      style={{
        width: 40,
        height: 22,
        borderRadius: 11,
        backgroundColor: on ? T.primary : T.fillTertiary,
        position: 'relative',
        cursor: 'pointer',
        transition: 'background-color 0.15s ease',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 20 : 2,
          width: 18,
          height: 18,
          borderRadius: '50%',
          backgroundColor: T.white,
          transition: 'left 0.15s ease',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}
      />
    </div>
  );
}

function GhostBtn({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon?: LucideIcon;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const c = danger ? '#d4380d' : T.textSecondary;
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 32,
        padding: '0 12px',
        borderRadius: 8,
        border: `1px solid ${hover ? c : T.border}`,
        backgroundColor: hover ? T.fillQuaternary : T.bg,
        color: c,
        fontSize: 13,
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      {Icon ? <Icon size={14} /> : null}
      {label}
    </button>
  );
}

function PrimaryBtn({ icon: Icon, label, onClick }: { icon?: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 32,
        padding: '0 14px',
        borderRadius: 8,
        border: 'none',
        backgroundColor: T.primary,
        color: T.white,
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {Icon ? <Icon size={14} /> : null}
      {label}
    </button>
  );
}

function Tag({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        lineHeight: '18px',
        padding: '0 7px',
        borderRadius: 5,
        color,
        backgroundColor: `${color}14`,
        border: `1px solid ${color}33`,
      }}
    >
      {text}
    </span>
  );
}

function SectionCard({
  title,
  desc,
  action,
  children,
}: {
  title: string;
  desc?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, padding: 20, backgroundColor: T.white, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: desc ? 16 : 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{title}</div>
          {desc ? <div style={{ fontSize: 12, color: T.textTertiary, marginTop: 4 }}>{desc}</div> : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ── 1. Agent section ──────────────────────────────────────────────────────────

type Visibility = 'private' | 'workspace';

const VISIBILITY: { id: Visibility; label: string; icon: LucideIcon; hint: string }[] = [
  { id: 'private', label: '私有', icon: Lock, hint: '仅自己可见可用' },
  { id: 'workspace', label: '工作区', icon: Users, hint: '同工作区成员可见可用' },
];

interface AgentRow {
  id: string;
  name: string;
  icon: LucideIcon;
  providerId: string;
  model: string;
  enabled: boolean;
  visibility: Visibility;
}

const INITIAL_AGENTS: AgentRow[] = [
  { id: 'ag-1', name: '科研助理', icon: Bot, providerId: 'anthropic', model: 'claude-sonnet', enabled: true, visibility: 'workspace' },
  { id: 'ag-2', name: '写作伙伴', icon: ScrollText, providerId: 'openai', model: 'gpt-5.4', enabled: true, visibility: 'private' },
  { id: 'ag-3', name: '数据分析师', icon: Activity, providerId: 'openai', model: 'gpt-5.4-mini', enabled: false, visibility: 'private' },
];

function VisibilityPicker({ value, onChange }: { value: Visibility; onChange: (v: Visibility) => void }) {
  return (
    <div style={{ display: 'inline-flex', border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
      {VISIBILITY.map((v, i) => {
        const active = v.id === value;
        const Icon = v.icon;
        return (
          <div
            key={v.id}
            title={v.hint}
            onClick={() => onChange(v.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: active ? 700 : 500,
              cursor: 'pointer',
              color: active ? T.white : T.textSecondary,
              backgroundColor: active ? T.primary : T.bg,
              borderLeft: i === 0 ? 'none' : `1px solid ${T.border}`,
            }}
          >
            <Icon size={13} />
            {v.label}
          </div>
        );
      })}
    </div>
  );
}

function AgentSection({ providers }: { providers: Provider[] }) {
  const [defProvider, setDefProvider] = useState('openai');
  const [defModel, setDefModel] = useState('gpt-5.4');
  const [defEffort, setDefEffort] = useState('Medium');
  const [agents, setAgents] = useState<AgentRow[]>(INITIAL_AGENTS);

  const provider = providers.find((p) => p.id === defProvider) ?? providers[0];
  const patch = (id: string, p: Partial<AgentRow>) =>
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, ...p } : a)));

  const onDefProvider = (pid: string) => {
    const p = providers.find((x) => x.id === pid) ?? providers[0];
    setDefProvider(pid);
    setDefModel(p.models[0]?.id ?? '');
  };

  return (
    <div style={{ maxWidth: 860 }}>
      <SectionCard title="默认 LLM 配置" desc="新建 Agent 默认继承此配置；某个 Agent 未单独指定模型时回退到这里。">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Select value={defProvider} width={200} options={providers.map((p) => ({ id: p.id, label: p.name }))} onChange={onDefProvider} />
          <Select value={defModel} width={180} options={provider.models.map((m) => ({ id: m.id, label: m.name }))} onChange={setDefModel} />
          <Select value={defEffort} width={120} options={EFFORTS.map((e) => ({ id: e, label: e }))} onChange={setDefEffort} />
        </div>
        <div style={{ fontSize: 12, color: T.textTertiary, marginTop: 12 }}>
          Provider / 模型的增删、API key、base URL 在左侧 Providers / Model Service 管理。
        </div>
      </SectionCard>

      <SectionCard title="Agents 可见性" desc="控制每个 Agent 的可见范围：私有仅自己可用，工作区对同组成员开放。">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {agents.map((a, i) => {
            const ap = providers.find((p) => p.id === a.providerId);
            const Icon = a.icon;
            return (
              <div
                key={a.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 0',
                  borderTop: i === 0 ? 'none' : `1px solid ${T.borderSoft}`,
                  opacity: a.enabled ? 1 : 0.55,
                }}
              >
                <div style={{ width: 36, height: 36, borderRadius: 9, background: T.fillQuaternary, color: T.textSecondary, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon size={18} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{a.name}</div>
                  <div style={{ fontSize: 12, color: T.textTertiary }}>
                    {ap ? ap.name : a.providerId} · {a.model}
                  </div>
                </div>
                <VisibilityPicker value={a.visibility} onChange={(v) => patch(a.id, { visibility: v })} />
                <Toggle on={a.enabled} onToggle={() => patch(a.id, { enabled: !a.enabled })} />
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}

// ── 2. Providers section ──────────────────────────────────────────────────────

type TestState = 'idle' | 'testing' | 'ok' | 'fail';

function ProvidersSection({
  providers,
  setProviders,
}: {
  providers: Provider[];
  setProviders: React.Dispatch<React.SetStateAction<Provider[]>>;
}) {
  const [selId, setSelId] = useState(providers[0]?.id ?? '');
  const sel = providers.find((p) => p.id === selId) ?? providers[0];
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>('idle');

  const patchProvider = (id: string, p: Partial<Provider>) =>
    setProviders((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const addProvider = () => {
    const id = `custom-${Date.now()}`;
    const np: Provider = { id, name: '新自定义 Provider', builtin: false, apiKey: '', baseUrl: 'https://', models: [] };
    setProviders((prev) => [...prev, np]);
    setSelId(id);
  };

  const removeProvider = (id: string) => {
    setProviders((prev) => prev.filter((p) => p.id !== id));
    if (selId === id) setSelId(providers.find((p) => p.id !== id)?.id ?? '');
  };

  const runTest = () => {
    setTest('testing');
    window.setTimeout(() => setTest(sel.baseUrl.startsWith('http') ? 'ok' : 'fail'), 700);
  };

  const addModel = () => {
    const id = `m-${Date.now()}`;
    patchProvider(sel.id, {
      models: [...sel.models, { id, name: 'new-model', kind: 'chat', enabled: true }],
    });
  };

  const patchModel = (mid: string, mp: Partial<ModelOption>) =>
    patchProvider(sel.id, { models: sel.models.map((m) => (m.id === mid ? { ...m, ...mp } : m)) });

  const removeModel = (mid: string) =>
    patchProvider(sel.id, { models: sel.models.filter((m) => m.id !== mid) });

  return (
    <div style={{ display: 'flex', gap: 16, maxWidth: 980 }}>
      {/* provider list */}
      <div style={{ width: 220, flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {providers.map((p) => {
            const active = p.id === selId;
            return (
              <div
                key={p.id}
                onClick={() => { setSelId(p.id); setTest('idle'); setShowKey(false); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 12px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  border: `1px solid ${active ? T.primary : T.border}`,
                  backgroundColor: active ? T.primaryWash : T.white,
                }}
              >
                <Server size={15} color={active ? T.primary : T.textTertiary} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: active ? 600 : 500, color: T.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </span>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.apiKey || p.baseUrl.includes('127.0.0.1') ? '#10b981' : T.textQuaternary }} />
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 10 }}>
          <GhostBtn icon={Plus} label="添加 Provider" onClick={addProvider} />
        </div>
      </div>

      {/* provider detail */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {sel ? (
          <>
            <SectionCard
              title={sel.name}
              desc={sel.builtin ? '内置 Provider' : '自定义 Provider'}
              action={
                <div style={{ display: 'flex', gap: 8 }}>
                  <GhostBtn
                    icon={test === 'testing' ? Loader2 : test === 'ok' ? CheckCircle2 : test === 'fail' ? XCircle : Activity}
                    label={test === 'testing' ? '测试中…' : test === 'ok' ? '连通正常' : test === 'fail' ? '连接失败' : '测试连接'}
                    onClick={runTest}
                  />
                  {!sel.builtin ? <GhostBtn icon={Trash2} label="删除" danger onClick={() => removeProvider(sel.id)} /> : null}
                </div>
              }
            >
              <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', rowGap: 12, columnGap: 12, alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: T.textSecondary }}>API Key</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={sel.apiKey}
                    placeholder="sk-…"
                    onChange={(e) => patchProvider(sel.id, { apiKey: e.target.value })}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <GhostBtn icon={showKey ? EyeOff : Eye} label={showKey ? '隐藏' : '显示'} onClick={() => setShowKey((v) => !v)} />
                </div>
                <span style={{ fontSize: 13, color: T.textSecondary }}>Base URL</span>
                <input
                  value={sel.baseUrl}
                  placeholder="https://…"
                  onChange={(e) => patchProvider(sel.id, { baseUrl: e.target.value })}
                  style={{ ...inputStyle, width: '100%' }}
                />
              </div>
            </SectionCard>

            <SectionCard title="模型" desc="该 Provider 下可用的模型；可增删、改类型、单独开关。" action={<GhostBtn icon={Plus} label="添加模型" onClick={addModel} />}>
              {sel.models.length === 0 ? (
                <div style={{ fontSize: 13, color: T.textTertiary, padding: '8px 0' }}>暂无模型，点右上「添加模型」。</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {sel.models.map((m, i) => (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: i === 0 ? 'none' : `1px solid ${T.borderSoft}` }}>
                      <input
                        value={m.name}
                        onChange={(e) => patchModel(m.id, { name: e.target.value })}
                        style={{ ...inputStyle, flex: 1 }}
                      />
                      <Select
                        value={m.kind}
                        width={110}
                        options={(['chat', 'image', 'embedding'] as ModelKind[]).map((k) => ({ id: k, label: MODEL_KIND_LABEL[k] }))}
                        onChange={(v) => patchModel(m.id, { kind: v as ModelKind })}
                      />
                      <Toggle on={m.enabled} onToggle={() => patchModel(m.id, { enabled: !m.enabled })} />
                      <Trash2 size={15} color={T.textTertiary} style={{ cursor: 'pointer' }} onClick={() => removeModel(m.id)} />
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </>
        ) : (
          <div style={{ fontSize: 13, color: T.textTertiary }}>请选择左侧 Provider。</div>
        )}
      </div>
    </div>
  );
}

// ── 3. Skills section ─────────────────────────────────────────────────────────

type SkillSource = 'user' | 'github' | 'url' | 'zip' | 'builtin' | 'market';
type SkillTab = 'installed' | 'builtin' | 'market';
type ScanVerdict = 'passed' | 'warning';

interface SkillItem {
  id: string;
  name: string;
  desc: string;
  source: SkillSource;
  scan: ScanVerdict;
  enabled: boolean;
  installed: boolean;
}

const SOURCE_LABEL: Record<SkillSource, string> = {
  user: '本地',
  github: 'GitHub',
  url: 'URL',
  zip: 'ZIP',
  builtin: '内置',
  market: '市场',
};

const INITIAL_SKILLS: SkillItem[] = [
  { id: 'sk-1', name: 'meeting-digest', desc: '把会议纪要压缩成可跟踪的行动项。', source: 'github', scan: 'passed', enabled: true, installed: true },
  { id: 'sk-2', name: 'pdf-extract', desc: '从 PDF 抽取结构化字段。', source: 'url', scan: 'warning', enabled: true, installed: true },
  { id: 'sk-3', name: 'web-summarize', desc: '抓取网页正文并生成摘要。', source: 'builtin', scan: 'passed', enabled: true, installed: true },
  { id: 'sk-4', name: 'code-review', desc: '对 diff 做要点式审查。', source: 'builtin', scan: 'passed', enabled: false, installed: true },
  { id: 'sk-5', name: 'translate-pro', desc: '术语一致的多语翻译技能包。', source: 'market', scan: 'passed', enabled: false, installed: false },
  { id: 'sk-6', name: 'sql-explain', desc: '解释并优化 SQL 查询。', source: 'market', scan: 'passed', enabled: false, installed: false },
];

function SkillsSection() {
  const [tab, setTab] = useState<SkillTab>('installed');
  const [skills, setSkills] = useState<SkillItem[]>(INITIAL_SKILLS);
  const [importOpen, setImportOpen] = useState(false);
  const [importKind, setImportKind] = useState<'github' | 'url' | 'zip'>('github');
  const [importAddr, setImportAddr] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  const list = skills.filter((s) =>
    tab === 'installed' ? s.installed && s.source !== 'builtin' : tab === 'builtin' ? s.source === 'builtin' : !s.installed,
  );

  const patch = (id: string, p: Partial<SkillItem>) => setSkills((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const remove = (id: string) => setSkills((prev) => prev.filter((s) => s.id !== id));

  const doImport = () => {
    if (!importAddr.trim()) return;
    const id = `sk-${Date.now()}`;
    const name = importAddr.trim().split('/').pop()?.replace(/\.(zip|git)$/, '') || 'imported-skill';
    setSkills((prev) => [
      { id, name, desc: `从 ${SOURCE_LABEL[importKind]} 导入的技能（待扫描）。`, source: importKind, scan: 'warning', enabled: false, installed: true },
      ...prev,
    ]);
    setImportAddr('');
    setImportOpen(false);
    setTab('installed');
  };

  return (
    <div style={{ maxWidth: 860 }}>
      <SectionCard
        title="技能"
        desc="可复用的能力包；支持本地新建与从 GitHub / URL / ZIP 导入，导入后做信任与安全扫描。"
        action={<PrimaryBtn icon={Plus} label="导入技能" onClick={() => setImportOpen((v) => !v)} />}
      >
        {importOpen ? (
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, marginBottom: 16, backgroundColor: T.bg }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {(['github', 'url', 'zip'] as const).map((k) => {
                const active = k === importKind;
                const Icon = k === 'github' ? Github : k === 'url' ? LinkIcon : FileArchive;
                return (
                  <div
                    key={k}
                    onClick={() => setImportKind(k)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 12px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: active ? 700 : 500,
                      cursor: 'pointer',
                      color: active ? T.primary : T.textSecondary,
                      backgroundColor: active ? T.primaryWash : T.white,
                      border: `1px solid ${active ? T.primary : T.border}`,
                    }}
                  >
                    <Icon size={13} />
                    {SOURCE_LABEL[k]}
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={importAddr}
                onChange={(e) => setImportAddr(e.target.value)}
                placeholder={importKind === 'github' ? 'owner/repo' : importKind === 'url' ? 'https://…/skill' : '选择或拖入 .zip 路径'}
                style={{ ...inputStyle, flex: 1 }}
              />
              <PrimaryBtn label="导入" onClick={doImport} />
            </div>
          </div>
        ) : null}

        {/* tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
          {(['installed', 'builtin', 'market'] as SkillTab[]).map((t) => {
            const active = t === tab;
            const label = t === 'installed' ? '已安装' : t === 'builtin' ? '内置' : '市场';
            return (
              <div
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  cursor: 'pointer',
                  color: active ? T.primary : T.textSecondary,
                  backgroundColor: active ? T.primaryWash : 'transparent',
                }}
              >
                {label}
              </div>
            );
          })}
        </div>

        {list.length === 0 ? (
          <div style={{ fontSize: 13, color: T.textTertiary, padding: '8px 0' }}>该分类下暂无技能。</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {list.map((s, i) => {
              const isEditing = editing === s.id;
              return (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: i === 0 ? 'none' : `1px solid ${T.borderSoft}` }}>
                  <ScrollText size={18} color={T.textTertiary} />
                  {isEditing ? (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <input value={s.name} onChange={(e) => patch(s.id, { name: e.target.value })} style={{ ...inputStyle }} placeholder="技能名称" />
                      <input value={s.desc} onChange={(e) => patch(s.id, { desc: e.target.value })} style={{ ...inputStyle }} placeholder="描述" />
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <GhostBtn icon={CheckCircle2} label="完成" onClick={() => setEditing(null)} />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{s.name}</span>
                          <Tag text={SOURCE_LABEL[s.source]} color="#722ed1" />
                          {s.scan === 'passed' ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: '#10b981' }}>
                              <ShieldCheck size={12} /> 已扫描
                            </span>
                          ) : (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: '#d48806' }}>
                              <ShieldAlert size={12} /> 需复核
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: T.textTertiary, marginTop: 2 }}>{s.desc}</div>
                      </div>
                      {tab === 'market' ? (
                        <PrimaryBtn label="安装" onClick={() => patch(s.id, { installed: true, enabled: true })} />
                      ) : (
                        <>
                          {s.source !== 'builtin' ? <Pencil size={14} color={T.textTertiary} style={{ cursor: 'pointer' }} onClick={() => setEditing(s.id)} /> : null}
                          <Toggle on={s.enabled} onToggle={() => patch(s.id, { enabled: !s.enabled })} />
                          {s.source !== 'builtin' ? <Trash2 size={15} color={T.textTertiary} style={{ cursor: 'pointer' }} onClick={() => remove(s.id)} /> : null}
                        </>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ── 5. MCP section ────────────────────────────────────────────────────────────

type Transport = 'stdio' | 'http' | 'sse';

interface MCPServer {
  id: string;
  name: string;
  transport: Transport;
  /** command (stdio) or url (http/sse) */
  endpoint: string;
  enabled: boolean;
  toolCount: number;
  tools: string[];
  test: TestState;
}

const INITIAL_MCP: MCPServer[] = [
  { id: 'mcp-1', name: 'integrated_browser', transport: 'stdio', endpoint: 'npx @pt/mcp-browser', enabled: true, toolCount: 6, tools: ['navigate', 'click', 'snapshot', 'type', 'screenshot', 'evaluate'], test: 'ok' },
  { id: 'mcp-2', name: 'web_search', transport: 'http', endpoint: 'https://mcp.example.com/search', enabled: true, toolCount: 2, tools: ['search', 'fetch'], test: 'idle' },
  { id: 'mcp-3', name: 'filesystem', transport: 'stdio', endpoint: 'npx @pt/mcp-fs', enabled: false, toolCount: 4, tools: ['read', 'write', 'list', 'stat'], test: 'idle' },
];

/** Sample shown in the JSON import editor — the standard `mcpServers` shape. */
const JSON_SAMPLE = `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["@pt/mcp-fs", "/path"]
    },
    "web_search": {
      "url": "https://mcp.example.com/search"
    }
  }
}`;

/**
 * Parse the standard MCP config JSON (Claude Desktop / Cursor style) into draft
 * servers. Supports both `{ mcpServers: {...} }` and a bare map. A stdio entry
 * uses `command` (+ `args`); an http/sse entry uses `url` (sse when `type:"sse"`
 * or the url ends with `/sse`). Returns an error string on failure.
 */
function parseMcpJson(text: string): { name: string; transport: Transport; endpoint: string }[] | string {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return 'JSON 解析失败，请检查格式。';
  }
  if (!raw || typeof raw !== 'object') return '配置必须是一个 JSON 对象。';
  const map = (raw as Record<string, unknown>).mcpServers ?? raw;
  if (!map || typeof map !== 'object') return '未找到 mcpServers 配置。';
  const out: { name: string; transport: Transport; endpoint: string }[] = [];
  for (const [name, value] of Object.entries(map as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') return `服务器 "${name}" 配置无效。`;
    const cfg = value as Record<string, unknown>;
    if (typeof cfg.command === 'string' && cfg.command.trim()) {
      const args = Array.isArray(cfg.args) ? cfg.args.map(String) : [];
      out.push({ name, transport: 'stdio', endpoint: [cfg.command, ...args].join(' ').trim() });
    } else if (typeof cfg.url === 'string' && cfg.url.trim()) {
      const url = cfg.url.trim();
      const sse = cfg.type === 'sse' || url.endsWith('/sse');
      out.push({ name, transport: sse ? 'sse' : 'http', endpoint: url });
    } else {
      return `服务器 "${name}" 缺少 command 或 url。`;
    }
  }
  if (out.length === 0) return '没有可导入的服务器。';
  return out;
}

function MCPSection() {
  const [servers, setServers] = useState<MCPServer[]>(INITIAL_MCP);
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<'form' | 'json'>('form');
  const [draft, setDraft] = useState<{ name: string; transport: Transport; endpoint: string }>({ name: '', transport: 'stdio', endpoint: '' });
  const [jsonText, setJsonText] = useState(JSON_SAMPLE);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const patch = (id: string, p: Partial<MCPServer>) => setServers((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const remove = (id: string) => setServers((prev) => prev.filter((s) => s.id !== id));

  const addServer = () => {
    if (!draft.name.trim() || !draft.endpoint.trim()) return;
    const id = `mcp-${Date.now()}`;
    setServers((prev) => [...prev, { id, name: draft.name.trim(), transport: draft.transport, endpoint: draft.endpoint.trim(), enabled: true, toolCount: 0, tools: [], test: 'idle' }]);
    setDraft({ name: '', transport: 'stdio', endpoint: '' });
    setAddOpen(false);
  };

  const importJson = () => {
    const parsed = parseMcpJson(jsonText);
    if (typeof parsed === 'string') {
      setJsonError(parsed);
      return;
    }
    setServers((prev) => {
      const merged = [...prev];
      parsed.forEach((p) => {
        const idx = merged.findIndex((s) => s.name === p.name);
        const next: MCPServer = { id: `mcp-${Date.now()}-${p.name}`, name: p.name, transport: p.transport, endpoint: p.endpoint, enabled: true, toolCount: 0, tools: [], test: 'idle' };
        if (idx >= 0) merged[idx] = { ...merged[idx], transport: p.transport, endpoint: p.endpoint };
        else merged.push(next);
      });
      return merged;
    });
    setJsonError(null);
    setAddOpen(false);
  };

  const runTest = (id: string) => {
    patch(id, { test: 'testing' });
    window.setTimeout(() => {
      const s = servers.find((x) => x.id === id);
      const ok = !!s && s.endpoint.length > 0;
      patch(id, { test: ok ? 'ok' : 'fail', toolCount: ok ? Math.max(s!.toolCount, 1) : s!.toolCount });
    }, 700);
  };

  const TRANSPORT_COLOR: Record<Transport, string> = { stdio: '#722ed1', http: '#1677ff', sse: '#13a8a8' };

  return (
    <div style={{ maxWidth: 860 }}>
      <SectionCard
        title="MCP 服务器"
        desc="管理 Model Context Protocol 服务器，支持 stdio / http / sse 三种传输；可测试连通并查看其提供的工具。"
        action={<PrimaryBtn icon={Plus} label="添加服务器" onClick={() => setAddOpen((v) => !v)} />}
      >
        {addOpen ? (
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, marginBottom: 16, backgroundColor: T.bg }}>
            {/* mode switch: single form vs JSON config import */}
            <div style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 8, backgroundColor: T.fillTertiary, marginBottom: 12 }}>
              {(['form', 'json'] as const).map((m) => {
                const on = addMode === m;
                return (
                  <span
                    key={m}
                    onClick={() => setAddMode(m)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 12px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      color: on ? T.primary : T.textSecondary,
                      backgroundColor: on ? T.white : 'transparent',
                    }}
                  >
                    {m === 'form' ? <Plus size={13} /> : <FileJson size={13} />}
                    {m === 'form' ? '单个添加' : 'JSON 导入'}
                  </span>
                );
              })}
            </div>

            {addMode === 'form' ? (
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="服务器名称" style={{ ...inputStyle, flex: 1 }} />
                  <Select
                    value={draft.transport}
                    width={120}
                    options={(['stdio', 'http', 'sse'] as Transport[]).map((t) => ({ id: t, label: t }))}
                    onChange={(v) => setDraft({ ...draft, transport: v as Transport })}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={draft.endpoint}
                    onChange={(e) => setDraft({ ...draft, endpoint: e.target.value })}
                    placeholder={draft.transport === 'stdio' ? '启动命令，如 npx @pt/mcp-xxx' : 'https://…'}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <PrimaryBtn label="添加" onClick={addServer} />
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12, color: T.textTertiary, marginBottom: 8 }}>
                  粘贴标准 mcpServers 配置（兼容 Claude Desktop / Cursor）：stdio 用 command + args，http/sse 用 url。同名服务器将被覆盖。
                </div>
                <textarea
                  value={jsonText}
                  onChange={(e) => {
                    setJsonText(e.target.value);
                    if (jsonError) setJsonError(null);
                  }}
                  rows={10}
                  spellCheck={false}
                  style={{ ...inputStyle, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, lineHeight: '18px', resize: 'vertical' }}
                />
                {jsonError ? (
                  <div style={{ fontSize: 12, color: '#cf1322', marginTop: 8 }}>{jsonError}</div>
                ) : null}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                  <PrimaryBtn icon={FileJson} label="导入配置" onClick={importJson} />
                </div>
              </>
            )}
          </div>
        ) : null}

        {servers.length === 0 ? (
          <div style={{ fontSize: 13, color: T.textTertiary, padding: '8px 0' }}>暂无 MCP 服务器。</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {servers.map((s, i) => {
              const isEditing = editing === s.id;
              return (
                <div key={s.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${T.borderSoft}`, padding: '12px 0' }}>
                  {isEditing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input value={s.name} onChange={(e) => patch(s.id, { name: e.target.value })} style={{ ...inputStyle, flex: 1 }} placeholder="名称" />
                        <Select
                          value={s.transport}
                          width={120}
                          options={(['stdio', 'http', 'sse'] as Transport[]).map((t) => ({ id: t, label: t }))}
                          onChange={(v) => patch(s.id, { transport: v as Transport })}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input value={s.endpoint} onChange={(e) => patch(s.id, { endpoint: e.target.value })} style={{ ...inputStyle, flex: 1 }} placeholder={s.transport === 'stdio' ? '启动命令' : 'https://…'} />
                        <GhostBtn icon={CheckCircle2} label="完成" onClick={() => setEditing(null)} />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Plug size={18} color={T.textTertiary} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{s.name}</span>
                            <Tag text={s.transport} color={TRANSPORT_COLOR[s.transport]} />
                            {s.toolCount > 0 ? (
                              <span
                                onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                                style={{ fontSize: 11, color: T.primary, cursor: 'pointer' }}
                              >
                                {s.toolCount} 个工具
                              </span>
                            ) : null}
                          </div>
                          <div style={{ fontSize: 12, color: T.textTertiary, marginTop: 2, fontFamily: 'ui-monospace, Menlo, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {s.endpoint}
                          </div>
                        </div>
                        <GhostBtn icon={Pencil} label="编辑" onClick={() => setEditing(s.id)} />
                        <GhostBtn
                          icon={s.test === 'testing' ? Loader2 : s.test === 'ok' ? CheckCircle2 : s.test === 'fail' ? XCircle : Activity}
                          label={s.test === 'testing' ? '测试中…' : s.test === 'ok' ? '正常' : s.test === 'fail' ? '失败' : '测试'}
                          onClick={() => runTest(s.id)}
                        />
                        <Toggle on={s.enabled} onToggle={() => patch(s.id, { enabled: !s.enabled })} />
                        <Trash2 size={15} color={T.textTertiary} style={{ cursor: 'pointer' }} onClick={() => remove(s.id)} />
                      </div>
                      {expanded === s.id && s.tools.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, marginLeft: 30 }}>
                          {s.tools.map((t) => (
                            <Tag key={t} text={t} color={T.textSecondary} />
                          ))}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ── page shell ────────────────────────────────────────────────────────────────

type SectionId = 'agents' | 'providers' | 'skills' | 'mcp';

const SECTIONS: { id: SectionId; label: string; icon: LucideIcon; subtitle: string }[] = [
  { id: 'agents', label: 'Agent 管理', icon: Bot, subtitle: '管理 Agent 的默认模型与可见范围。' },
  { id: 'providers', label: 'Providers', icon: Server, subtitle: '配置模型提供商、密钥与可用模型。' },
  { id: 'skills', label: 'Skills', icon: ScrollText, subtitle: '管理与导入可复用的技能包。' },
  { id: 'mcp', label: 'MCP', icon: Plug, subtitle: '管理 MCP 服务器与其提供的工具。' },
];

export function SettingsPage() {
  const [section, setSection] = useState<SectionId>('agents');
  const [providers, setProviders] = useState<Provider[]>(INITIAL_PROVIDERS);
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  return (
    <div style={{ height: '100%', display: 'flex', backgroundColor: T.bg }}>
      {/* section nav */}
      <div
        style={{
          width: 220,
          flexShrink: 0,
          borderRight: `1px solid ${T.border}`,
          backgroundColor: T.navBg,
          display: 'flex',
          flexDirection: 'column',
          padding: '16px 10px',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: T.text, padding: '0 8px 12px' }}>设置</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: T.textQuaternary, padding: '6px 8px 4px', letterSpacing: 0.4 }}>AI</div>
        {SECTIONS.map((s) => {
          const active = s.id === section;
          const Icon = s.icon;
          return (
            <div
              key={s.id}
              onClick={() => setSection(s.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 8,
                cursor: 'pointer',
                color: active ? T.primary : T.textSecondary,
                backgroundColor: active ? T.primaryWash : 'transparent',
                fontSize: 13,
                fontWeight: active ? 600 : 500,
              }}
            >
              <Icon size={16} />
              <span style={{ flex: 1 }}>{s.label}</span>
            </div>
          );
        })}
      </div>

      {/* content */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
        <div style={{ padding: '24px 32px 48px' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: T.text, marginBottom: 4 }}>{current.label}</div>
          <div style={{ fontSize: 13, color: T.textTertiary, marginBottom: 24 }}>{current.subtitle}</div>
          {section === 'agents' ? <AgentSection providers={providers} /> : null}
          {section === 'providers' ? <ProvidersSection providers={providers} setProviders={setProviders} /> : null}
          {section === 'skills' ? <SkillsSection /> : null}
          {section === 'mcp' ? <MCPSection /> : null}
        </div>
      </div>
    </div>
  );
}
