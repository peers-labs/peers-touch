import { useCallback, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionIcon, SideNav } from '@lobehub/ui';
import { Badge } from 'antd';
import {
  Bot,
  MessageCircle,
  Settings,
  Search,
  Sparkles,
} from 'lucide-react';
import { NotificationBell } from './NotificationBell';
import { UserProfilePopover, useUserAvatar } from './UserProfilePopover';
import { UserSquareAvatar } from './common/UserSquareAvatar';
import { useAgentStore } from '../store/agent';
import { useChatStore } from '../store/chat';
import { useNavigationBadgeStore } from '../store/navigationBadges';
import { openAgentChatSession } from '../utils/openAgentChatSession';
import type { Page, Navigation } from '../types/navigation';
import { markInteractionStarted } from '../kernel/frontendRuntimeProfiler';
import { getDesktopHostPolicy } from '../kernel/hostPolicy';

interface AppSideNavProps {
  page: Page;
  navigation: Navigation;
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

export function AppSideNav({ page, navigation }: AppSideNavProps) {
  const userAvatar = useUserAvatar();
  const { t } = useTranslation('layout');
  const agents = useAgentStore((state) => state.agents);
  const selectedAgent = useAgentStore((state) => state.selectedAgent);
  const setAgentSurface = useAgentStore((state) => state.setAgentSurface);
  const newSession = useChatStore((state) => state.newSession);
  const chatUnreadTotal = useNavigationBadgeStore((state) => state.chatUnreadTotal);
  const momentsEnabled = getDesktopHostPolicy().nativeSocialEnabled;

  const navigatePrimary = useCallback((pageId: Page) => {
    markInteractionStarted('shell', `primary-nav:${pageId}`, { pageId });
    navigation.navigateTo(pageId);
  }, [navigation]);

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
                active={
                  page === 'agent'
                  || page === 'agent-profile'
                  || page === 'agent-orchestration'
                  || page === 'applet:peers.atelier'
                }
                onClick={navigateAgentChat}
                title={t('layout.nav.agent')}
              />
            </PrimaryNavAnchor>
            {momentsEnabled && (
              <PrimaryNavAnchor pageId="moments">
                <ActionIcon
                  icon={Sparkles}
                  size="large"
                  active={page === 'moments'}
                  onClick={() => navigatePrimary('moments')}
                  title={t('moments.title', { ns: 'moments' })}
                />
              </PrimaryNavAnchor>
            )}
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
