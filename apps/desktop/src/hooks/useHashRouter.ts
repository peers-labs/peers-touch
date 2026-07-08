import { startTransition, useCallback, useEffect, useState } from 'react';
import { getModule } from '../modules/registry';
import { onWindowLocationChange } from '../kernel/events';
import { persistLastActivePage } from './useAppLifecycle';
import type { HashRouter, Page } from '../types/navigation';
import { CORE_PAGE_LIST, DEFAULT_READY_PAGE } from '../types/navigation';

function parsePageFromHash(): Page {
  const hash = window.location.hash.slice(1) || `/${DEFAULT_READY_PAGE}`;
  const path = hash.startsWith('/') ? hash.slice(1) : hash;
  const segment = path.split('/')[0] || DEFAULT_READY_PAGE;
  if (segment === 'agent-profile') return 'agent-profile';
  if ((CORE_PAGE_LIST as readonly string[]).includes(segment)) return segment;
  if (segment.startsWith('applet:')) return segment;
  if (getModule(segment)) return segment;
  return DEFAULT_READY_PAGE;
}

function parseAgentNameFromHash(): string {
  const hash = window.location.hash.slice(1) || '';
  const match = hash.match(/^\/agent-profile\/(.+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : 'assistant';
}

function parseDocIdFromHash(): string | undefined {
  const hash = window.location.hash.slice(1) || '';
  const match = hash.match(/^\/notes\/(.+)$/);
  return match?.[1];
}

export function useHashRouter(): HashRouter {
  const [page, setPageRaw] = useState<Page>(parsePageFromHash);
  const [profileAgentName, setProfileAgentName] = useState(parseAgentNameFromHash);

  const setPage = useCallback((p: Page) => {
    startTransition(() => {
      setPageRaw(p);
    });
    window.history.pushState(null, '', `#/${p}`);
    persistLastActivePage(p);
  }, []);

  const setProfilePage = useCallback((agentName: string) => {
    startTransition(() => {
      setProfileAgentName(agentName);
      setPageRaw('agent-profile');
    });
    window.history.pushState(null, '', `#/agent-profile/${encodeURIComponent(agentName)}`);
    persistLastActivePage('agent-profile');
  }, []);

  const resetToDefaultPage = useCallback(() => {
    startTransition(() => {
      setPageRaw(DEFAULT_READY_PAGE);
    });
    window.history.replaceState(null, '', `#/${DEFAULT_READY_PAGE}`);
  }, []);

  useEffect(() => {
    return onWindowLocationChange(() => {
      const p = parsePageFromHash();
      startTransition(() => {
        setPageRaw(p);
        if (p === 'agent-profile') {
          setProfileAgentName(parseAgentNameFromHash());
        }
      });
      persistLastActivePage(p);
    });
  }, []);

  return {
    page,
    setPage,
    setProfilePage,
    resetToDefaultPage,
    profileAgentName,
    setProfileAgentName,
    getDocIdFromHash: parseDocIdFromHash,
  };
}
