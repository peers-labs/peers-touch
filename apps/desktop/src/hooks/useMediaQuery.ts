import { useEffect, useState } from 'react';

/**
 * Reactive CSS media query hook.
 *
 * The narrow-shell contract (single-pane chat swap, compact insets) is owned
 * by the same 720px / 480px breakpoints as the north-star prototype; the
 * hook only exposes the match so layout state stays in React while the
 * show/hide rules stay in CSS.
 */
export const NARROW_MEDIA_QUERY = '(max-width: 720px)';
export const PHONE_MEDIA_QUERY = '(max-width: 480px)';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia(query);
    const sync = () => setMatches(media.matches);
    // Re-sync on mount: the initial state may have been computed before the
    // final window size (or in an environment whose default differs).
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [query]);

  return matches;
}
