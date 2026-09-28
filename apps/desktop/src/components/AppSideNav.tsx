import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionIcon, SideNav } from '@lobehub/ui';
import { Badge, theme } from 'antd';
import {
  Bot,
  MessageCircle,
  Settings,
  Search,
  FlaskConical,
  Blocks,
  Sparkles,
} from 'lucide-react';
import { NotificationBell } from './NotificationBell';
import { UserProfilePopover, useUserAvatar } from './UserProfilePopover';
import { UserSquareAvatar } from './common/UserSquareAvatar';
import { AgentIconTile } from './agent/AgentIconTile';
import AppletManager from '../applet/AppletManager';
import { getModulesWithSidebar } from '../modules/registry';
import { useAgentStore } from '../store/agent';
import { useChatStore } from '../store/chat';
import { useNavigationBadgeStore } from '../store/navigationBadges';
import { openAgentChatSession } from '../utils/openAgentChatSession';
import { useAppletsStore } from '../store/applets';
import type { Page, Navigation, AppletPins } from '../types/navigation';
import { markInteractionStarted } from '../kernel/frontendRuntimeProfiler';

interface AppSideNavProps {
  page: Page;
  navigation: Navigation;
  appletPins: AppletPins;
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

export function AppSideNav({ page, navigation, appletPins }: AppSideNavProps) {
  const userAvatar = useUserAvatar();
  const appletManager = AppletManager.getInstance();
  const { t } = useTranslation('layout');
  const { token } = theme.useToken();
  const agents = useAgentStore((state) => state.agents);
  const selectedAgent = useAgentStore((state) => state.selectedAgent);
  const setAgentSurface = useAgentStore((state) => state.setAgentSurface);
  const newSession = useChatStore((state) => state.newSession);
  const chatUnreadTotal = useNavigationBadgeStore((state) => state.chatUnreadTotal);
  const installedApplets = useAppletsStore((state) => state.applets);
  const installedAppletById = useMemo(
    () => new Map(installedApplets.map((info) => [info.manifest.id, info.manifest])),
    [installedApplets],
  );
  const pinnedAgents = useMemo(() => agents.filter((agent) => agent.pinned), [agents]);

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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      if (isEditableTarget(event.target)) return;

      const key = event.key.toLowerCase();
      if (key === 'n' && !event.shiftKey) {
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
              <span
                data-pt-navigation-badge="chat"
                data-pt-unread-count={chatUnreadTotal}
                style={{ display: 'contents' }}
              >
                <Badge count={chatUnreadTotal} size="small" offset={[-2, 2]}>
                  <ActionIcon
                    icon={MessageCircle}
                    size="large"
                    active={page === 'chat'}
                    onClick={() => navigatePrimary('chat')}
                    title={t('layout.nav.chat')}
                  />
                </Badge>
              </span>
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
            <PrimaryNavAnchor pageId="evaluation">
              <ActionIcon
                icon={FlaskConical}
                size="large"
                active={page === 'evaluation'}
                onClick={() => navigatePrimary('evaluation')}
                title={t('agent.eval.title', { ns: 'agent' })}
              />
            </PrimaryNavAnchor>
            <PrimaryNavAnchor pageId="marketplace">
              <ActionIcon
                icon={Sparkles}
                size="large"
                active={page === 'marketplace'}
                onClick={() => navigatePrimary('marketplace')}
                title={t('layout.nav.marketplace')}
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
    </>
  );
}
