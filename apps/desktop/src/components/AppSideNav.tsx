import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionIcon, SideNav } from '@lobehub/ui';
import { Input, Modal, theme } from 'antd';
import {
  Bot,
  MessageCircle,
  Settings,
  Search,
  FileText,
  Blocks,
  Keyboard,
  NotebookTabs,
  Plus,
  UserRoundCog,
} from 'lucide-react';
import { NotificationBell } from './NotificationBell';
import { UserProfilePopover, useUserAvatar } from './UserProfilePopover';
import { UserSquareAvatar } from './common/UserSquareAvatar';
import { AgentIconTile } from './agent/AgentIconTile';
import AppletManager from '../applet/AppletManager';
import { getModulesWithSidebar } from '../modules/registry';
import { useAgentStore } from '../store/agent';
import { useChatStore } from '../store/chat';
import { openAgentChatSession } from '../utils/openAgentChatSession';
import { useAppletsStore } from '../store/applets';
import type { Page, Navigation, AppletPins, HashRouter } from '../types/navigation';
import { markInteractionStarted } from '../kernel/frontendRuntimeProfiler';

interface AppSideNavProps {
  page: Page;
  router: HashRouter;
  navigation: Navigation;
  appletPins: AppletPins;
}

interface CommandPaletteItem {
  id: string;
  label: string;
  description: string;
  shortcut: string;
  icon: ReactNode;
  run: () => void;
}

function PrimaryNavAnchor({ pageId, children }: { readonly pageId: string; readonly children: ReactNode }) {
  return (
    <span data-pt-primary-nav={pageId} style={{ display: 'contents' }}>
      {children}
    </span>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

function shortcut(keys: string): string {
  const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';
  return keys.replace('Mod', mod).replace('Shift', '⇧');
}

export function AppSideNav({ page, navigation, appletPins }: AppSideNavProps) {
  const userAvatar = useUserAvatar();
  const appletManager = AppletManager.getInstance();
  const { t } = useTranslation('layout');
  const { token } = theme.useToken();
  const agents = useAgentStore((state) => state.agents);
  const selectedAgent = useAgentStore((state) => state.selectedAgent);
  const setAgentSurface = useAgentStore((state) => state.setAgentSurface);
  const newSession = useChatStore((state) => state.newSession);
  const installedApplets = useAppletsStore((state) => state.applets);
  const installedAppletById = useMemo(
    () => new Map(installedApplets.map((info) => [info.manifest.id, info.manifest])),
    [installedApplets],
  );
  const pinnedAgents = useMemo(() => agents.filter((agent) => agent.pinned), [agents]);

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');

  const navigatePrimary = useCallback((pageId: string) => {
    markInteractionStarted('shell', `primary-nav:${pageId}`, { pageId });
    navigation.navigateTo(pageId);
  }, [navigation]);

  const openPinnedAgent = useCallback((agentName: string) => {
    const agent = agents.find((item) => item.name === agentName);
    if (!agent) {
      navigation.navigateTo('agent');
      return;
    }
    markInteractionStarted('shell', 'primary-nav:pinned-agent', { agentName });
    void openAgentChatSession(agent, {
      draftTitle: t('agent.sidebar.newTopic', { ns: 'agent' }),
      reason: 'global-pinned-agent',
    });
    navigation.navigateTo('agent');
  }, [agents, navigation, t]);

  const navigateAgentChat = useCallback(() => {
    markInteractionStarted('shell', 'primary-nav:agent', { pageId: 'agent' });
    if (selectedAgent) {
      const agent = agents.find((item) => item.name === selectedAgent);
      if (agent) {
        void openAgentChatSession(agent, {
          draftTitle: t('agent.sidebar.newTopic', { ns: 'agent' }),
          reason: 'global-agent-entry',
        });
      } else {
        setAgentSurface(selectedAgent, 'chat');
      }
      navigation.navigateTo('agent');
      return;
    }
    navigation.navigateTo('agent');
  }, [agents, navigation, selectedAgent, setAgentSurface, t]);

  const handleNewChat = useCallback(() => {
    const agent = agents.find((item) => item.name === selectedAgent);
    if (agent) {
      void openAgentChatSession(agent, {
        forceNew: true,
        draftTitle: t('agent.sidebar.newTopic', { ns: 'agent' }),
        reason: 'global-new-chat',
      });
      navigation.navigateTo('agent');
      return;
    }
    if (selectedAgent) setAgentSurface(selectedAgent, 'chat');
    newSession();
    navigation.navigateTo('agent');
  }, [agents, navigation, newSession, selectedAgent, setAgentSurface, t]);


  const handleNextAgent = useCallback(() => {
    if (agents.length === 0) return;
    const currentIndex = Math.max(0, agents.findIndex((agent) => agent.name === selectedAgent));
    const nextAgent = agents[(currentIndex + 1) % agents.length];
    void openAgentChatSession(nextAgent, {
      draftTitle: t('agent.sidebar.newTopic', { ns: 'agent' }),
      reason: 'next-agent',
    });
    navigation.navigateTo('agent');
  }, [agents, navigation, selectedAgent, t]);

  const commandItems = useMemo<CommandPaletteItem[]>(() => [
    {
      id: 'search',
      label: t('layout.command.search'),
      description: t('layout.command.searchDesc'),
      shortcut: shortcut('Mod K'),
      icon: <Search size={16} />,
      run: () => navigatePrimary('search'),
    },
    {
      id: 'new-chat',
      label: t('layout.command.newChat'),
      description: t('layout.command.newChatDesc'),
      shortcut: shortcut('Mod N'),
      icon: <Plus size={16} />,
      run: handleNewChat,
    },
    {
      id: 'next-agent',
      label: t('layout.command.nextAgent'),
      description: t('layout.command.nextAgentDesc'),
      shortcut: shortcut('Mod J'),
      icon: <UserRoundCog size={16} />,
      run: handleNextAgent,
    },
    {
      id: 'notes',
      label: t('layout.command.notes'),
      description: t('layout.command.notesDesc'),
      shortcut: shortcut('Mod Shift N'),
      icon: <NotebookTabs size={16} />,
      run: () => navigatePrimary('notes'),
    },
    {
      id: 'settings',
      label: t('layout.command.settings'),
      description: t('layout.command.settingsDesc'),
      shortcut: shortcut('Mod ,'),
      icon: <Settings size={16} />,
      run: () => navigatePrimary('settings'),
    },
  ], [handleNewChat, handleNextAgent, navigatePrimary, t]);

  const filteredCommands = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();
    if (!query) return commandItems;
    return commandItems.filter((item) =>
      `${item.label} ${item.description} ${item.shortcut}`.toLowerCase().includes(query),
    );
  }, [commandItems, commandQuery]);

  const runCommand = useCallback((item: CommandPaletteItem) => {
    item.run();
    setCommandPaletteOpen(false);
    setCommandQuery('');
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      if (isEditableTarget(event.target)) return;

      const key = event.key.toLowerCase();
      if (event.shiftKey && key === 'p') {
        event.preventDefault();
        setCommandPaletteOpen((open) => !open);
        return;
      }

      if (key === 'k') {
        event.preventDefault();
        navigatePrimary('search');
      } else if (key === 'n' && event.shiftKey) {
        event.preventDefault();
        navigatePrimary('notes');
      } else if (key === 'n') {
        event.preventDefault();
        handleNewChat();
      } else if (key === 'j') {
        event.preventDefault();
        handleNextAgent();
      } else if (key === ',') {
        event.preventDefault();
        navigatePrimary('settings');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNewChat, handleNextAgent, navigatePrimary]);

  return (
    <>
      <SideNav
        avatar={
          <UserProfilePopover>
            <div style={{ cursor: 'pointer', width: 36, height: 36 }}>
              <UserSquareAvatar remoteUrl={userAvatar.url} name={userAvatar.name} size={36} radius={8} />
            </div>
          </UserProfilePopover>
        }
        topActions={
          <>
            <PrimaryNavAnchor pageId="search">
              <ActionIcon
                icon={Search}
                size="large"
                active={page === 'search'}
                onClick={() => navigatePrimary('search')}
                title={t('layout.nav.search')}
              />
            </PrimaryNavAnchor>
            {pinnedAgents.length > 0 && (
              <span
                role="separator"
                aria-label="pinned-agents"
                style={{
                  width: 24,
                  height: 1,
                  margin: '4px auto',
                  background: token.colorBorderSecondary,
                  display: 'block',
                }}
              />
            )}
            {pinnedAgents.map((agent) => {
              const active = page === 'agent' && selectedAgent === agent.name;
              return (
                <PrimaryNavAnchor key={agent.id} pageId={`agent:${agent.name}`}>
                  <button
                    type="button"
                    title={agent.title || agent.name}
                    onClick={() => openPinnedAgent(agent.name)}
                    style={{
                      width: 40,
                      height: 40,
                      border: 0,
                      padding: 0,
                      borderRadius: 10,
                      background: active ? token.colorPrimaryBg : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <AgentIconTile agent={agent} size={28} selected={active} subtle />
                  </button>
                </PrimaryNavAnchor>
              );
            })}
            <PrimaryNavAnchor pageId="chat">
              <ActionIcon
                icon={MessageCircle}
                size="large"
                active={page === 'chat'}
                onClick={() => navigatePrimary('chat')}
                title={t('layout.nav.chat')}
              />
            </PrimaryNavAnchor>
            <PrimaryNavAnchor pageId="agent">
              <ActionIcon
                icon={Bot}
                size="large"
                active={page === 'agent' || page === 'agent-profile' || page === 'agent-orchestration'}
                onClick={navigateAgentChat}
                title={t('layout.nav.agent')}
              />
            </PrimaryNavAnchor>
            <PrimaryNavAnchor pageId="notes">
              <ActionIcon
                icon={FileText}
                size="large"
                active={page === 'notes'}
                onClick={() => navigatePrimary('notes')}
                title={t('layout.nav.notes')}
              />
            </PrimaryNavAnchor>
            {getModulesWithSidebar()
              .filter((m) => m.sidebarEntry!.position === 'top')
              .map((m) => (
                <PrimaryNavAnchor key={m.id} pageId={m.id}>
                  <ActionIcon
                    icon={m.icon}
                    size="large"
                    active={page === m.id}
                    onClick={() => navigatePrimary(m.id)}
                    title={m.id === 'applets' ? t('layout.nav.applets') : m.sidebarEntry?.title || m.name}
                  />
                </PrimaryNavAnchor>
              ))}
            {appletPins.pinnedApplets.filter((appletId) => installedAppletById.has(appletId)).map((appletId) => {
              const info = installedAppletById.get(appletId) ?? appletManager.getAppletInfo(appletId);
              if (!info) return null;
              return (
                <PrimaryNavAnchor key={appletId} pageId={`applet:${appletId}`}>
                  <ActionIcon
                    icon={Blocks}
                    size="large"
                    active={page === `applet:${appletId}`}
                    onClick={() => navigatePrimary(`applet:${appletId}`)}
                    title={info.name}
                  />
                </PrimaryNavAnchor>
              );
            })}
          </>
        }
        bottomActions={
          <>
            <NotificationBell />
            <ActionIcon
              icon={Keyboard}
              size="large"
              active={commandPaletteOpen}
              onClick={() => setCommandPaletteOpen(true)}
              title={t('layout.command.openPaletteWithShortcut', { shortcut: shortcut('Mod Shift P') })}
            />
            <PrimaryNavAnchor pageId="settings">
              <ActionIcon
                icon={Settings}
                size="large"
                active={page === 'settings'}
                onClick={() => navigatePrimary('settings')}
                title={t('layout.nav.settings')}
              />
            </PrimaryNavAnchor>
          </>
        }
      />

      <Modal
        open={commandPaletteOpen}
        title={t('layout.command.title')}
        footer={null}
        width={520}
        onCancel={() => setCommandPaletteOpen(false)}
      >
        <Input
          autoFocus
          value={commandQuery}
          onChange={(event) => setCommandQuery(event.target.value)}
          onPressEnter={() => {
            const first = filteredCommands[0];
            if (first) runCommand(first);
          }}
          placeholder={t('layout.command.placeholder')}
          style={{ marginBottom: 12 }}
        />
        <div style={{ display: 'grid', gap: 6 }}>
          {filteredCommands.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => runCommand(item)}
              style={{
                display: 'grid',
                gridTemplateColumns: '24px 1fr auto',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '10px 12px',
                borderRadius: 10,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
                color: token.colorText,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ color: token.colorTextSecondary }}>{item.icon}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{item.label}</span>
                <span style={{ display: 'block', fontSize: 12, color: token.colorTextTertiary }}>{item.description}</span>
              </span>
              <kbd
                style={{
                  padding: '2px 6px',
                  borderRadius: 6,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorFillQuaternary,
                  color: token.colorTextSecondary,
                  fontSize: 11,
                  fontFamily: 'inherit',
                }}
              >
                {item.shortcut}
              </kbd>
            </button>
          ))}
          {filteredCommands.length === 0 && (
            <div style={{ padding: '18px 0', color: token.colorTextTertiary, textAlign: 'center' }}>
              {t('layout.command.empty')}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
