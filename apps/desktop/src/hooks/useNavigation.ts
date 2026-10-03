import { useCallback, useEffect, useState } from 'react';
import { useChatStore } from '../store/chat';
import { useAgentStore } from '../store/agent';
import { EVENT, eventBus } from '../kernel/events';
import { openAgentChatSession } from '../utils/openAgentChatSession';
import type { ParsedDeepLink } from '../utils/deeplink';
import {
  DEFAULT_READY_PAGE,
  type HashRouter,
  type Navigation,
  type SettingsNavState,
  type Page,
} from '../types/navigation';

export function useNavigation(router: HashRouter): Navigation {
  const [settingsNav, setSettingsNav] = useState<SettingsNavState>({});

  const navigateTo = useCallback((page: Page) => {
    router.setPage(page);
  }, [router.setPage, router.setProfilePage]);

  const navigateToAgentSurface = useCallback((agentName: string, surface: 'chat' | 'profile') => {
    const agentStore = useAgentStore.getState();
    const agent = agentStore.agents.find((item) => item.name === agentName);
    if (surface === 'profile') {
      agentStore.setSelectedAgent(agentName);
      agentStore.setAgentSurface(agentName, 'profile');
      router.setPage('agent');
      return;
    }

    if (agent) {
      void openAgentChatSession(agent, { reason: 'navigate-agent-chat' });
    } else {
      agentStore.setSelectedAgent(agentName);
      agentStore.setAgentSurface(agentName, 'chat');
    }
    router.setPage('agent');
  }, [router.setPage, router.setProfilePage]);

  const navigateToSettings = useCallback((tab: string, highlightId?: string) => {
    setSettingsNav({ tab, highlightId });
    router.setPage('settings');
  }, [router.setPage]);

  const handleSearchNavigate = useCallback((url: string) => {
    if (url.startsWith('/chat')) {
      const params = new URLSearchParams(url.split('?')[1] || '');
      const sessionKey = params.get('session');
      if (sessionKey) {
        useChatStore.getState().selectSession(sessionKey);
      }
      router.setPage('agent');
    } else if (url.startsWith('/agent-profile/')) {
      const agentName = decodeURIComponent(url.split('/agent-profile/')[1] || '');
      if (agentName) router.setProfilePage(agentName);
    } else if (url.startsWith('/notes/') || url.startsWith('/pages/')) {
      router.setPage(DEFAULT_READY_PAGE);
    } else if (url.startsWith('/settings')) {
      const params = new URLSearchParams(url.split('?')[1] || '');
      setSettingsNav({
        tab: params.get('tab') || undefined,
        highlightId: params.get('id') || undefined,
      });
      router.setPage('settings');
    }
  }, [router.setPage]);

  useEffect(() => {
    const unsubscribe = eventBus.subscribe(EVENT.NAVIGATION_REQUESTED, (parsed) => {
      const nav = parsed as ParsedDeepLink;
      if (!nav?.resource) return;
      switch (nav.resource) {
        case 'cron':
          setSettingsNav({ tab: 'cron' });
          router.setPage('settings');
          break;
        case 'sessions':
          if (nav.id) {
            useChatStore.getState().selectSession(nav.id);
          }
          router.setPage('agent');
          break;
        case 'settings':
          if (nav.id) setSettingsNav({ tab: nav.id });
          router.setPage('settings');
          break;
        case 'channels':
          setSettingsNav({ tab: 'channels' });
          router.setPage('settings');
          break;
        case 'marketplace':
          router.setPage('marketplace');
          break;
        case 'evaluation':
          router.setPage('evaluation');
          break;
        case 'documents':
          router.setPage(DEFAULT_READY_PAGE);
          break;
      }
    });
    return () => {
      unsubscribe();
    };
  }, [router.setPage]);

  return { settingsNav, navigateTo, navigateToAgentSurface, navigateToSettings, handleSearchNavigate };
}
