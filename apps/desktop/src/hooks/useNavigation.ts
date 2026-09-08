import { useCallback, useEffect, useState } from 'react';
import { useChatStore } from '../store/chat';
import { useAgentStore } from '../store/agent';
import { EVENT, eventBus } from '../kernel/events';
import { openAgentChatSession } from '../utils/openAgentChatSession';
import type { ParsedDeepLink } from '../utils/deeplink';
import type { HashRouter, Navigation, SettingsNavState, Page } from '../types/navigation';

// #region debug-point A-D:as-f06-page-switch
function navigationDebugSnapshot(): Record<string, unknown> {
  const composer =
    document.querySelector<HTMLElement>('[data-pt-agent-composer]');
  return {
    hash: window.location.hash,
    composerPresent: composer !== null,
    composerVisible: Boolean(composer?.getClientRects().length),
    composerPage:
      composer?.closest<HTMLElement>('[data-page]')?.dataset.page ?? '',
    pageFrames: Array.from(
      document.querySelectorAll<HTMLElement>('[data-page]'),
    ).map((frame) => ({
      page: frame.dataset.page ?? '',
      display: frame.style.display,
      visible: frame.getClientRects().length > 0,
    })),
  };
}

function reportNavigationDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  return fetch('http://127.0.0.1:7791/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'as-f06-page-switch',
      runId: 'pre-fix',
      hypothesisId,
      location: 'useNavigation.ts:NAVIGATION_REQUESTED',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).then(() => undefined).catch(() => undefined);
}
// #endregion

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
      const docId = url.split(/\/(?:notes|pages)\//)[1];
      if (docId) {
        window.history.pushState(null, '', `#/notes/${docId}`);
      }
      router.setPage('notes');
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
    void reportNavigationDebug(
      'A',
      'subscriber-installed',
      navigationDebugSnapshot(),
    );
    const unsubscribe = eventBus.subscribe(EVENT.NAVIGATION_REQUESTED, (parsed) => {
      const nav = parsed as ParsedDeepLink;
      if (!nav?.resource) return;
      if (nav.resource === 'settings') {
        void reportNavigationDebug(
          'A-D',
          'settings-request-consumed',
          navigationDebugSnapshot(),
        );
      }
      switch (nav.resource) {
        case 'cron':
          router.setPage('cron');
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
          void reportNavigationDebug(
            'B-D',
            'settings-router-dispatched',
            navigationDebugSnapshot(),
          );
          window.requestAnimationFrame(() => {
            void reportNavigationDebug(
              'B-D',
              'settings-post-render-frame',
              navigationDebugSnapshot(),
            );
          });
          break;
        case 'channels':
          router.setPage('channels');
          break;
        case 'documents':
          router.setPage('notes');
          break;
      }
    });
    return () => {
      void reportNavigationDebug(
        'A',
        'subscriber-removed',
        navigationDebugSnapshot(),
      );
      unsubscribe();
    };
  }, [router.setPage]);

  return { settingsNav, navigateTo, navigateToAgentSurface, navigateToSettings, handleSearchNavigate };
}
