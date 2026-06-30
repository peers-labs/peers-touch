import { useState } from 'react';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Image as ImageIcon,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Send,
  Settings2,
  Share2,
  Sparkles,
  UserRound,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { T } from './theme';

interface AgentSummary {
  id: string;
  name: string;
  icon: LucideIcon;
  desc: string;
  pinned?: boolean;
  active?: boolean;
}

interface Topic {
  id: string;
  title: string;
  group: string;
}

const AGENTS: AgentSummary[] = [
  {
    id: 'devops',
    name: 'DevOps Agent',
    icon: Network,
    desc: 'GDPA 智能助手，支持服务治理、监控查询、代码分析、环境管理等研发全流程。',
    pinned: true,
    active: true,
  },
  {
    id: 'automation',
    name: 'AI UI Automation',
    icon: Sparkles,
    desc: 'AI UI automation agent for the workspace.',
  },
  {
    id: 'terminal',
    name: 'Terminal',
    icon: Settings2,
    desc: 'Terminal 终端助手，帮助你在本地执行命令。',
  },
  {
    id: 'mcp',
    name: 'MCP-Tester',
    icon: Cloud,
    desc: '测试 MCP Server 是否可用。',
  },
  {
    id: 'oncall',
    name: 'Oncall Master',
    icon: Network,
    desc: 'Oncall 知识管理与智能助手。',
  },
  {
    id: 'ui-test',
    name: 'UI test',
    icon: UserRound,
    desc: 'UI test agent for mobile and Tiktok LIVE.',
  },
  {
    id: 'codex',
    name: 'UI test codex',
    icon: Bot,
    desc: 'TikTok LIVE mobile UI test engineer.',
  },
];

const TOPICS: Topic[] = [
  { id: 'cursor-config', title: '怎么配置 cursor CLI', group: 'Today' },
  { id: 'normal-use', title: '可以正常使用吗', group: 'Today' },
  { id: 'cursor-check', title: '嗨，你现在是 cursor 吗', group: 'Today' },
  { id: 'agent-use', title: '哨，现在我是不是可以使用 agent...', group: 'Today' },
  { id: 'branch', title: '当前分支是哪个分支', group: 'Yesterday' },
];

const QUICK_ACTIONS = ['查询服务 Metrics 监控数据', '查看服务日志和 Trace', '管理 BOE/PPE 环境', '查询 TCC 配置'];

export function AgentChatPage({
  onOpenOrchestration,
  onOpenProfile,
}: {
  onOpenOrchestration: () => void;
  onOpenProfile: () => void;
}) {
  const [selectedAgentId, setSelectedAgentId] = useState('devops');
  const [agentListOpen, setAgentListOpen] = useState(true);
  const selectedAgent = AGENTS.find((agent) => agent.id === selectedAgentId) ?? AGENTS[0];
  const pinned = AGENTS.filter((agent) => agent.pinned);
  const others = AGENTS.filter((agent) => !agent.pinned);

  return (
    <div style={styles.root}>
      <aside style={{ ...styles.agentList, width: agentListOpen ? 230 : 48, padding: agentListOpen ? '14px 10px 58px' : '14px 0 58px' }}>
        {agentListOpen ? (
          <>
            <div style={styles.agentHeader}>
              <div style={styles.agentTitle}>My Agents</div>
              <button style={styles.iconButton} title="新建 Agent">
                <Plus size={15} />
              </button>
              <button style={styles.iconButton} title="打开 Agent 编排" onClick={onOpenOrchestration}>
                <Workflow size={15} />
              </button>
            </div>
            <div style={styles.agentListScroll}>
              <div style={styles.searchBox}>
                <Search size={14} />
                <span>Search agents...</span>
              </div>
              <RosterGroup label="Pinned" />
              {pinned.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  active={agent.id === selectedAgentId}
                  onClick={() => setSelectedAgentId(agent.id)}
                />
              ))}
              <RosterGroup label="All Agents" />
              {others.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  active={agent.id === selectedAgentId}
                  onClick={() => setSelectedAgentId(agent.id)}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            <button style={styles.collapsedSearchButton} title="新建 Agent">
              <Plus size={16} />
            </button>
            <button style={{ ...styles.collapsedSearchButton, margin: '0 auto 2px' }} title="搜索 Agent" onClick={() => setAgentListOpen(true)}>
              <Search size={16} />
            </button>
            <div style={styles.collapsedAgentRail}>
              <CollapsedRosterGroup />
              {pinned.map((agent) => (
                <button
                  key={agent.id}
                  style={{
                    ...styles.collapsedAgentButton,
                    background: agent.id === selectedAgentId ? '#eef4ff' : 'transparent',
                  }}
                  title={agent.name}
                  onClick={() => {
                    setSelectedAgentId(agent.id);
                    setAgentListOpen(true);
                  }}
                >
                  <AgentIcon agent={agent} size={30} />
                </button>
              ))}
              <CollapsedRosterGroup />
              {others.map((agent) => (
                <button
                  key={agent.id}
                  style={{
                    ...styles.collapsedAgentButton,
                    background: agent.id === selectedAgentId ? '#eef4ff' : 'transparent',
                  }}
                  title={agent.name}
                  onClick={() => {
                    setSelectedAgentId(agent.id);
                    setAgentListOpen(true);
                  }}
                >
                  <AgentIcon agent={agent} size={30} />
                </button>
              ))}
            </div>
          </>
        )}
        <button
          style={styles.collapseButton}
          title={agentListOpen ? '折叠 Agent 列表' : '展开 Agent 列表'}
          onClick={() => setAgentListOpen((open) => !open)}
        >
          {agentListOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
      </aside>

      <aside style={styles.topicList}>
        <div style={styles.agentCard}>
          <AgentIcon agent={selectedAgent} size={44} />
          <div style={{ minWidth: 0 }}>
            <div style={styles.cardName}>{selectedAgent.name}</div>
            <div style={styles.cardDesc}>{selectedAgent.desc}</div>
          </div>
          <Sparkles size={14} color="#faad14" />
        </div>

        <button style={styles.topicAction}>
          <Plus size={15} />
          Start New Topic
        </button>
        <button style={styles.topicAction} onClick={onOpenProfile}>
          <UserRound size={15} />
          Agent Profile
        </button>
        <button style={styles.topicAction}>
          <Search size={15} />
          Search
        </button>

        <div style={styles.topicHeader}>
          <span>Topic 5</span>
          <Settings2 size={13} />
        </div>
        {['Today', 'Yesterday'].map((group) => (
          <div key={group}>
            <div style={styles.groupLine}>
              <ChevronDown size={13} />
              {group}
            </div>
            {TOPICS.filter((topic) => topic.group === group).map((topic) => (
              <div key={topic.id} style={styles.topicItem}>
                <span>#</span>
                <span>{topic.title}</span>
              </div>
            ))}
          </div>
        ))}
      </aside>

      <main style={styles.chat}>
        <header style={styles.chatHeader}>
          <AgentIcon agent={selectedAgent} size={40} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={styles.chatName}>
              {selectedAgent.name}
              <span style={styles.badge}>composer-2-fast</span>
              <span style={styles.badge}>Cursor CLI</span>
            </div>
            <div style={styles.chatDesc}>{selectedAgent.desc}</div>
          </div>
          <Share2 size={15} color={T.textTertiary} />
          <Settings2 size={15} color={T.textTertiary} />
          <Cloud size={15} color={T.textTertiary} />
        </header>

        <section style={styles.emptyChat}>
          <div style={styles.welcomeCard}>
            <AgentIcon agent={selectedAgent} size={48} />
            <div style={styles.welcomeTitle}>{selectedAgent.name}</div>
            <div style={styles.capabilityBar}>
              <span><CheckCircle2 size={13} /> Tools enabled</span>
              <span>Cursor CLI</span>
              <span>Memory</span>
            </div>
            <p style={styles.welcomeText}>
              你好，我是 {selectedAgent.name}。我可以帮你查询服务监控、排查问题、管理配置和环境、分析代码等。请告诉我你需要什么帮助？
            </p>
            <span style={styles.modelBadge}>composer-2-fast</span>
          </div>

          <div style={styles.quickActions}>
            {QUICK_ACTIONS.map((action) => (
              <button key={action} style={styles.quickAction}>
                <Network size={13} />
                {action}
              </button>
            ))}
          </div>
        </section>

        <section style={styles.composer}>
          <textarea
            style={styles.composerInput}
            placeholder="Ask anything..."
            rows={2}
          />
          <div style={styles.composerToolbar}>
            <div style={{ flex: 1 }} />
            <button style={styles.modelButton}>Doubao Pro</button>
            <button style={styles.sendButton} title="Send"><Send size={28} /></button>
          </div>
        </section>
      </main>
    </div>
  );
}

function RosterGroup({ label }: { label: string }) {
  return <div style={styles.rosterGroup}>{label}</div>;
}

function CollapsedRosterGroup() {
  return (
    <div style={styles.collapsedRosterGroup}>
      <span style={styles.collapsedRosterGroupLine} />
    </div>
  );
}

function AgentRow({ agent, active, onClick }: { agent: AgentSummary; active: boolean; onClick: () => void }) {
  return (
    <button style={{ ...styles.agentRow, background: active ? '#eef4ff' : 'transparent' }} onClick={onClick}>
      <AgentIcon agent={agent} size={30} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={styles.rowName}>{agent.name}{agent.pinned ? ' ★' : ''}</span>
        <span style={styles.rowDesc}>{agent.desc}</span>
      </span>
      <MoreHorizontal size={14} color={T.textTertiary} />
    </button>
  );
}

function AgentIcon({ agent, size }: { agent: AgentSummary; size: number }) {
  const Icon = agent.icon;
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(8, size / 4),
        background: agent.active ? T.primaryWash : T.navBg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: size > 36 ? 20 : 13,
        color: agent.active ? T.primary : T.textSecondary,
        overflow: 'hidden',
      }}
    >
      <Icon size={Math.max(14, Math.round(size * 0.48))} />
    </span>
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

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: '100%',
    height: '100%',
    display: 'flex',
    background: '#fff',
    color: T.text,
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  agentList: {
    width: 230,
    flexShrink: 0,
    borderRight: `1px solid ${T.border}`,
    background: '#fbfbfb',
    padding: '14px 10px',
    boxSizing: 'border-box',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    position: 'relative',
  },
  agentListScroll: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
  },
  agentHeader: {
    height: 40,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  agentTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: 800,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 999,
    border: `1px solid ${T.border}`,
    background: '#fff',
    color: T.textSecondary,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  collapseButton: {
    width: 34,
    height: 34,
    borderRadius: 999,
    border: 0,
    background: 'transparent',
    color: T.textSecondary,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: 'none',
    flexShrink: 0,
    position: 'absolute',
    left: 7,
    bottom: 14,
  },
  collapsedSearchButton: {
    width: 40,
    height: 40,
    border: 0,
    borderRadius: 12,
    background: 'transparent',
    color: T.textSecondary,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    margin: '0 auto 10px',
  },
  collapsedAgentRail: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 0,
    width: '100%',
  },
  collapsedAgentButton: {
    width: 40,
    height: 48,
    border: 0,
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  searchBox: {
    height: 40,
    border: `1px solid ${T.border}`,
    borderRadius: 7,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '0 8px',
    color: T.textQuaternary,
    fontSize: 12,
    background: '#fff',
  },
  rosterGroup: {
    margin: '12px 0 6px',
    color: T.textTertiary,
    fontSize: 12,
    fontWeight: 650,
    height: 18,
    lineHeight: '18px',
  },
  collapsedRosterGroup: {
    width: 40,
    height: 18,
    margin: '12px auto 6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapsedRosterGroupLine: {
    width: 18,
    height: 1,
    background: T.border,
  },
  agentRow: {
    width: '100%',
    height: 48,
    border: 0,
    borderRadius: 10,
    padding: '7px 8px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    cursor: 'pointer',
    textAlign: 'left',
  },
  rowName: {
    display: 'block',
    color: T.text,
    fontSize: 12,
    fontWeight: 750,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  rowDesc: {
    display: 'block',
    color: T.textTertiary,
    fontSize: 11,
    marginTop: 2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  topicList: {
    width: 260,
    flexShrink: 0,
    borderRight: `1px solid ${T.border}`,
    background: '#fff',
    padding: '16px 14px',
    boxSizing: 'border-box',
    overflow: 'auto',
  },
  agentCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 22,
    background: '#fff',
    boxShadow: '0 14px 40px rgba(0,0,0,0.08)',
    marginBottom: 12,
  },
  cardName: {
    fontSize: 24,
    fontWeight: 850,
  },
  cardDesc: {
    marginTop: 3,
    color: T.textTertiary,
    fontSize: 11,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  topicAction: {
    width: '100%',
    height: 30,
    border: 0,
    background: 'transparent',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: T.text,
    fontSize: 12,
    cursor: 'pointer',
    textAlign: 'left',
  },
  topicHeader: {
    marginTop: 14,
    display: 'flex',
    justifyContent: 'space-between',
    color: T.textSecondary,
    fontSize: 12,
    fontWeight: 700,
  },
  groupLine: {
    marginTop: 10,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    color: T.textTertiary,
    fontSize: 11,
  },
  topicItem: {
    height: 28,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    color: T.textSecondary,
    fontSize: 12,
  },
  chat: {
    flex: 1,
    minWidth: 0,
    position: 'relative',
    background: '#fff',
    display: 'flex',
    flexDirection: 'column',
  },
  chatHeader: {
    margin: '16px 18px 0',
    height: 78,
    borderRadius: 18,
    background: '#fff',
    boxShadow: '0 12px 35px rgba(0,0,0,0.06)',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '0 18px',
    boxSizing: 'border-box',
  },
  chatName: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
    fontWeight: 850,
  },
  badge: {
    padding: '2px 7px',
    borderRadius: 999,
    border: `1px solid ${T.border}`,
    color: T.textSecondary,
    fontSize: 11,
    fontWeight: 650,
  },
  chatDesc: {
    marginTop: 4,
    color: T.textSecondary,
    fontSize: 12,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  emptyChat: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  welcomeCard: {
    width: 430,
    borderRadius: 18,
    background: '#fff',
    boxShadow: '0 24px 70px rgba(0,0,0,0.08)',
    padding: 28,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
  },
  welcomeTitle: {
    marginTop: 12,
    fontSize: 18,
    fontWeight: 900,
  },
  capabilityBar: {
    marginTop: 12,
    minHeight: 28,
    borderRadius: 8,
    background: T.fillQuaternary,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '0 12px',
    color: T.textTertiary,
    fontSize: 11,
  },
  welcomeText: {
    maxWidth: 330,
    color: T.textSecondary,
    fontSize: 13,
    lineHeight: 1.6,
  },
  modelBadge: {
    borderRadius: 6,
    background: T.fillQuaternary,
    color: T.textTertiary,
    fontSize: 11,
    padding: '4px 10px',
  },
  quickActions: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    maxWidth: 560,
  },
  quickAction: {
    border: 0,
    background: 'transparent',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    color: T.text,
    fontSize: 12,
    fontWeight: 650,
    cursor: 'pointer',
  },
  composer: {
    width: 'min(1068px, calc(100% - 160px))',
    minHeight: 256,
    margin: '0 auto 48px',
    borderRadius: 40,
    background: '#fff',
    border: '1px solid #d9d9d9',
    boxShadow: '0 18px 64px rgba(15,23,42,0.06)',
    padding: '34px 36px 28px',
    boxSizing: 'border-box',
  },
  composerPlaceholder: {
    color: T.textTertiary,
    fontSize: 12,
    marginBottom: 24,
  },
  composerInput: {
    width: '100%',
    minHeight: 112,
    border: 0,
    outline: 'none',
    resize: 'none',
    color: T.text,
    fontSize: 28,
    lineHeight: 1.35,
    fontFamily: 'inherit',
    background: 'transparent',
    boxSizing: 'border-box',
  },
  composerToolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  plainToolButton: {
    width: 34,
    height: 34,
    border: 0,
    borderRadius: 10,
    background: 'transparent',
    color: '#1f1f1f',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  modelButton: {
    minHeight: 58,
    border: 0,
    borderRadius: 999,
    background: T.fillQuaternary,
    color: T.textTertiary,
    padding: '0 24px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 13,
    fontWeight: 650,
    cursor: 'pointer',
  },
  modelSelect: {
    height: 30,
    border: `1px solid ${T.border}`,
    borderRadius: 8,
    background: '#fff',
    color: T.text,
    padding: '0 10px',
    fontSize: 12,
  },
  sendButton: {
    width: 58,
    height: 58,
    border: 0,
    borderRadius: 22,
    background: T.fillQuaternary,
    color: T.textQuaternary,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};
