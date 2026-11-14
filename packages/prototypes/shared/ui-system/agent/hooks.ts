import { useEffect, useRef, useState } from 'react';
import { NARROW_WIDTH, ULTRA_NARROW_WIDTH, type WorkbenchLayout } from './types';

/**
 * Observe an element's content-box width. Browser ResizeObserver only —
 * no foreign layout library. Width 0 means "not measured yet", matching the
 * production deriveAgentWorkbenchLayout guard.
 */
export function useContainerWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (typeof next === 'number') setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

/**
 * Prototype mirror of deriveAgentWorkbenchLayout. Narrow rails are mutually
 * exclusive: opening the roster collapses the topic rail before the layout
 * transition; below the ultra-narrow breakpoint both leave the reading path
 * and move into transient drawers.
 */
export function deriveLayout(
  width: number,
  agentRailOpen: boolean,
  topicRailOpen: boolean,
): WorkbenchLayout {
  const narrow = width > 0 && width < NARROW_WIDTH;
  const ultraNarrow = width > 0 && width < ULTRA_NARROW_WIDTH;
  return {
    narrow,
    ultraNarrow,
    agentRail: ultraNarrow ? 'hidden' : agentRailOpen ? 'expanded' : 'collapsed',
    topicRail: ultraNarrow
      ? 'hidden'
      : topicRailOpen && !(narrow && agentRailOpen)
        ? 'expanded'
        : 'collapsed',
    workbenchVisible: !narrow,
  };
}
