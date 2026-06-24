import { useCallback, useEffect, useState } from 'react';
import { useChatStore } from '../store/chat';
import { EVENT, eventBus } from '../kernel/events';
import type { ParsedDeepLink } from '../utils/deeplink';
import type { HashRouter, Navigation, SettingsNavState, Page } from '../types/navigation';

export function useNavigation(router: HashRouter): Navigation {
  const [settingsNav, setSettingsNav] = useState<SettingsNavState>({});

  const navigateTo = useCallback((page: Page) => {
    router.setPage(page);
  }, [router.setPage]);

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
    return eventBus.subscribe(EVENT.NAVIGATION_REQUESTED, (parsed) => {
      const nav = parsed as ParsedDeepLink;
      if (!nav?.resource) return;
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
          break;
        case 'channels':
          router.setPage('channels');
          break;
        case 'documents':
          router.setPage('notes');
          break;
      }
    });
  }, [router.setPage]);

  return { settingsNav, navigateTo, navigateToSettings, handleSearchNavigate };
}
