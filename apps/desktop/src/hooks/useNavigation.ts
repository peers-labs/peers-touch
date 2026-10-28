import { useCallback, useEffect, useState } from 'react';
import { useChatStore } from '../store/chat';
import { useAgentStore } from '../store/agent';
import { EVENT, eventBus } from '../kernel/events';
import { openAgentChatSession } from '../utils/openAgentChatSession';
import {
  DEFAULT_READY_PAGE,
  type HashRouter,
  type Navigation,
  type SettingsNavState,
  type Page,
} from '../types/navigation';

export function useNavigation(router: HashRouter): Navigation {
  const [settingsNav, setSettingsNav] = useState<SettingsNavState>({});
  const { setPage } = router;

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

  useEffect(() => {
    const unsubscribe = eventBus.subscribe(EVENT.NAVIGATION_REQUESTED, (parsed) => {
      const nav = parsed;
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

  return { settingsNav, navigateTo, navigateToAgentSurface, navigateToSettings };
}
