import { useLayoutEffect, useRef, useState } from 'react';
import { theme } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon, SearchBar, Tag } from '@lobehub/ui';
import {
  Archive,
  Bot,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Cloud,
  Compass,
  List,
  MoreHorizontal,
  Network,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  UserRound,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react';
import { PROTOTYPE_COLORS } from './theme';
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
  { id: 'devops', name: 'Travel Assistant', icon: Compass, desc: 'Travel planning assistant that helps design itineraries, discover local experiences, and organize transport and accommodation.', pinned: true, active: true },
  { id: 'automation', name: 'AI UI Automation', icon: Sparkles, desc: 'AI UI automation agent for the workspace.' },
  { id: 'terminal', name: 'Terminal', icon: Settings2, desc: 'Terminal assistant for executing local commands.' },
  { id: 'mcp', name: 'MCP-Tester', icon: Cloud, desc: 'Test MCP Server availability.' },
  { id: 'oncall', name: 'Oncall Master', icon: Network, desc: 'Oncall knowledge management and smart assistant.' },
  { id: 'ui-test', name: 'UI test', icon: UserRound, desc: 'UI test agent for mobile and TikTok LIVE.' },
  { id: 'codex', name: 'UI test codex', icon: Bot, desc: 'TikTok LIVE mobile UI test engineer.' },
];

const TOPICS: Topic[] = [
  { id: 'tokyo-plan', title: '5-day Tokyo itinerary', group: 'Today' },
  { id: 'family-hotel', title: 'Best area for family hotels', group: 'Today' },
  { id: 'rail-pass', title: 'Need to buy JR Pass?', group: 'Today' },
  { id: 'food-map', title: 'Local food map', group: 'Today' },
  { id: 'packing-list', title: 'Pre-departure packing list', group: 'Yesterday' },
];

const QUICK_ACTIONS = ['Plan 5-day itinerary', 'Compare hotels & transport', 'Recommend local experiences', 'Pre-departure checklist'];

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
  const { token } = theme.useToken();
  const rootRef = useRef<HTMLDivElement>(null);
  const narrowRef = useRef<boolean | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState('devops');
  const [agentListOpen, setAgentListOpen] = useState(true);
  const [narrow, setNarrow] = useState(false);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [composerValue, setComposerValue] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [manageMode, setManageMode] = useState(false);
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const selectedAgent = AGENTS.find((agent) => agent.id === selectedAgentId) ?? AGENTS[0];
  const isTravelAssistant = selectedAgent.id === 'devops';
  const quickActions = isTravelAssistant
    ? QUICK_ACTIONS
    : ['Start new task', 'View available capabilities', 'Open Agent workspace', 'Check recent runs'];
  const profileAgent: ProfileAgent = {
    id: selectedAgent.id,
    name: selectedAgent.name,
    avatar: selectedAgent.id === 'devops' ? token.colorPrimary : token.colorTextSecondary,
    description: selectedAgent.desc,
    model: selectedAgent.id === 'devops' ? 'GPT-5.5' : 'Default',
    provider: selectedAgent.id === 'devops' ? 'OpenAI' : 'Station',
    pinned: Boolean(selectedAgent.pinned),
    workspacePath: selectedAgent.id === 'devops' ? '/Workspace/travel-plans' : '/Workspace',
    temperature: 0.7,
  };
  const pinned = AGENTS.filter((agent) => agent.pinned);
  const others = AGENTS.filter((agent) => !agent.pinned);

  const handleSelectAgent = (agentId: string) => {
    setSelectedAgentId(agentId);
    if (profileOpen) onCloseProfile();
    setManageMode(false);
    setSelectedTopics(new Set());
    setCollapsedGroups(new Set());
    setComposerValue('');
  };

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

  const contentWidth = narrow ? 'calc(100% - 28px)' : 'min(620px, calc(100% - 36px))';

  return (
    <div ref={rootRef} data-testid="desktop-shell-agent-chat" style={rootStyle(token)}>
      <aside
        style={{
          ...asideStyle(token),
          width: agentListOpen ? 230 : 48,
          padding: agentListOpen ? '14px 10px 58px' : '14px 0 58px',
          transition: 'width 0.18s ease, padding 0.18s ease',
        }}
      >
        {agentListOpen ? (
          <>
            <Flexbox horizontal align="center" gap={8} style={{ height: 40, marginBottom: 10 }}>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 800, color: token.colorText }}>My Agents</span>
              <ActionIcon
                icon={Plus}
                title="New Agent"
                size={{ blockSize: 34, size: 15 }}
                onClick={onOpenProfile}
                style={headerIconButtonStyle(token)}
              />
              <ActionIcon
                icon={Workflow}
                title="Open Agent Orchestration"
                size={{ blockSize: 34, size: 15 }}
                onClick={onOpenOrchestration}
                style={headerIconButtonStyle(token)}
              />
            </Flexbox>
            <div style={{ marginBottom: 8 }}>
              <SearchBar
                placeholder="Search agents..."
                value={searchValue}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchValue(e.target.value)}
                allowClear
                size="small"
                style={{ borderRadius: 7, height: 40 }}
              />
            </div>
            <Flexbox flex={1} gap={0} style={{ minHeight: 0, overflow: 'auto' }}>
              <RosterGroup label="Pinned" />
              {pinned.map((agent) => (
                <AgentRow key={agent.id} agent={agent} active={agent.id === selectedAgentId} onClick={() => handleSelectAgent(agent.id)} token={token} />
              ))}
              <RosterGroup label="All Agents" />
              {others.map((agent) => (
                <AgentRow key={agent.id} agent={agent} active={agent.id === selectedAgentId} onClick={() => handleSelectAgent(agent.id)} token={token} />
              ))}
            </Flexbox>
          </>
        ) : (
          <>
            <ActionIcon
              icon={Plus}
              title="New Agent"
              size={{ blockSize: 40, size: 16 }}
              onClick={onOpenProfile}
              style={collapsedTopButtonStyle(token)}
            />
            <ActionIcon
              icon={Search}
              title="Search Agents"
              size={{ blockSize: 40, size: 16 }}
              onClick={() => { setTopicsOpen(false); setAgentListOpen(true); }}
              style={{ ...collapsedTopButtonStyle(token), margin: '0 auto 2px' }}
            />
            <div style={collapsedRailStyle()}>
              <CollapsedRosterDivider token={token} />
              {pinned.map((agent) => (
                <CollapsedAgentButton key={agent.id} agent={agent} active={agent.id === selectedAgentId} onClick={() => handleSelectAgent(agent.id)} />
              ))}
              <CollapsedRosterDivider token={token} />
              {others.map((agent) => (
                <CollapsedAgentButton key={agent.id} agent={agent} active={agent.id === selectedAgentId} onClick={() => handleSelectAgent(agent.id)} />
              ))}
            </div>
          </>
        )}
        <PanelToggleDock
          side="left"
          open={agentListOpen}
          title={agentListOpen ? 'Collapse agent list' : 'Expand agent list'}
          onClick={() => { if (!agentListOpen) setTopicsOpen(false); setAgentListOpen((open) => !open); }}
        />
      </aside>

      {!profileOpen && (!narrow || topicsOpen) && (
        <aside style={topicListStyle(token)}>
          {narrow && (
            <button type="button" title="Close Topics" onClick={() => setTopicsOpen(false)} style={overlayCloseStyle(token)}>
              <X size={15} />
            </button>
          )}
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <Flexbox horizontal align="center" gap={9} style={agentCardStyle(token)}>
              <AgentIcon agent={selectedAgent} size={44} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={cardNameStyle(token)}>{selectedAgent.name}</div>
                <div style={cardDescStyle(token)}>{selectedAgent.desc}</div>
              </div>
              <Sparkles size={14} color="#faad14" />
            </Flexbox>

            {!manageMode && (
              <>
                <button type="button" style={topicActionStyle(token)}>
                  <Plus size={15} />
                  Start New Topic
                </button>
                <button type="button" style={topicActionStyle(token)} onClick={onOpenProfile}>
                  <UserRound size={15} />
                  Agent Profile
                </button>
                <button type="button" style={topicActionStyle(token)}>
                  <Search size={15} />
                  Search
                </button>
              </>
            )}

            <Flexbox horizontal justify="space-between" align="center" style={topicHeaderStyle(token)}>
              <span>{manageMode ? `Manage Sessions (${selectedTopics.size})` : 'Topic 5'}</span>
              {manageMode ? (
                <button
                  type="button"
                  title="Done"
                  onClick={() => { setManageMode(false); setSelectedTopics(new Set()); }}
                  style={{ border: 0, background: 'transparent', color: token.colorPrimary, cursor: 'pointer', padding: 2, display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 600 }}
                >
                  Done
                </button>
              ) : (
                <button
                  type="button"
                  title="Session management"
                  onClick={() => setManageMode(true)}
                  style={{ border: 0, background: 'transparent', color: token.colorTextTertiary, cursor: 'pointer', padding: 2, display: 'inline-flex', alignItems: 'center' }}
                >
                  <Settings2 size={13} />
                </button>
              )}
            </Flexbox>
            {['Today', 'Yesterday'].map((group) => {
              const collapsed = collapsedGroups.has(group);
              return (
                <div key={group}>
                  <button
                    type="button"
                    onClick={() => {
                      setCollapsedGroups((prev) => {
                        const next = new Set(prev);
                        if (next.has(group)) next.delete(group);
                        else next.add(group);
                        return next;
                      });
                    }}
                    style={{
                      width: '100%',
                      border: 0,
                      background: 'transparent',
                      cursor: 'pointer',
                      padding: 0,
                      marginTop: 8,
                      paddingInline: 6,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      color: token.colorTextTertiary,
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    {group}
                  </button>
                  {!collapsed && TOPICS.filter((topic) => topic.group === group).map((topic) => {
                    const isSelected = selectedTopics.has(topic.id);
                    return (
                      <button
                        key={topic.id}
                        type="button"
                        onClick={() => {
                          if (manageMode) {
                            setSelectedTopics((prev) => {
                              const next = new Set(prev);
                              if (next.has(topic.id)) next.delete(topic.id);
                              else next.add(topic.id);
                              return next;
                            });
                          }
                        }}
                        style={{
                          width: '100%',
                          border: 0,
                          background: isSelected ? `${token.colorPrimary}14` : 'transparent',
                          height: 27,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '0 8px 0 14px',
                          color: isSelected ? token.colorPrimary : token.colorTextSecondary,
                          fontSize: 12,
                          cursor: manageMode ? 'pointer' : 'default',
                          textAlign: 'left',
                          borderRadius: 6,
                        }}
                      >
                        {manageMode ? (
                          isSelected ? <CheckSquare size={13} color={token.colorPrimary} /> : <Square size={13} color={token.colorTextTertiary} />
                        ) : (
                          <span>#</span>
                        )}
                        <span>{topic.title}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {manageMode && (
            <div style={{ paddingTop: 10, borderTop: `1px solid ${token.colorBorderSecondary}`, marginTop: 8, display: 'flex', gap: 8 }}>
              <button
                type="button"
                disabled={selectedTopics.size === 0}
                style={{
                  flex: 1,
                  height: 30,
                  border: 0,
                  borderRadius: 8,
                  background: selectedTopics.size === 0 ? token.colorFillQuaternary : token.colorError,
                  color: selectedTopics.size === 0 ? token.colorTextDisabled : '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: selectedTopics.size === 0 ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                }}
              >
                <Trash2 size={13} />
                Delete
              </button>
              <button
                type="button"
                disabled={selectedTopics.size === 0}
                style={{
                  flex: 1,
                  height: 30,
                  border: `1px solid ${selectedTopics.size === 0 ? token.colorBorderSecondary : token.colorBorder}`,
                  borderRadius: 8,
                  background: '#fff',
                  color: selectedTopics.size === 0 ? token.colorTextDisabled : token.colorTextSecondary,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: selectedTopics.size === 0 ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                }}
              >
                <Archive size={13} />
                Archive
              </button>
            </div>
          )}
        </aside>
      )}

      {profileOpen ? (
        <main style={profileMainStyle(token)}>
          <AgentProfile key={profileAgent.id} agent={profileAgent} onBack={onCloseProfile} />
        </main>
      ) : (
        <main style={chatMainStyle(token)}>
          <Flexbox
            horizontal
            align="center"
            gap={12}
            style={{
              width: contentWidth,
              margin: '12px auto 0',
              height: 66,
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 12,
              background: '#fff',
              boxShadow: '0 4px 18px rgba(15,23,42,0.04)',
              padding: '0 14px',
              boxSizing: 'border-box',
              minWidth: 0,
            }}
          >
            <AgentIcon agent={selectedAgent} size={40} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 14, fontWeight: 850, color: token.colorText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedAgent.name}
                </strong>
                <Tag style={{ margin: 0, borderRadius: 999, fontSize: 11, padding: '2px 7px', fontWeight: 650 }}>
                  {isTravelAssistant ? 'Itinerary' : 'Agent'}
                </Tag>
                <Tag style={{ margin: 0, borderRadius: 999, fontSize: 11, padding: '2px 7px', fontWeight: 650 }}>
                  {isTravelAssistant ? 'Real-time guide' : 'Station'}
                </Tag>
              </Flexbox>
              <div style={{ marginTop: 4, color: token.colorTextSecondary, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {selectedAgent.desc}
              </div>
            </div>
            {narrow ? (
              <ActionIcon
                icon={List}
                title={topicsOpen ? 'Collapse topic list' : 'Expand topic list'}
                size={{ blockSize: 28, size: 15 }}
                onClick={() => { if (!topicsOpen) setAgentListOpen(false); setTopicsOpen((open) => !open); }}
                style={{
                  flexShrink: 0,
                  borderRadius: 8,
                  background: topicsOpen ? '#eceaf6' : token.colorFillQuaternary,
                  color: topicsOpen ? token.colorPrimary : token.colorTextSecondary,
                  border: 0,
                }}
              />
            ) : (
              <button
                type="button"
                title="Agent settings"
                onClick={onOpenProfile}
                style={{ border: 0, background: 'transparent', color: token.colorTextTertiary, cursor: 'pointer', padding: 2, display: 'inline-flex', alignItems: 'center', borderRadius: 6 }}
              >
                <Settings2 size={15} />
              </button>
            )}
          </Flexbox>

          <Flexbox
            flex={1}
            align="center"
            justify="center"
            gap={14}
            style={{ minHeight: 0, overflow: 'auto', padding: '20px 0 20px', boxSizing: 'border-box' }}
          >
            <div
              style={{
                width: contentWidth,
                minHeight: 232,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 14,
                background: '#fff',
                boxShadow: '0 8px 28px rgba(15,23,42,0.05)',
                padding: '24px 32px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                boxSizing: 'border-box',
              }}
            >
              <AgentIcon agent={selectedAgent} size={48} />
              <div style={{ marginTop: 10, fontSize: 17, fontWeight: 800, color: token.colorText }}>{selectedAgent.name}</div>
              <Flexbox horizontal align="center" gap={10} style={{ marginTop: 10, minHeight: 26, borderRadius: 8, background: token.colorFillQuaternary, padding: '0 10px', color: token.colorTextTertiary, fontSize: 11 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: token.colorSuccess }}>
                  <CheckCircle2 size={13} /> {isTravelAssistant ? 'Itinerary planning' : 'Tools enabled'}
                </span>
                <span>{isTravelAssistant ? 'Destination guide' : 'Station'}</span>
                <span>{isTravelAssistant ? 'Preference memory' : 'Memory'}</span>
              </Flexbox>
              <p style={{ maxWidth: 440, margin: '14px 0 12px', color: token.colorTextSecondary, fontSize: 13, lineHeight: 1.6 }}>
                {isTravelAssistant
                  ? `Hello, I'm ${selectedAgent.name}. Tell me your destination, travel dates, and companions, and I'll help plan routes, compare transport and accommodation, and organize an adjustable travel plan.`
                  : `Hello, I'm ${selectedAgent.name}. ${selectedAgent.desc} Tell me what you'd like to accomplish.`}
              </p>
              <Tag style={{ margin: 0, borderRadius: 6, fontSize: 11, padding: '4px 10px', background: token.colorFillQuaternary, color: token.colorTextTertiary, border: 0 }}>
                {isTravelAssistant ? 'Travel plan ready' : 'Agent ready'}
              </Tag>
            </div>

            <Flexbox horizontal gap="6px 16px" wrap="wrap" justify="center" style={{ width: contentWidth, padding: '0 12px' }}>
              {quickActions.map((action) => (
                <button
                  key={action}
                  type="button"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    border: 0,
                    background: 'transparent',
                    color: token.colorText,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  <Compass size={13} />
                  {action}
                </button>
              ))}
            </Flexbox>
          </Flexbox>

          <div style={{ width: contentWidth, margin: '0 auto 18px' }}>
            <PromptComposer
              density="compact"
              minHeight={96}
              maxWidth="100%"
              modelLabel={`${profileAgent.provider} · ${profileAgent.model}`}
              value={composerValue}
              onChange={setComposerValue}
              placeholder={isTravelAssistant
                ? 'Tell me where you want to go, when, and your preferred travel pace...'
                : 'Describe what you want this Agent to help you with...'}
              sendDisabled={!composerValue.trim()}
              onSend={() => { setComposerValue(''); }}
            />
          </div>
        </main>
      )}
    </div>
  );
}

function RosterGroup({ label }: { label: string }) {
  const { token } = theme.useToken();
  return (
    <div style={{ margin: '12px 0 6px', color: token.colorTextTertiary, fontSize: 12, fontWeight: 650, height: 18, lineHeight: '18px' }}>
      {label}
    </div>
  );
}

function CollapsedRosterDivider({ token }: { token: any }) {
  return (
    <div style={{ width: 40, height: 18, margin: '12px auto 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ width: 18, height: 1, background: token.colorBorderSecondary }} />
    </div>
  );
}

function AgentRow({ agent, active, onClick, token }: { agent: AgentSummary; active: boolean; onClick: () => void; token: any }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
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
        background: active ? PROTOTYPE_COLORS.activeRosterBg : 'transparent',
        color: token.colorText,
      }}
    >
      <AgentIcon agent={agent} size={30} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 750, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {agent.name}{agent.pinned ? ' ★' : ''}
        </span>
        <span style={{ display: 'block', color: token.colorTextTertiary, fontSize: 11, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {agent.desc}
        </span>
      </span>
      <MoreHorizontal size={14} color={token.colorTextTertiary} />
    </button>
  );
}

function CollapsedAgentButton({ agent, active, onClick }: { agent: AgentSummary; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={agent.name}
      onClick={onClick}
      style={{
        width: 40,
        height: 48,
        border: 0,
        borderRadius: 12,
        background: active ? PROTOTYPE_COLORS.activeRosterBg : 'transparent',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
      }}
    >
      <AgentIcon agent={agent} size={30} />
    </button>
  );
}

function AgentIcon({ agent, size }: { agent: AgentSummary; size: number }) {
  const { token } = theme.useToken();
  const Icon = agent.icon;
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(8, size / 4),
        background: agent.active ? token.colorPrimaryBg : token.colorFillQuaternary,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: size > 36 ? 20 : 13,
        color: agent.active ? token.colorPrimary : token.colorTextSecondary,
        overflow: 'hidden',
      }}
    >
      <Icon size={Math.max(14, Math.round(size * 0.48))} />
    </span>
  );
}

function rootStyle(token: any): React.CSSProperties {
  return {
    width: '100%',
    height: '100%',
    display: 'flex',
    minWidth: 0,
    position: 'relative',
    overflow: 'hidden',
    background: '#fff',
    color: token.colorText,
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  };
}

function asideStyle(token: any): React.CSSProperties {
  return {
    flexShrink: 0,
    height: '100%',
    borderRight: `1px solid ${token.colorBorderSecondary}`,
    background: PROTOTYPE_COLORS.asideBg,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    position: 'relative',
    boxSizing: 'border-box',
    zIndex: 4,
  };
}

function headerIconButtonStyle(token: any): React.CSSProperties {
  return {
    borderRadius: 10,
    border: `1px solid ${token.colorBorderSecondary}`,
    background: '#fff',
    color: token.colorTextSecondary,
  };
}

function collapsedTopButtonStyle(token: any): React.CSSProperties {
  return {
    borderRadius: 12,
    background: 'transparent',
    margin: '0 auto 10px',
    border: 0,
    color: token.colorTextSecondary,
  };
}

function collapsedRailStyle(): React.CSSProperties {
  return {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 0,
    width: '100%',
  };
}

function topicListStyle(token: any): React.CSSProperties {
  return {
    width: 230,
    flexShrink: 0,
    height: '100%',
    borderRight: `1px solid ${token.colorBorderSecondary}`,
    background: PROTOTYPE_COLORS.asideBg,
    padding: '12px 10px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    zIndex: 3,
    minHeight: 0,
  };
}

function overlayCloseStyle(token: any): React.CSSProperties {
  return {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    border: 0,
    borderRadius: 8,
    background: token.colorFillQuaternary,
    color: token.colorTextSecondary,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  };
}

function agentCardStyle(token: any): React.CSSProperties {
  return {
    minHeight: 58,
    padding: '9px 10px',
    border: `1px solid ${token.colorBorderSecondary}`,
    borderRadius: 10,
    background: '#fff',
    marginBottom: 10,
  };
}

function cardNameStyle(token: any): React.CSSProperties {
  return { fontSize: 15, fontWeight: 750, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: token.colorText };
}

function cardDescStyle(token: any): React.CSSProperties {
  return { marginTop: 3, color: token.colorTextTertiary, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
}

function topicActionStyle(token: any): React.CSSProperties {
  return {
    width: '100%',
    height: 32,
    border: 0,
    borderRadius: 7,
    background: 'transparent',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: token.colorText,
    padding: '0 8px',
    fontSize: 11,
    cursor: 'pointer',
    textAlign: 'left',
  };
}

function topicHeaderStyle(token: any): React.CSSProperties {
  return {
    marginTop: 12,
    padding: '0 8px',
    color: token.colorTextSecondary,
    fontSize: 12,
    fontWeight: 700,
  };
}

function groupLineStyle(token: any): React.CSSProperties {
  return {
    marginTop: 8,
    padding: '0 6px',
    color: token.colorTextTertiary,
    fontSize: 11,
  };
}

function topicItemStyle(token: any): React.CSSProperties {
  return {
    height: 27,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 8px 0 14px',
    color: token.colorTextSecondary,
    fontSize: 12,
  };
}

function chatMainStyle(_token: any): React.CSSProperties {
  return {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    position: 'relative',
    background: '#fff',
    display: 'flex',
    flexDirection: 'column',
  };
}

function profileMainStyle(_token: any): React.CSSProperties {
  return {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    position: 'relative',
    overflow: 'hidden',
    background: '#fff',
    display: 'flex',
    flexDirection: 'column',
  };
}
