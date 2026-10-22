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
  const { setPage, setProfilePage } = router;

  const navigateTo = useCallback((page: Page) => {
    setPage(page);
  }, [setPage]);

  const navigateToAgentSurface = useCallback((agentName: string, surface: 'chat' | 'profile') => {
    const agentStore = useAgentStore.getState();
    const agent = agentStore.agents.find((item) => item.name === agentName);
    if (surface === 'profile') {
      agentStore.setSelectedAgent(agentName);
      agentStore.setAgentSurface(agentName, 'profile');
      setPage('agent');
      return;
    }

    if (agent) {
      void openAgentChatSession(agent, { reason: 'navigate-agent-chat' });
    } else {
      agentStore.setSelectedAgent(agentName);
      agentStore.setAgentSurface(agentName, 'chat');
    }
    setPage('agent');
  }, [setPage]);

  const navigateToSettings = useCallback((tab: string, highlightId?: string) => {
    setSettingsNav({ tab, highlightId });
    setPage('settings');
  }, [setPage]);

  const handleSearchNavigate = useCallback((url: string) => {
    if (url.startsWith('/chat')) {
      const params = new URLSearchParams(url.split('?')[1] || '');
      const sessionKey = params.get('session');
      if (sessionKey) {
        useChatStore.getState().selectSession(sessionKey);
      }
      setPage('agent');
    } else if (url.startsWith('/agent-profile/')) {
      const agentName = decodeURIComponent(url.split('/agent-profile/')[1] || '');
      if (agentName) setProfilePage(agentName);
    } else if (url.startsWith('/notes/') || url.startsWith('/pages/')) {
      setPage(DEFAULT_READY_PAGE);
    } else if (url.startsWith('/settings')) {
      const params = new URLSearchParams(url.split('?')[1] || '');
      setSettingsNav({
        tab: params.get('tab') || undefined,
        highlightId: params.get('id') || undefined,
      });
      setPage('settings');
    }
  }, [setPage, setProfilePage]);

  useEffect(() => {
    const unsubscribe = eventBus.subscribe(EVENT.NAVIGATION_REQUESTED, (parsed) => {
      const nav = parsed as ParsedDeepLink;
      if (!nav?.resource) return;
      switch (nav.resource) {
        case 'cron':
          setSettingsNav({ tab: 'cron' });
          setPage('settings');
          break;
        case 'sessions':
          if (nav.id) {
            useChatStore.getState().selectSession(nav.id);
          }
          setPage('agent');
          break;
        case 'settings':
          if (nav.id) setSettingsNav({ tab: nav.id });
          setPage('settings');
          break;
        case 'channels':
          setSettingsNav({ tab: 'channels' });
          setPage('settings');
          break;
        case 'marketplace':
          setSettingsNav({ tab: 'discover' });
          setPage('settings');
          break;
        case 'evaluation':
          setPage('evaluation');
          break;
        case 'documents':
          setPage(DEFAULT_READY_PAGE);
          break;
      }
    });
    return () => {
      unsubscribe();
    };
  }, [setPage]);

  return { settingsNav, navigateTo, navigateToAgentSurface, navigateToSettings, handleSearchNavigate };
}
