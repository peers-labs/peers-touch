// Agent Prototype — Agent Profile Editor (Center Panel)
// Matches production AgentProfilePage.tsx center layout:
// - Hero: editable title (fontSize 24, fontWeight 800) + square avatar (64px) + description textarea
// - Model config row: grid card with Provider -> Model -> Effort selects
// - Mode switch: pill segmented control (Configure / Activity)
// - Tab bar: underline style (2px bottom border on active) with icons
// - Tab content: SOUL/AGENTS (two monospace textareas side by side), Capabilities, Workspace

import { type CSSProperties, useState, useCallback } from 'react';
import {
  Save,
  ArrowLeft,
  Sparkles,
  Wrench,
  FolderOpen,
  Cpu,
} from 'lucide-react';
import { T } from '../theme';
import { toast } from '../../../../shared/Toast';
import type { Agent } from '../types';

// -- Tab definitions matching production TAB_KEYS --

type ProfileTab = 'soul' | 'capabilities' | 'workspace' | 'tasks' | 'memories' | 'diagnostics';
type ProfileMode = 'configure' | 'activity';

const CONFIGURE_TABS: { key: ProfileTab; label: string; icon: typeof Wrench | null }[] = [
  { key: 'soul', label: 'SOUL / AGENTS', icon: null },
  { key: 'capabilities', label: 'Capabilities', icon: Wrench },
  { key: 'workspace', label: 'Workspace', icon: FolderOpen },
];

const ACTIVITY_TABS: { key: ProfileTab; label: string; icon: typeof Wrench | null }[] = [
  { key: 'tasks', label: 'Tasks', icon: null },
  { key: 'memories', label: 'Memories', icon: null },
  { key: 'diagnostics', label: 'Diagnostics', icon: null },
];

// -- Mock data for tabs --

const MOCK_SOUL_MD = `# SOUL.md

## Identity
You are a travel planning assistant specializing in practical itineraries,
local experiences, transportation, accommodation, and trip preparation.

## Behavior
- Ask for destination, dates, companions, and travel pace
- Balance must-see places with realistic travel time
- Explain tradeoffs and keep every itinerary easy to adjust
`;

const MOCK_AGENTS_MD = `# AGENTS.md

## Workflow
- Route Planner: drafts the day-by-day itinerary
- Local Guide: recommends food and local experiences
- Travel Checker: verifies transport time and opening hours

## Delegation Rules
- Booking or payment always requires user confirmation
- Conflicting schedules return to the planner for adjustment
`;

const MOCK_SKILLS = [
  { id: 'sk-1', name: 'Itinerary Planning', type: 'builtin' },
  { id: 'sk-2', name: 'Destination Research', type: 'builtin' },
  { id: 'sk-3', name: 'Packing Checklist', type: 'custom' },
];

const MOCK_TOOLS = [
  { id: 'tool-1', name: 'maps_search', kind: 'tool' },
  { id: 'tool-2', name: 'weather_lookup', kind: 'tool' },
];

const MOCK_MCP = [
  { id: 'mcp-1', name: 'travel-guides', kind: 'mcp' },
  { id: 'mcp-2', name: 'transit-planner', kind: 'mcp' },
];

// -- Component --

interface AgentProfileProps {
  agent: Agent;
  onBack?: () => void;
}

export function AgentProfile({ agent, onBack }: AgentProfileProps) {
  const [title, setTitle] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const [activeMode, setActiveMode] = useState<ProfileMode>('configure');
  const [activeTab, setActiveTab] = useState<ProfileTab>('soul');
  const [soulMd, setSoulMd] = useState(() =>
    agent.id === 'devops'
      ? MOCK_SOUL_MD
      : `# SOUL.md\n\n## Identity\nYou are ${agent.name}.\n\n${agent.description}\n\n## Behavior\n- Explain intent before acting\n- Keep work focused and verifiable\n- Ask before risky or irreversible actions\n`,
  );
  const [agentsMd, setAgentsMd] = useState(() =>
    agent.id === 'devops'
      ? MOCK_AGENTS_MD
      : `# AGENTS.md\n\n## Workflow\n- Understand the user goal\n- Use the capabilities bound to this agent\n- Return evidence with the result\n\n## Delegation Rules\n- Delegate only when another agent has a clearer capability fit\n`,
  );

  const handleSave = useCallback(() => {
    try {
      const payload = { id: agent.id, title, description, soulMd, agentsMd };
      localStorage.setItem(`agent-profile-${agent.id}`, JSON.stringify(payload));
      toast.success('Saved');
    } catch {
      toast.error('Save failed');
    }
  }, [agent.id, title, description, soulMd, agentsMd]);

  return (
    <div style={S.shell}>
      <div style={S.scrollContainer}>
        <div style={S.centeredContent}>
          {/* ---- Hero Section ---- */}
          <div style={S.hero}>
            {/* Title row: editable title + action buttons */}
            <div style={S.titleRow}>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Agent title..."
                style={S.titleInput}
              />
              <div style={S.titleActions}>
                <button type="button" style={S.iconBtn} title="保存" onClick={handleSave}>
                  <Save size={14} color={T.text.secondary} />
                </button>
                <button type="button" style={S.iconBtn} title="返回" onClick={onBack}>
                  <ArrowLeft size={14} color={T.text.secondary} />
                </button>
              </div>
            </div>

            {/* Avatar + Description */}
            <div style={S.avatarDescRow}>
              <span style={{ ...S.heroAvatar, backgroundColor: agent.avatar }}>
                <span style={S.heroAvatarLetter}>{agent.name.charAt(0).toUpperCase()}</span>
              </span>
              <div style={S.descriptionWrap}>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Describe what this agent does..."
                  style={S.descriptionTextarea}
                />
                <button type="button" style={S.rewriteBtn} title="AI Rewrite">
                  <Sparkles size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* ---- Model Config Row (grid card) ---- */}
          <div style={S.modelCard}>
            <select style={S.modelSelect} defaultValue={agent.provider}>
              <option value="Anthropic">Anthropic</option>
              <option value="OpenAI">OpenAI</option>
              <option value="Google">Google</option>
              <option value="Station">Station</option>
            </select>
            <span style={S.modelArrow}>&rarr;</span>
            <select style={S.modelSelectWide} defaultValue={agent.model}>
              <option value="Claude Sonnet 4">Claude Sonnet 4</option>
              <option value="Claude Opus 4">Claude Opus 4</option>
              <option value="GPT-5.5">GPT-5.5</option>
              <option value="Gemini 2.5 Pro">Gemini 2.5 Pro</option>
            </select>
            <span style={S.modelDot}>&middot;</span>
            <select style={S.modelSelectSmall} defaultValue="medium">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>

          {/* ---- Mode Switch (pill segmented) ---- */}
          <div style={S.modeSwitch}>
            {(['configure', 'activity'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => { setActiveMode(mode); setActiveTab(mode === 'configure' ? 'soul' : 'tasks'); }}
                style={{
                  ...S.modePill,
                  background: activeMode === mode ? T.surface.canvas : 'transparent',
                  color: activeMode === mode ? T.text.primary : T.text.muted,
                  boxShadow: activeMode === mode ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                }}
              >
                {mode === 'configure' ? 'Configure' : 'Activity'}
              </button>
            ))}
          </div>

          {/* ---- Tab Bar (underline style) ---- */}
          <div style={S.tabBar}>
            {(activeMode === 'configure' ? CONFIGURE_TABS : ACTIVITY_TABS).map((tab) => {
              const active = activeTab === tab.key;
              const Icon = tab.icon;
              return (
                <div
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    ...S.tabItem,
                    color: active ? T.action.primary : T.text.secondary,
                    borderBottomColor: active ? T.action.primary : 'transparent',
                  }}
                >
                  {Icon && (
                    <span style={S.tabIcon}>
                      <Icon size={13} />
                    </span>
                  )}
                  <span>{tab.label}</span>
                </div>
              );
            })}
          </div>

          {/* ---- Tab Content ---- */}
          <div style={S.tabContent}>
            {activeTab === 'soul' && <SoulTab soulMd={soulMd} agentsMd={agentsMd} onSoulChange={setSoulMd} onAgentsChange={setAgentsMd} />}
            {activeTab === 'capabilities' && <CapabilitiesTab />}
            {activeTab === 'workspace' && <WorkspaceTab agent={agent} />}
            {activeTab === 'tasks' && <ActivityPlaceholder title="Tasks" description="Agent turn history, delegations, and tool calls will appear here." />}
            {activeTab === 'memories' && <ActivityPlaceholder title="Memories" description="Identity, context, experience, and preference memories for this agent." />}
            {activeTab === 'diagnostics' && <ActivityPlaceholder title="Diagnostics" description="Event stream, errors, and runtime diagnostics." />}
          </div>
        </div>
      </div>
    </div>
  );
}

// -- SOUL Tab: two side-by-side monospace textareas in ProfileCard containers --

function SoulTab({
  soulMd,
  agentsMd,
  onSoulChange,
  onAgentsChange,
}: {
  soulMd: string;
  agentsMd: string;
  onSoulChange: (v: string) => void;
  onAgentsChange: (v: string) => void;
}) {
  return (
    <div style={S.soulGrid}>
      <ProfileCard title="SOUL.md">
        <div style={S.textareaWrap}>
          <textarea
            value={soulMd}
            onChange={(e) => onSoulChange(e.target.value)}
            placeholder="Define the agent's identity, behavior, and guidelines..."
            style={S.codeTextarea}
          />
        </div>
      </ProfileCard>
      <ProfileCard title="AGENTS.md">
        <div style={S.textareaWrap}>
          <textarea
            value={agentsMd}
            onChange={(e) => onAgentsChange(e.target.value)}
            placeholder="Define the agent's workflow and delegation rules..."
            style={S.codeTextarea}
          />
        </div>
      </ProfileCard>
    </div>
  );
}

// -- Capabilities Tab --

function CapabilitiesTab() {
  return (
    <div style={S.capGrid}>
      <ProfileCard title="Skill Packages" description="Bound skills that extend this agent's capabilities">
        <div style={S.itemList}>
          {MOCK_SKILLS.map((skill) => (
            <div key={skill.id} style={S.itemRow}>
              <span style={S.skillIcon}>#</span>
              <span style={S.itemName}>{skill.name}</span>
              <span style={S.itemTag}>{skill.type}</span>
            </div>
          ))}
        </div>
      </ProfileCard>
      <ProfileCard title="Tools & MCP" description="Direct tool bindings and MCP server connections">
        <div style={S.itemList}>
          {MOCK_TOOLS.map((tool) => (
            <div key={tool.id} style={S.itemRow}>
              <Wrench size={15} color={T.text.muted} />
              <span style={S.itemName}>{tool.name}</span>
              <span style={S.itemTag}>tool</span>
            </div>
          ))}
          {MOCK_MCP.map((mcp) => (
            <div key={mcp.id} style={S.itemRow}>
              <Cpu size={15} color={T.text.muted} />
              <span style={S.itemName}>{mcp.name}</span>
              <span style={S.itemTag}>mcp</span>
            </div>
          ))}
        </div>
      </ProfileCard>
    </div>
  );
}

// -- Workspace Tab --

function WorkspaceTab({ agent }: { agent: Agent }) {
  return (
    <div style={S.workspaceGrid}>
      <ProfileCard title="Agent Workspace" description="Isolated execution environment for this agent">
        <InfoRow label="Workspace Root" value={agent.workspacePath || 'Not set'} />
        <InfoRow label="Workspace Mode" value="agent" />
        <InfoRow label="Retention Days" value="7" />
      </ProfileCard>
      <ProfileCard title="Access Boundary" description="Filesystem access restrictions for safety">
        <InfoRow label="Agent Workspace" value="Allowed" />
        <InfoRow label="Allowed Roots" value={agent.workspacePath || '(none)'} />
      </ProfileCard>
    </div>
  );
}

// -- ProfileCard --

function ProfileCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div style={S.card}>
      <div style={S.cardHeader}>
        <span style={S.cardTitle}>{title}</span>
        {description && <span style={S.cardDesc}>{description}</span>}
      </div>
      {children}
    </div>
  );
}

// -- InfoRow --

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={S.infoRow}>
      <span style={S.infoLabel}>{label}</span>
      <span style={S.infoValue}>{value}</span>
    </div>
  );
}

function ActivityPlaceholder({ title, description }: { title: string; description: string }) {
  const mockTasks = [
    { id: '1', title: 'Implement federation relay with QUIC transport', status: 'completed', source: 'turn', toolCount: 4, eventCount: 12, time: '2026-07-10 14:02' },
    { id: '2', title: 'Fix auth token refresh race condition', status: 'running', source: 'turn', toolCount: 2, eventCount: 5, time: '2026-07-11 09:15' },
    { id: '3', title: 'Refactor runtime projections ownership', status: 'failed', source: 'delegation', toolCount: 1, eventCount: 3, time: '2026-07-09 16:30' },
  ];
  const mockEvents = [
    { id: 'e1', kind: 'tool', status: 'completed', detail: 'Read relay/src/transport.rs', time: '14:03' },
    { id: 'e2', kind: 'tool', status: 'completed', detail: 'Write relay/src/quic_listener.rs', time: '14:04' },
    { id: 'e3', kind: 'approval', status: 'waiting', detail: 'git push origin feat/relay-v2', time: '14:05' },
    { id: 'e4', kind: 'error', status: 'failed', detail: 'Build failed: missing QUIC dependency', time: '14:06' },
  ];
  const mockMemories = [
    { id: 'm1', layer: 'identity', text: 'DevOps automation agent specializing in CI/CD', date: '2026-07-01' },
    { id: 'm2', layer: 'experience', text: 'QUIC transport requires explicit TLS config on macOS', date: '2026-07-10' },
    { id: 'm3', layer: 'preference', text: 'User prefers declarative Rust configs over YAML', date: '2026-07-08' },
  ];
  const statusColor: Record<string, string> = { completed: T.trust.success, running: T.action.primary, failed: T.trust.error, waiting: T.trust.warning };
  const layerColor: Record<string, string> = { identity: '#2f54eb', experience: '#52c41a', preference: '#fa8c16', context: '#13c2c2', activity: '#722ed1' };

  if (title === 'Tasks') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto', flex: 1 }}>
        {mockTasks.map((t) => (
          <div key={t.id} style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${T.border.hairline}`, background: T.surface.canvas }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.text.primary }}>{t.title}</span>
              <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: `${statusColor[t.status]}18`, color: statusColor[t.status], fontWeight: 600 }}>{t.status}</span>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: T.surface.subtle, color: T.text.muted }}>{t.source}</span>
              <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: T.surface.subtle, color: T.text.muted }}>{t.toolCount} tools</span>
              <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: T.surface.subtle, color: T.text.muted }}>{t.eventCount} events</span>
            </div>
            <span style={{ fontSize: 11, color: T.text.quaternary }}>{t.time}</span>
          </div>
        ))}
      </div>
    );
  }

  if (title === 'Memories') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto', flex: 1 }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
          {['identity', 'experience', 'preference'].map((l) => (
            <span key={l} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: `${layerColor[l]}18`, color: layerColor[l], fontWeight: 500 }}>{l}</span>
          ))}
        </div>
        {mockMemories.map((m) => (
          <div key={m.id} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${T.border.hairline}`, background: T.surface.canvas }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: `${layerColor[m.layer]}18`, color: layerColor[m.layer], fontWeight: 500 }}>{m.layer}</span>
              <span style={{ fontSize: 11, color: T.text.quaternary, marginLeft: 'auto' }}>{m.date}</span>
            </div>
            <span style={{ fontSize: 13, color: T.text.primary, lineHeight: 1.5 }}>{m.text}</span>
          </div>
        ))}
      </div>
    );
  }

  // Diagnostics
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto', flex: 1 }}>
      {mockEvents.map((e) => (
        <div key={e.id} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${T.border.hairline}`, background: T.surface.subtle }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: T.surface.canvas, color: T.text.muted, border: `1px solid ${T.border.hairline}` }}>{e.kind}</span>
              <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: `${statusColor[e.status]}18`, color: statusColor[e.status], fontWeight: 500 }}>{e.status}</span>
            </div>
            <span style={{ fontSize: 11, color: T.text.quaternary }}>{e.time}</span>
          </div>
          <span style={{ fontSize: 12, color: T.text.secondary }}>{e.detail}</span>
        </div>
      ))}
    </div>
  );
}

// -- Styles --

const S: Record<string, CSSProperties> = {
  shell: {
    flex: 1,
    minWidth: 680,
    minHeight: 0,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
  },
  scrollContainer: {
    flex: 1,
    minHeight: 0,
    padding: '0 32px 0',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  centeredContent: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    maxWidth: 980,
    margin: '0 auto',
    width: '100%',
  },

  // Hero
  hero: {
    paddingTop: 8,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    minWidth: 0,
  },
  titleInput: {
    flex: 1,
    minWidth: 0,
    border: 0,
    outline: 'none',
    background: 'transparent',
    color: T.text.primary,
    fontSize: 24,
    fontWeight: 800,
    lineHeight: 1.15,
    letterSpacing: -0.3,
    padding: 0,
  },
  titleActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  iconBtn: {
    width: 32,
    height: 32,
    border: `1px solid ${T.border.hairline}`,
    borderRadius: 8,
    background: 'transparent',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  backBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    height: 32,
    padding: '0 12px',
    border: `1px solid ${T.border.hairline}`,
    borderRadius: 8,
    background: 'transparent',
    fontSize: 13,
    fontWeight: 500,
    color: T.text.secondary,
    cursor: 'pointer',
  },
  avatarDescRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 14,
    minWidth: 0,
  },
  heroAvatar: {
    width: 48,
    height: 48,
    borderRadius: 10,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  heroAvatarLetter: {
    fontSize: 22,
    fontWeight: 700,
    color: '#ffffff',
  },
  descriptionWrap: {
    position: 'relative' as const,
    flex: 1,
    minWidth: 0,
  },
  descriptionTextarea: {
    width: '100%',
    minHeight: 44,
    maxHeight: 80,
    resize: 'vertical' as const,
    border: `1px solid ${T.border.hairline}`,
    borderRadius: 12,
    outline: 'none',
    background: T.surface.canvas,
    color: T.text.secondary,
    fontFamily: 'inherit',
    fontSize: 13,
    lineHeight: 1.45,
    padding: '9px 38px 9px 10px',
    boxSizing: 'border-box' as const,
  },
  rewriteBtn: {
    position: 'absolute' as const,
    right: 8,
    bottom: 10,
    width: 26,
    height: 26,
    border: 0,
    borderRadius: 8,
    background: 'rgba(107, 91, 214, 0.08)',
    color: T.action.primary,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },

  // Model config card
  modelCard: {
    flexShrink: 0,
    marginTop: 10,
    marginBottom: 8,
    display: 'grid',
    gridTemplateColumns: 'minmax(130px, 190px) auto minmax(160px, 1fr) auto minmax(96px, 120px)',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    border: `1px solid ${T.border.hairline}`,
    background: T.surface.canvas,
    minWidth: 0,
  },
  modelSelect: {
    width: '100%',
    height: 32,
    padding: '0 8px',
    border: `1px solid ${T.border.hairline}`,
    borderRadius: 6,
    background: T.surface.canvas,
    fontSize: 13,
    color: T.text.primary,
    cursor: 'pointer',
    outline: 'none',
  },
  modelSelectWide: {
    width: '100%',
    height: 32,
    padding: '0 8px',
    border: `1px solid ${T.border.hairline}`,
    borderRadius: 6,
    background: T.surface.canvas,
    fontSize: 13,
    color: T.text.primary,
    cursor: 'pointer',
    outline: 'none',
  },
  modelSelectSmall: {
    width: '100%',
    height: 32,
    padding: '0 8px',
    border: `1px solid ${T.border.hairline}`,
    borderRadius: 6,
    background: T.surface.canvas,
    fontSize: 13,
    color: T.text.primary,
    cursor: 'pointer',
    outline: 'none',
  },
  modelArrow: {
    color: T.text.quaternary,
    fontSize: 13,
    textAlign: 'center' as const,
  },
  modelDot: {
    color: T.text.quaternary,
    fontSize: 13,
    textAlign: 'center' as const,
  },

  // Mode switch (pill segmented)
  modeSwitch: {
    alignSelf: 'flex-start',
    flexShrink: 0,
    display: 'flex',
    gap: 2,
    padding: 3,
    marginBottom: 8,
    borderRadius: 10,
    background: T.surface.subtle,
  },
  modePill: {
    height: 30,
    padding: '0 18px',
    borderRadius: 8,
    border: 0,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },

  // Tab bar (underline style)
  tabBar: {
    display: 'flex',
    gap: 4,
    flexShrink: 0,
    borderBottom: `1px solid ${T.border.hairline}`,
    marginBottom: 10,
    flexWrap: 'wrap' as const,
  },
  tabItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    borderBottom: '2px solid transparent',
    transition: 'color 0.2s, border-color 0.2s',
  },
  tabIcon: {
    width: 16,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  // Tab content
  tabContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    overflow: 'hidden',
  },

  // SOUL tab: two columns
  soulGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gridTemplateRows: '1fr',
    gap: 12,
    minHeight: 0,
    flex: 1,
  },
  codeTextarea: {
    width: '100%',
    height: '100%',
    minHeight: 0,
    padding: '12px 16px',
    borderRadius: 8,
    border: `1px solid ${T.border.hairline}`,
    background: T.surface.canvas,
    fontFamily: "'JetBrains Mono', 'Fira Code', SF Mono, Menlo, Consolas, monospace",
    fontSize: 13,
    lineHeight: 1.7,
    resize: 'none' as const,
    outline: 'none',
    color: T.text.primary,
    boxSizing: 'border-box' as const,
    overflow: 'auto',
    display: 'block',
  },
  textareaWrap: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  },

  // Capabilities tab
  capGrid: {
    display: 'grid',
    gridTemplateRows: '1fr 1fr',
    gap: 12,
    minHeight: 0,
    flex: 1,
  },
  itemList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    overflow: 'auto',
  },
  itemRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minHeight: 40,
    padding: '7px 10px',
    borderRadius: 12,
    border: `1px solid ${T.border.hairline}`,
    background: T.surface.canvas,
  },
  skillIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(107, 91, 214, 0.08)',
    color: T.action.primary,
    fontWeight: 800,
    fontSize: 13,
  },
  itemName: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: 700,
    color: T.text.primary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  itemTag: {
    padding: '2px 8px',
    borderRadius: 4,
    background: T.surface.subtle,
    fontSize: 11,
    color: T.text.muted,
    fontWeight: 500,
  },

  // Workspace tab
  workspaceGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: 12,
    flex: 1,
    alignContent: 'stretch',
  },

  // ProfileCard
  card: {
    padding: 10,
    borderRadius: 12,
    border: `1px solid ${T.border.hairline}`,
    background: T.surface.canvas,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    flex: 1,
    minHeight: 0,
  },
  cardHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: T.text.primary,
  },
  cardDesc: {
    fontSize: 12,
    color: T.text.muted,
  },

  // InfoRow
  infoRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '4px 0',
  },
  infoLabel: {
    fontSize: 12,
    color: T.text.secondary,
  },
  infoValue: {
    fontSize: 12,
    color: T.text.primary,
    textAlign: 'right' as const,
    minWidth: 0,
  },
};
