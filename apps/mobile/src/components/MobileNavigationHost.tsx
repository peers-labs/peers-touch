import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import {
  restoreFocusTarget, restoreScrollPosition, saveFocusTarget, saveScrollPosition,
} from '../app/navigation/scrollRestoration';
import { MobilePageActivity } from './mobilePageLifetime';

export interface MobileNavigationFrame {
  readonly key: string;
  readonly locationKey?: string;
  readonly content: ReactNode;
}

/** The native return path keeps the last four detail views, never a history cache. */
export const MOBILE_RETAINED_DETAIL_LIMIT = 4;
const PRIMARY_FRAME_LIMIT = 3;

interface MobileNavigationHostProps {
  readonly primary: MobileNavigationFrame;
  readonly details?: readonly MobileNavigationFrame[];
}

/**
 * PageHost owns presentation lifetime only. Hidden Activity trees retain DOM
 * and local state, but disconnect effects/subscriptions. Runtime truth remains
 * owned by the app registry. An identity-keyed parent owns the scope fence.
 */
export function MobileNavigationHost({ primary, details = [] }: MobileNavigationHostProps) {
  const [visited, setVisited] = useState<readonly MobileNavigationFrame[]>([primary]);
  const existing = visited.find(frame => frame.key === primary.key);
  const roots = existing
    ? visited.map(frame => frame.key === primary.key ? primary : frame)
    : [...visited, primary].slice(-PRIMARY_FRAME_LIMIT);
  // Admission happens in the navigation render, with no post-paint extra frame.
  if (!existing) setVisited(roots);
  const retainedDetails = details.slice(-MOBILE_RETAINED_DETAIL_LIMIT);
  const activeKey = retainedDetails.at(-1)?.key ?? primary.key;

  return <div className="mobile-navigation-host" data-navigation-host>
    {[...roots, ...retainedDetails].map(frame => (
      <RetainedFrame key={frame.key} frame={frame} active={frame.key === activeKey} />
    ))}
  </div>;
}

function RetainedFrame({ frame, active }: { frame: MobileNavigationFrame; active: boolean }) {
  return <div className="mobile-navigation-frame" hidden={!active}
    data-navigation-frame={frame.key} data-navigation-active={active ? 'true' : 'false'}>
    <MobilePageActivity visible={active}><NavigationFrame frame={frame} /></MobilePageActivity>
  </div>;
}

function NavigationFrame({ frame }: { readonly frame: MobileNavigationFrame }) {
  const root = useRef<HTMLDivElement>(null);
  const locationKey = frame.locationKey ?? frame.key;
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    // A compound frame delegates restoration to its leaf host. Restoring both
    // layers lets a changed pane key overwrite the previous pane's position.
    const ownsRestoration = () => !element.querySelector('[data-navigation-host]');
    if (ownsRestoration()) {
      restoreScrollPosition(locationKey, element);
      restoreFocusTarget(locationKey, element);
    }
    return () => {
      if (ownsRestoration()) {
        saveScrollPosition(locationKey, element);
        saveFocusTarget(locationKey, element);
      }
      // Activity hides DOM; DOM media can otherwise continue independently.
      element.querySelectorAll<HTMLMediaElement>('audio, video').forEach(media => media.pause());
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && element.contains(focused)) focused.blur();
    };
  }, [locationKey]);

  return <div ref={root} className="mobile-navigation-viewport">
    {frame.content}
  </div>;
}
