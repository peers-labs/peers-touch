import { useLayoutEffect, useRef, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Compass,
  MoreHorizontal,
  Network,
  Plus,
  Search,
  Settings2,
  Sparkles,
  List,
  X,
  UserRound,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { T } from './theme';
import { PanelToggleDock } from '../../shared/PanelToggleButton';
import { PromptComposer } from '../../shared/PromptComposer';
import { AgentProfile } from '../../features/agent/src/panels/AgentProfile';
import type { Agent as ProfileAgent } from '../../features/agent/src/types';

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
    name: '旅游小助手',
    icon: Compass,
    desc: '旅行规划助手，帮你设计行程、发现当地体验、整理交通住宿与出行提醒。',
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
  { id: 'tokyo-plan', title: '东京五天怎么安排', group: 'Today' },
  { id: 'family-hotel', title: '亲子酒店住在哪个区域', group: 'Today' },
  { id: 'rail-pass', title: '需要购买 JR Pass 吗', group: 'Today' },
  { id: 'food-map', title: '整理一份当地美食地图', group: 'Today' },
  { id: 'packing-list', title: '出发前行李清单', group: 'Yesterday' },
];

const QUICK_ACTIONS = ['规划 5 天游玩路线', '比较酒店与交通方案', '推荐当地特色体验', '整理出发前清单'];

export function AgentChatPage({
  onOpenOrchestration,
  profileOpen,
  onOpenProfile,
  onCloseProfile,
}: {
  onOpenOrchestration: () => void;
  profileOpen: boolean;
  onOpenProfile: () => void;
  onCloseProfile: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const narrowRef = useRef<boolean | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState('devops');
  const [agentListOpen, setAgentListOpen] = useState(true);
  const [narrow, setNarrow] = useState(false);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const selectedAgent = AGENTS.find((agent) => agent.id === selectedAgentId) ?? AGENTS[0];
  const isTravelAssistant = selectedAgent.id === 'devops';
  const quickActions = isTravelAssistant
    ? QUICK_ACTIONS
    : ['开始一个新任务', '查看可用能力', '打开 Agent 工作区', '检查最近运行'];
  const profileAgent: ProfileAgent = {
    id: selectedAgent.id,
    name: selectedAgent.name,
    avatar: selectedAgent.id === 'devops' ? '#6b5bd6' : '#596579',
    description: selectedAgent.desc,
    model: selectedAgent.id === 'devops' ? 'GPT-5.5' : 'Station Agent',
    provider: selectedAgent.id === 'devops' ? 'OpenAI' : 'Station',
    pinned: Boolean(selectedAgent.pinned),
    workspacePath: selectedAgent.id === 'devops' ? '/Workspace/travel-plans' : '/Workspace',
    temperature: 0.7,
  };
  const pinned = AGENTS.filter((agent) => agent.pinned);
  const others = AGENTS.filter((agent) => !agent.pinned);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const syncWidth = (width: number) => {
      if (width <= 0) return;
      const nextNarrow = width < 900;
      const wasNarrow = narrowRef.current;
      narrowRef.current = nextNarrow;
      setNarrow(nextNarrow);
      if (nextNarrow && wasNarrow !== true) {
        setAgentListOpen(false);
        setTopicsOpen(false);
      }
    };
    syncWidth(root.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => syncWidth(entry.contentRect.width));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={rootRef} data-testid="desktop-shell-agent-chat" style={styles.root}>
      <aside
        style={{
          ...styles.agentList,
          width: agentListOpen ? 230 : 48,
          padding: agentListOpen ? '14px 10px 58px' : '14px 0 58px',
        }}
      >
        {agentListOpen ? (
          <>
            <div style={styles.agentHeader}>
              <div style={styles.agentTitle}>My Agents</div>
              <button style={styles.iconButton} title="新建 Agent" onClick={onOpenProfile}>
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
                  onClick={() => {
                    setSelectedAgentId(agent.id);
                  }}
                />
              ))}
              <RosterGroup label="All Agents" />
              {others.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  active={agent.id === selectedAgentId}
                  onClick={() => {
                    setSelectedAgentId(agent.id);
                  }}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            <button style={styles.collapsedSearchButton} title="新建 Agent" onClick={onOpenProfile}>
              <Plus size={16} />
            </button>
            <button
              style={{ ...styles.collapsedSearchButton, margin: '0 auto 2px' }}
              title="搜索 Agent"
              onClick={() => {
                setTopicsOpen(false);
                setAgentListOpen(true);
              }}
            >
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
                  }}
                >
                  <AgentIcon agent={agent} size={30} />
                </button>
              ))}
            </div>
          </>
        )}
        <PanelToggleDock
          side="left"
          open={agentListOpen}
          title={agentListOpen ? '折叠 Agent 列表' : '展开 Agent 列表'}
          onClick={() => {
            if (!agentListOpen) setTopicsOpen(false);
            setAgentListOpen((open) => !open);
          }}
        />
      </aside>

      {!profileOpen && (!narrow || topicsOpen) && <aside style={styles.topicList}>
        {narrow && (
          <button style={styles.overlayCloseButton} title="关闭 Topics" onClick={() => setTopicsOpen(false)}>
            <X size={15} />
          </button>
        )}
        <div style={styles.agentCard}>
          <AgentIcon agent={selectedAgent} size={44} />
          <div style={{ minWidth: 0, flex: 1 }}>
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
          <button style={{ border: 0, background: 'transparent', color: T.textTertiary, cursor: 'pointer', padding: 2 }} title="会话管理">
            <Settings2 size={13} />
          </button>
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
      </aside>}

      {profileOpen ? (
        <main style={styles.profileMain}>
          <AgentProfile key={profileAgent.id} agent={profileAgent} onBack={onCloseProfile} />
        </main>
      ) : <main style={styles.chat}>
        <header style={styles.chatHeader}>
          <AgentIcon agent={selectedAgent} size={40} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={styles.chatName}>
              {selectedAgent.name}
              <span style={styles.badge}>{isTravelAssistant ? '行程规划' : 'Agent'}</span>
              <span style={styles.badge}>{isTravelAssistant ? '实时攻略' : 'Station'}</span>
            </div>
            <div style={styles.chatDesc}>{selectedAgent.desc}</div>
          </div>
          {narrow && (
            <button
              style={{
                ...styles.headerIconButton,
                background: topicsOpen ? T.primaryWash : T.fillQuaternary,
                color: topicsOpen ? T.primary : T.textSecondary,
              }}
              title={topicsOpen ? '收起会话列表' : '展开会话列表'}
              onClick={() => {
                if (!topicsOpen) setAgentListOpen(false);
                setTopicsOpen((open) => !open);
              }}
            >
              <List size={15} />
            </button>
          )}
          {!narrow && <Settings2 size={15} color={T.textTertiary} style={{ cursor: 'pointer' }} title="Agent 设置" />}
        </header>

        <section style={styles.emptyChat}>
          <div style={{ ...styles.welcomeCard, width: narrow ? 'calc(100% - 28px)' : 'min(620px, calc(100% - 36px))' }}>
            <AgentIcon agent={selectedAgent} size={48} />
            <div style={styles.welcomeTitle}>{selectedAgent.name}</div>
            <div style={styles.capabilityBar}>
              <span><CheckCircle2 size={13} /> {isTravelAssistant ? '行程规划' : 'Tools enabled'}</span>
              <span>{isTravelAssistant ? '目的地攻略' : 'Station'}</span>
              <span>{isTravelAssistant ? '偏好记忆' : 'Memory'}</span>
            </div>
            <p style={styles.welcomeText}>
              {isTravelAssistant
                ? `你好，我是${selectedAgent.name}。告诉我目的地、出行时间和同行人，我可以帮你规划路线、比较交通住宿，并整理一份随时可调整的旅行方案。`
                : `你好，我是${selectedAgent.name}。${selectedAgent.desc} 请告诉我你现在想完成什么。`}
            </p>
            <span style={styles.modelBadge}>{isTravelAssistant ? '旅行方案已就绪' : 'Agent ready'}</span>
          </div>

          <div style={{ ...styles.quickActions, width: narrow ? 'calc(100% - 28px)' : 'min(620px, calc(100% - 36px))' }}>
            {quickActions.map((action) => (
              <button key={action} style={styles.quickAction}>
                <Compass size={13} />
                {action}
              </button>
            ))}
          </div>
        </section>

        <div style={{ width: narrow ? 'calc(100% - 28px)' : 'min(620px, calc(100% - 36px))', margin: '0 auto 18px' }}>
          <PromptComposer
            density="compact"
            minHeight={96}
            maxWidth="100%"
            modelLabel="GPT-5.5"
            placeholder={isTravelAssistant
              ? '告诉我想去哪里、什么时候出发，以及你偏好的旅行节奏...'
              : '描述你希望这个 Agent 帮你完成的任务...'}
          />
        </div>
      </main>}
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

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: '100%',
    height: '100%',
    display: 'flex',
    minWidth: 0,
    position: 'relative',
    overflow: 'hidden',
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
    zIndex: 4,
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
    width: 230,
    flexShrink: 0,
    borderRight: `1px solid ${T.border}`,
    background: '#fbfbfb',
    padding: '12px 10px',
    boxSizing: 'border-box',
    overflow: 'auto',
    position: 'relative',
    zIndex: 3,
  },
  overlayCloseButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    border: 0,
    borderRadius: 8,
    background: T.fillQuaternary,
    color: T.textSecondary,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  agentCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    minHeight: 58,
    padding: '9px 10px',
    border: `1px solid ${T.border}`,
    borderRadius: 10,
    background: '#fff',
    boxShadow: 'none',
    marginBottom: 10,
  },
  cardName: {
    fontSize: 15,
    fontWeight: 750,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
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
    height: 32,
    border: 0,
    borderRadius: 7,
    background: 'transparent',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: T.text,
    padding: '0 8px',
    fontSize: 11,
    cursor: 'pointer',
    textAlign: 'left',
  },
  topicHeader: {
    marginTop: 12,
    padding: '0 8px',
    display: 'flex',
    justifyContent: 'space-between',
    color: T.textSecondary,
    fontSize: 12,
    fontWeight: 700,
  },
  groupLine: {
    marginTop: 8,
    padding: '0 6px',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    color: T.textTertiary,
    fontSize: 11,
  },
  topicItem: {
    height: 27,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 8px 0 14px',
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
  profileMain: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    position: 'relative',
    overflow: 'hidden',
    background: '#fff',
    display: 'flex',
    flexDirection: 'column',
  },
  chatHeader: {
    width: 'min(620px, calc(100% - 36px))',
    margin: '12px auto 0',
    height: 66,
    border: `1px solid ${T.border}`,
    borderRadius: 12,
    background: '#fff',
    boxShadow: '0 4px 18px rgba(15,23,42,0.04)',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '0 14px',
    boxSizing: 'border-box',
    minWidth: 0,
  },
  chatName: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
    fontWeight: 850,
    minWidth: 0,
    flexWrap: 'wrap',
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
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: '18px 0 14px',
    boxSizing: 'border-box',
    overflow: 'auto',
  },
  welcomeCard: {
    width: 620,
    minHeight: 232,
    border: `1px solid ${T.border}`,
    borderRadius: 14,
    background: '#fff',
    boxShadow: '0 8px 28px rgba(15,23,42,0.05)',
    padding: '24px 32px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    maxWidth: 'calc(100% - 36px)',
    boxSizing: 'border-box',
  },
  welcomeTitle: {
    marginTop: 10,
    fontSize: 17,
    fontWeight: 800,
  },
  capabilityBar: {
    marginTop: 10,
    minHeight: 26,
    borderRadius: 8,
    background: T.fillQuaternary,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 10px',
    color: T.textTertiary,
    fontSize: 11,
  },
  welcomeText: {
    maxWidth: 440,
    margin: '14px 0 12px',
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
    gap: '6px 16px',
    maxWidth: 620,
    padding: '0 12px',
  },
  quickAction: {
    border: 0,
    background: 'transparent',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    color: T.text,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  },
  headerIconButton: {
    width: 28,
    height: 28,
    flexShrink: 0,
    border: 0,
    borderRadius: 8,
    background: T.fillQuaternary,
    color: T.textSecondary,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
};
