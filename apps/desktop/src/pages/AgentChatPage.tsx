import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon, SearchBar } from '@lobehub/ui';
import { theme } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Workflow,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  Trash2,
  Archive,
  CheckSquare,
  Copy,
  Pencil,
  Sparkles,
  Square,
  UserRound,
  Settings2,
} from 'lucide-react';
import { useChatStore, type Session } from '../store/chat';
import { useAgentStore } from '../store/agent';
import { ChatPage } from './ChatPage';
import { AgentProfilePage } from './AgentProfilePage';

const SIDEBAR_COLORS = {
  asideBg: '#fbfbfb',
  activeItem: '#eef4ff',
  toggleHoverBg: '#f3f1fb',
} as const;

const TOGGLE_COLOR = '#595959';

function isSameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

function isYesterday(ts: number): boolean {
  const now = new Date();
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  return isSameDay(ts, yest.getTime());
}

function isToday(ts: number): boolean {
  return isSameDay(ts, Date.now());
}

const AGENT_SEARCH_INPUT_ID = 'agent-chat-agent-search-input';

export function AgentChatPage({ onNavigateAgentCanvas }: { onNavigateAgentProfile?: (agentName: string) => void; onNavigateAgentCanvas?: () => void }) {
  const { t } = useTranslation(['agent', 'common']);
  const { token } = theme.useToken();
  const [leftOpen, setLeftOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [manageMode, setManageMode] = useState(false);
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [narrow, setNarrow] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const narrowRef = useRef<boolean | null>(null);

  const agents = useAgentStore((s) => s.agents);
  const selectedAgent = useAgentStore((s) => s.selectedAgent);
  const setSelectedAgent = useAgentStore((s) => s.setSelectedAgent);
  const loadAgents = useAgentStore((s) => s.loadAgents);
  const agentSurfaces = useAgentStore((s) => s.agentSurfaces);
  const setAgentSurface = useAgentStore((s) => s.setAgentSurface);
  const currentSurface = agentSurfaces[selectedAgent] || 'chat';

  const sessions = useChatStore((s) => s.sessions);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const selectSession = useChatStore((s) => s.selectSession);
  const bootstrapSession = useChatStore((s) => s.bootstrapSession);
  const newSession = useChatStore((s) => s.newSession);
  const deleteSession = useChatStore((s) => s.deleteSession);

  useEffect(() => {
    if (agents.length > 0) {
      const found = agents.find((a) => a.name === selectedAgent);
      if (!found) {
        setSelectedAgent(agents[0].name);
      }
    }
  }, [agents, selectedAgent, setSelectedAgent]);

  useEffect(() => {
    if (agents.length === 0) return;
    if (currentSurface !== 'chat') return;
    void bootstrapSession();
  }, [agents.length, currentSurface, bootstrapSession]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const syncWidth = (width: number) => {
      if (width <= 0) return;
      const nextNarrow = width < 900;
      const wasNarrow = narrowRef.current;
      narrowRef.current = nextNarrow;
      setNarrow(nextNarrow);
      if (nextNarrow && wasNarrow !== true) {
        setLeftOpen(false);
      }
    };
    syncWidth(root.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => syncWidth(entry.contentRect.width));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const toggleGroup = useCallback((label: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  }, []);

  const handleSelectAgent = useCallback((name: string) => {
    setSelectedAgent(name);
    setManageMode(false);
    setSelectedSessions(new Set());
    setSearch('');
    setCollapsedGroups(new Set());
  }, [setSelectedAgent]);

  const currentAgent = useMemo(() => agents.find((a) => a.name === selectedAgent), [agents, selectedAgent]);

  const agentSessions = useMemo(() => {
    let list = sessions.filter((s) => s.agent_name === selectedAgent);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((s) => (s.title || '').toLowerCase().includes(q));
    }
    return list.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [sessions, selectedAgent, search]);

  const groupedTopics = useMemo(() => {
    const today: Session[] = [];
    const yesterday: Session[] = [];
    const older: Session[] = [];
    for (const s of agentSessions) {
      const ts = new Date(s.updated_at).getTime();
      if (isToday(ts)) today.push(s);
      else if (isYesterday(ts)) yesterday.push(s);
      else older.push(s);
    }
    const groups: { label: string; items: Session[] }[] = [];
    if (today.length > 0) groups.push({ label: t('agent.sidebar.dateGroup.today'), items: today });
    if (yesterday.length > 0) groups.push({ label: t('agent.sidebar.dateGroup.yesterday'), items: yesterday });
    if (older.length > 0) groups.push({ label: t('agent.chat.dateGroup.earlier'), items: older });
    return groups;
  }, [agentSessions]);

  const pinnedAgents = agents.filter((a) => a.pinned);
  const otherAgents = agents.filter((a) => !a.pinned);

  const filteredPinned = search.trim()
    ? pinnedAgents.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()))
    : pinnedAgents;
  const filteredOthers = search.trim()
    ? otherAgents.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()))
    : otherAgents;

  const returnToChat = useCallback(() => {
    if (selectedAgent) {
      setAgentSurface(selectedAgent, 'chat');
    }
  }, [selectedAgent, setAgentSurface]);

  const handleSelectSession = useCallback((key: string) => {
    if (manageMode) {
      setSelectedSessions((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
      });
      return;
    }
    selectSession(key);
    setSearch('');
    returnToChat();
  }, [manageMode, selectSession, returnToChat]);

  const toggleManageMode = useCallback(() => {
    setManageMode((p) => !p);
    setSelectedSessions(new Set());
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    for (const key of selectedSessions) {
      await deleteSession(key);
    }
    setSelectedSessions(new Set());
    setManageMode(false);
  }, [selectedSessions, deleteSession]);

  const handleNewSession = useCallback(() => {
    newSession();
    returnToChat();
  }, [newSession, returnToChat]);

  const handleFocusSearch = useCallback(() => {
    setLeftOpen(true);
    requestAnimationFrame(() => {
      const input = document.getElementById(AGENT_SEARCH_INPUT_ID) as HTMLInputElement | null;
      input?.focus();
    });
  }, []);

  const handleOpenProfile = useCallback(() => {
    if (selectedAgent) {
      setAgentSurface(selectedAgent, 'profile');
    }
  }, [selectedAgent, setAgentSurface]);

  return (
    <div ref={rootRef} style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      minWidth: 0,
      position: 'relative',
      overflow: 'hidden',
      background: '#fff',
      color: token.colorText,
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      {leftOpen ? (
        <aside
          style={{
            width: 230,
            background: SIDEBAR_COLORS.asideBg,
            borderRight: `1px solid ${token.colorBorderSecondary}`,
            display: 'flex',
            flexDirection: 'column',
            padding: '14px 10px 58px',
            flexShrink: 0,
            position: 'relative',
            overflow: 'hidden',
            boxSizing: 'border-box',
            zIndex: 4,
          }}
        >
          <Flexbox horizontal align="center" gap={8} style={{ height: 40, marginBottom: 10 }}>
            <span style={{ flex: 1, fontSize: 14, fontWeight: 800, color: token.colorText }}>{t('agent.chat.myAgents')}</span>
            <ActionIcon
              icon={Plus}
              size={{ blockSize: 34, size: 15 }}
              style={{ borderRadius: 10, border: `1px solid ${token.colorBorderSecondary}`, background: '#fff', color: token.colorTextSecondary }}
              title={t('agent.chat.newAgent')}
              onClick={handleOpenProfile}
            />
            <ActionIcon
              icon={Workflow}
              size={{ blockSize: 34, size: 15 }}
              style={{ borderRadius: 10, border: `1px solid ${token.colorBorderSecondary}`, background: '#fff', color: token.colorTextSecondary }}
              title={t('agent.chat.workflow')}
            />
          </Flexbox>
          <div style={{ marginBottom: 8 }}>
            <SearchBar
              id={AGENT_SEARCH_INPUT_ID}
              placeholder={t('agent.sidebar.searchAgents')}
              value={search}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
              allowClear
              size="small"
              style={{ borderRadius: 7, height: 40 }}
            />
          </div>
          <Flexbox flex={1} gap={0} style={{ minHeight: 0, overflow: 'auto' }}>
            {filteredPinned.length > 0 && (
              <>
                <div style={{ margin: '12px 0 6px', color: token.colorTextTertiary, fontSize: 12, fontWeight: 650, height: 18, lineHeight: '18px' }}>{t('agent.chat.pinned')}</div>
                {filteredPinned.map((agent) => (
                  <AgentRow
                    key={agent.name}
                    name={agent.name}
                    title={agent.title}
                    avatar={agent.avatar}
                    desc={agent.description}
                    active={selectedAgent === agent.name}
                    pinned
                    onClick={() => handleSelectAgent(agent.name)}
                    token={token}
                  />
                ))}
              </>
            )}
            {filteredOthers.length > 0 && (
              <>
                <div style={{ margin: '12px 0 6px', color: token.colorTextTertiary, fontSize: 12, fontWeight: 650, height: 18, lineHeight: '18px' }}>{t('agent.chat.allAgents')}</div>
                {filteredOthers.map((agent) => (
                  <AgentRow
                    key={agent.name}
                    name={agent.name}
                    title={agent.title}
                    avatar={agent.avatar}
                    desc={agent.description}
                    active={selectedAgent === agent.name}
                    onClick={() => handleSelectAgent(agent.name)}
                    token={token}
                  />
                ))}
              </>
            )}
          </Flexbox>

          <PanelToggleDock
            open
            title={t('agent.chat.collapsePanel')}
            onClick={() => setLeftOpen(false)}
            token={token}
          />
        </aside>
      ) : (
        <aside
          style={{
            width: 48,
            minWidth: 48,
            background: SIDEBAR_COLORS.asideBg,
            borderRight: `1px solid ${token.colorBorderSecondary}`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '14px 0 58px',
            flexShrink: 0,
            position: 'relative',
            overflow: 'hidden',
            boxSizing: 'border-box',
            zIndex: 4,
          }}
        >
          <ActionIcon
            icon={Plus}
            size={{ blockSize: 40, size: 16 }}
            style={{ borderRadius: 12, border: 0, background: 'transparent', color: token.colorTextSecondary, marginBottom: 10 }}
            title={t('agent.chat.newAgent')}
            onClick={handleOpenProfile}
          />
          <ActionIcon
            icon={Search}
            size={{ blockSize: 40, size: 16 }}
            style={{ borderRadius: 12, border: 0, background: 'transparent', color: token.colorTextSecondary, marginBottom: 2 }}
            title={t('common.action.search', { ns: 'common' })}
            onClick={handleFocusSearch}
          />
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
            {pinnedAgents.length > 0 && (
              <div style={{ width: 40, height: 18, margin: '12px auto 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ width: 18, height: 1, background: token.colorBorderSecondary }} />
              </div>
            )}
            {pinnedAgents.map((agent) => (
              <CollapsedAgentButton
                key={agent.name}
                name={agent.name}
                title={agent.title}
                avatar={agent.avatar}
                active={selectedAgent === agent.name}
                onClick={() => handleSelectAgent(agent.name)}
              />
            ))}
            {otherAgents.length > 0 && (
              <div style={{ width: 40, height: 18, margin: '12px auto 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ width: 18, height: 1, background: token.colorBorderSecondary }} />
              </div>
            )}
            {otherAgents.map((agent) => (
              <CollapsedAgentButton
                key={agent.name}
                name={agent.name}
                title={agent.title}
                avatar={agent.avatar}
                active={selectedAgent === agent.name}
                onClick={() => handleSelectAgent(agent.name)}
              />
            ))}
          </div>

          <PanelToggleDock
            open={false}
            title={t('agent.chat.expandPanel')}
            onClick={() => setLeftOpen(true)}
            token={token}
          />
        </aside>
      )}

      {!narrow && (
      <aside
        style={{
          width: 230,
          flexShrink: 0,
          height: '100%',
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          background: SIDEBAR_COLORS.asideBg,
          padding: '12px 10px',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          zIndex: 3,
          minHeight: 0,
        }}
      >
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <Flexbox horizontal align="center" gap={9} style={{
              minHeight: 58,
              padding: '9px 10px',
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 10,
              background: '#fff',
              marginBottom: 10,
            }}>
              <AgentIcon label={currentAgent?.title || currentAgent?.name} name={currentAgent?.name || 'A'} avatar={currentAgent?.avatar} size={44} active token={token} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 750, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: token.colorText }}>{currentAgent?.title || currentAgent?.name || t('agent.default.title')}</div>
                <div style={{ marginTop: 3, color: token.colorTextTertiary, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentAgent?.description || ''}</div>
              </div>
              <Sparkles size={14} color="#faad14" />
            </Flexbox>

            {!manageMode && (
              <>
                <button type="button" style={topicActionStyle(token)} onClick={handleNewSession}>
                  <Plus size={15} />
                  {t('agent.sidebar.startNewTopic')}
                </button>
                <button type="button" style={topicActionStyle(token)} onClick={handleOpenProfile}>
                  <UserRound size={15} />
                  {t('agent.sidebar.agentProfile')}
                </button>
                <button type="button" style={topicActionStyle(token)} onClick={handleFocusSearch}>
                  <Search size={15} />
                  {t('common.action.search', { ns: 'common' })}
                </button>
              </>
            )}

            <Flexbox horizontal justify="space-between" align="center" style={{ marginTop: 12, padding: '0 8px', color: token.colorTextSecondary, fontSize: 12, fontWeight: 700 }}>
              <span>{manageMode ? t('agent.chat.manageSessionsCount', { count: selectedSessions.size }) : t('agent.chat.topicsCount', { count: agentSessions.length })}</span>
              {manageMode ? (
                <button
                  type="button"
                  onClick={toggleManageMode}
                  style={{ border: 0, background: 'transparent', color: token.colorPrimary, cursor: 'pointer', padding: 2, display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 600 }}
                >
                  {t('common.action.done', { ns: 'common' })}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={toggleManageMode}
                  style={{ border: 0, background: 'transparent', color: token.colorTextTertiary, cursor: 'pointer', padding: 2, display: 'inline-flex', alignItems: 'center' }}
                >
                  <Settings2 size={13} />
                </button>
              )}
            </Flexbox>

            {groupedTopics.map((group) => {
              const collapsed = collapsedGroups.has(group.label);
              return (
                <div key={group.label}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.label)}
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
                    {group.label}
                  </button>
                  {!collapsed && group.items.map((session) => {
                    const isSelected = currentSessionKey === session.key;
                    const isChecked = selectedSessions.has(session.key);
                    return (
                      <button
                        key={session.key}
                        type="button"
                        onClick={() => handleSelectSession(session.key)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({ x: e.clientX, y: e.clientY, id: session.key });
                        }}
                        style={{
                          width: '100%',
                          border: 0,
                          background: (isSelected || isChecked) ? `${token.colorPrimary}14` : 'transparent',
                          height: 27,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '0 8px 0 14px',
                          color: (isSelected || isChecked) ? token.colorPrimary : token.colorTextSecondary,
                          fontSize: 12,
                          cursor: 'pointer',
                          textAlign: 'left',
                          borderRadius: 6,
                        }}
                      >
                        {manageMode ? (
                          isChecked ? <CheckSquare size={13} color={token.colorPrimary} /> : <Square size={13} color={token.colorTextTertiary} />
                        ) : (
                          <span>#</span>
                        )}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.title || t('chat.conversation.new')}</span>
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
                disabled={selectedSessions.size === 0}
                onClick={handleDeleteSelected}
                style={{
                  flex: 1,
                  height: 30,
                  border: 0,
                  borderRadius: 8,
                  background: selectedSessions.size === 0 ? token.colorFillQuaternary : token.colorError,
                  color: selectedSessions.size === 0 ? token.colorTextDisabled : '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: selectedSessions.size === 0 ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                }}
              >
                <Trash2 size={13} />
                {t('common.action.delete', { ns: 'common' })}
              </button>
              <button
                type="button"
                disabled={selectedSessions.size === 0}
                onClick={handleDeleteSelected}
                style={{
                  flex: 1,
                  height: 30,
                  border: `1px solid ${selectedSessions.size === 0 ? token.colorBorderSecondary : token.colorBorder}`,
                  borderRadius: 8,
                  background: '#fff',
                  color: selectedSessions.size === 0 ? token.colorTextDisabled : token.colorTextSecondary,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: selectedSessions.size === 0 ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                }}
              >
                <Archive size={13} />
                {t('agent.chat.archive')}
              </button>
            </div>
        )}
      </aside>
      )}

      <main style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', background: '#fff', display: 'flex', flexDirection: 'column' }}>
        {currentSurface === 'profile' ? (
          <AgentProfilePage
            agentName={selectedAgent}
            onBack={() => setAgentSurface(selectedAgent, 'chat')}
            onOpenOrchestration={onNavigateAgentCanvas}
            embedded
          />
        ) : (
          <ChatPage onOpenProfile={handleOpenProfile} narrow={narrow} />
        )}
      </main>

      {contextMenu && (
        <div
          style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 1000,
            background: '#fff', border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.1)', padding: '4px 0', minWidth: 140,
          }}
        >
          {[
            { icon: Pencil, label: t('agent.sidebar.menu.rename') },
            { icon: Sparkles, label: t('agent.sidebar.menu.smartRename') },
            { icon: Copy, label: t('common.action.copy', { ns: 'common' }) },
            { divider: true },
            { icon: Trash2, label: t('common.action.delete', { ns: 'common' }), danger: true },
          ].map((item, i) => {
            if ('divider' in item) {
              return <div key={i} style={{ height: 1, background: token.colorBorderSecondary, margin: '4px 0' }} />;
            }
            const IconComp = item.icon;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setContextMenu(null)}
                style={{
                  width: '100%', padding: '7px 12px', border: 0, background: 'transparent', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
                  color: item.danger ? token.colorError : token.colorText, textAlign: 'left',
                }}
              >
                <IconComp size={15} /> {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AgentRow({ name, title, avatar, desc, active, pinned, onClick, token }: {
  name: string; title?: string; avatar?: string; desc?: string; active: boolean; pinned?: boolean; onClick: () => void; token: any;
}) {
  const displayName = title || name;
  return (
    <button
      type="button"
      onClick={onClick}
      title={displayName}
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
        background: active ? SIDEBAR_COLORS.activeItem : 'transparent',
        color: token.colorText,
      }}
    >
      <AgentIcon label={displayName} name={name} avatar={avatar} size={30} active={active} token={token} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 750, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {displayName}{pinned ? ' ★' : ''}
        </span>
        <span style={{ display: 'block', color: token.colorTextTertiary, fontSize: 11, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {desc || ''}
        </span>
      </span>
      <MoreHorizontal size={14} color={token.colorTextTertiary} />
    </button>
  );
}

function CollapsedAgentButton({ name, title, avatar, active, onClick }: { name: string; title?: string; avatar?: string; active: boolean; onClick: () => void }) {
  const { token } = theme.useToken();
  const displayName = title || name;
  return (
    <button
      type="button"
      title={displayName}
      onClick={onClick}
      style={{
        width: 40,
        height: 48,
        border: 0,
        borderRadius: 12,
        background: active ? SIDEBAR_COLORS.activeItem : 'transparent',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
      }}
    >
      <AgentIcon label={displayName} name={name} avatar={avatar} size={30} active={active} token={token} />
    </button>
  );
}

function PanelToggleDock({ open, title, onClick, token }: { open: boolean; title: string; onClick: () => void; token: any }) {
  return (
    <div style={{ position: 'absolute', left: open ? 19 : 10, bottom: 14, width: 28, height: 28, zIndex: 2, display: 'flex', justifyContent: 'center' }} data-panel-toggle-dock="left">
      <button
        type="button"
        title={title}
        onClick={onClick}
        style={{
          width: 28, height: 28, border: 0, borderRadius: 7, background: 'transparent',
          color: TOGGLE_COLOR, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', flexShrink: 0, padding: 0,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = SIDEBAR_COLORS.toggleHoverBg;
          e.currentTarget.style.color = token.colorPrimary;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = TOGGLE_COLOR;
        }}
      >
        {open ? <PanelLeftClose size={15} strokeWidth={1.85} /> : <PanelLeftOpen size={15} strokeWidth={1.85} />}
      </button>
    </div>
  );
}

function AgentIcon({ name, label, avatar, size, active, token }: { name: string; label?: string; avatar?: string; size: number; active?: boolean; token: any }) {
  const iconSize = Math.max(14, Math.round(size * 0.48));
  const borderRadius = Math.max(8, size / 4);
  const initial = (label || name).charAt(0).toUpperCase();
  const isUrl = avatar && /^(https?:|\/|asset|file:)/.test(avatar);
  const isEmoji = avatar && !isUrl && avatar.length <= 4;
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius,
        background: active ? token.colorPrimaryBg : token.colorFillQuaternary,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: size > 36 ? 20 : 13,
        color: active ? token.colorPrimary : token.colorTextSecondary,
        overflow: 'hidden',
      }}
    >
      {isUrl ? (
        <img src={avatar} alt={label || name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius }} />
      ) : isEmoji ? (
        <span style={{ fontSize: iconSize * 1.2, lineHeight: 1 }}>{avatar}</span>
      ) : avatar ? (
        <span style={{ fontSize: iconSize, fontWeight: 700 }}>{avatar}</span>
      ) : (
        <span style={{ fontSize: iconSize, fontWeight: 700 }}>{initial}</span>
      )}
    </span>
  );
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
