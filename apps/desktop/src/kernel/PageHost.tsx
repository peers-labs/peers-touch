// PageHost — renders pages declared via `registerPage(...)`.
//
// Responsibilities:
//   • Mount `preload:'eager'` pages immediately (first render).
//   • Schedule `preload:'idle'` pages onto a `requestIdleCallback`
//     window so the first user click is a pure visibility flip.
//   • Toggle visibility via `display: contents | none` (same trick the
//     legacy PageRouter used for chat/agent), so background pages stay
//     hot but don't paint.
//   • Render a fallback (typically the legacy PageRouter) whenever the
//     active `page` id is not registered yet — this lets us migrate
//     pages one-by-one without breaking unmigrated routes.
//
// Page descriptors are NOT allowed to fetch data on mount: see
// docs/client/desktop/runtime-projections.md. Bootstrapping is owned by
// the BootPipeline + RuntimeRegistry; this component only orchestrates
// DOM presence and visibility.

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import { scheduleIdle, markPhaseEnd, markPhaseStart } from './boot';
import {
  getExactPage,
  listIdlePreloadPages,
  listPages,
  resolvePage,
  type PageDescriptor,
  type PageResolution,
} from './page';
import { log } from '../utils/logger';

interface PageHostProps {
  page: string;
  /** Rendered when `page` is not in the registry (legacy migration aid). */
  fallback: ReactElement | null;
}

function pickInitialMounted(activePage: string): Set<string> {
  const initial = new Set<string>();
  for (const desc of listPages()) {
    if (!desc.match && desc.preload === 'eager') initial.add(desc.id);
  }
  const active = resolvePage(activePage);
  if (active) initial.add(active.pageKey);
  return initial;
}

export function PageHost({ page, fallback }: PageHostProps): ReactElement {
  const activeResolution = resolvePage(page);
  const activeDescriptor = activeResolution?.descriptor;
  const activePageKey = activeResolution?.pageKey;
  const isRegistered = Boolean(activeResolution);

  const [mounted, setMounted] = useState<Set<string>>(() => pickInitialMounted(page));
  const idleRanRef = useRef(false);

  // Ensure the active registered page is mounted (deferred via rAF so
  // the state update lands on the next frame instead of the same frame
  // as navigation, satisfying the "no synchronous setState in effects"
  // rule and avoiding an extra render on the click frame).
  useEffect(() => {
    if (!activePageKey) return;
    if (mounted.has(activePageKey)) return;
    const handle = window.requestAnimationFrame(() => {
      setMounted((prev) => {
        if (prev.has(activePageKey)) return prev;
        const next = new Set(prev);
        next.add(activePageKey);
        return next;
      });
    });
    return () => window.cancelAnimationFrame(handle);
  }, [activePageKey, mounted]);

  // After first paint, pre-warm `idle` pages during a single idle window.
  useEffect(() => {
    if (idleRanRef.current) return;
    idleRanRef.current = true;
    return scheduleIdle(() => {
      const idlePages = listIdlePreloadPages().map((p) => p.id);
      if (idlePages.length === 0) return;
      markPhaseStart('pages:prewarm');
      setMounted((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const id of idlePages) {
          if (!next.has(id)) {
            next.add(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      markPhaseEnd('pages:prewarm', { pages: idlePages });
    });
  }, []);

  // Eviction for `lru:N` pages — if a page declares an LRU cap, drop the
  // oldest extras when more than N are mounted.
  const recentRef = useRef<string[]>([]);
  useEffect(() => {
    if (!activeDescriptor || !activePageKey) return;
    const recent = recentRef.current.filter((x) => x !== activePageKey);
    recent.unshift(activePageKey);
    recentRef.current = recent;

    if (typeof activeDescriptor.keepAlive === 'object' && activeDescriptor.keepAlive !== null) {
      const cap = activeDescriptor.keepAlive.lru;
      if (recent.length > cap) {
        const toDrop = recent.slice(cap);
        if (toDrop.length > 0) {
          setMounted((prev) => {
            let changed = false;
            const next = new Set(prev);
            for (const dropId of toDrop) {
              if (next.has(dropId) && dropId !== activePageKey) {
                next.delete(dropId);
                changed = true;
              }
            }
            return changed ? next : prev;
          });
        }
      }
    }
  }, [activeDescriptor, activePageKey]);

  const registeredOrder = useMemo(() => listPages(), []);
  const dynamicPages = Array.from(mounted)
    .filter((pageKey) => !getExactPage(pageKey))
    .reduce<PageResolution[]>((items, pageKey) => {
      const resolved = resolvePage(pageKey);
      if (resolved?.dynamic) items.push(resolved);
      return items;
    }, []);
  if (activeResolution?.dynamic && !dynamicPages.some((item) => item.pageKey === activeResolution.pageKey)) {
    dynamicPages.push(activeResolution);
  }

  return (
    <>
      {registeredOrder.map((desc) =>
        desc.match ? null : renderRegisteredPage(desc, desc.id, desc.id, page, mounted),
      )}
      {dynamicPages.map((resolved) =>
        renderRegisteredPage(resolved.descriptor, resolved.pageId, resolved.pageKey, page, mounted),
      )}
      {!isRegistered && fallback}
    </>
  );
}

function renderRegisteredPage(
  desc: PageDescriptor,
  pageId: string,
  pageKey: string,
  activePage: string,
  mounted: Set<string>,
): ReactElement | null {
  const isActive = pageKey === activePage;
  if (desc.keepAlive === 'none') {
    if (!isActive) return null;
    return (
      <div key={pageKey} data-page={pageId} data-page-descriptor={desc.id} style={{ display: 'contents' }}>
        {renderFactory(desc, pageId)}
      </div>
    );
  }
  if (!mounted.has(pageKey) && !isActive) return null;
  return (
    <div
      key={pageKey}
      data-page={pageId}
      data-page-descriptor={desc.id}
      style={{ display: isActive ? 'contents' : 'none' }}
    >
      {renderFactory(desc, pageId)}
    </div>
  );
}

function renderFactory(desc: PageDescriptor, pageId: string): ReactElement | null {
  try {
    return desc.factory({ pageId, descriptorId: desc.id });
  } catch (err) {
    log.error('PageHost', `factory for ${desc.id} threw`, { pageId, err });
    return null;
  }
}
