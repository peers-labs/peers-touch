/**
 * Hash-based client-side router hook.
 * Parses window.location.hash to determine the current page,
 * and provides a navigateTo function for programmatic navigation.
 */

import { useState, useEffect, useCallback } from 'react';
import type { Page } from '../utils/constants';
import { PAGES } from '../utils/constants';

/** Extract the current page identifier from the URL hash. */
function parseHash(): Page {
  const hash = window.location.hash.replace('#/', '').split('/')[0] || PAGES.OVERVIEW;
  if (Object.values(PAGES).includes(hash as Page)) return hash as Page;
  return PAGES.OVERVIEW;
}

export function useHashRouter() {
  const [page, setPage] = useState<Page>(parseHash);

  useEffect(() => {
    const handler = () => setPage(parseHash());
    window.addEventListener('hashchange', handler);
    window.addEventListener('popstate', handler);
    return () => {
      window.removeEventListener('hashchange', handler);
      window.removeEventListener('popstate', handler);
    };
  }, []);

  const navigateTo = useCallback((target: Page) => {
    window.history.pushState(null, '', `#/${target}`);
    setPage(target);
  }, []);

  return { page, navigateTo };
}
