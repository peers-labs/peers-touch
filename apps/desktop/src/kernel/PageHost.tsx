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

import {
  Profiler,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ProfilerOnRenderCallback,
  type ReactElement,
  type ReactNode,
} from 'react';

import { scheduleIdle, markPhaseEnd, markPhaseStart } from './boot';
import { scheduler } from './scheduler';
import {
  getExactPage,
  listIdlePreloadPages,
  listPages,
  resolvePage,
  type PageDescriptor,
  type PageResolution,
} from './page';
import { acquirePageRuntimeLease, releasePageRuntimeLease } from './pageRuntimeLease';
import {
  markRouteRequested,
  markRouteVisible,
  scheduleAfterPaint,
  isFrontendRuntimeProfilerEnabled,
  recordReactCommit,
  recordHiddenSurfaceRender,
  recordSurfaceRender,
} from './frontendRuntimeProfiler';
import { PageActivityProvider } from './PageActivityContext';
import { log } from '../utils/logger';

interface PageHostProps {
  page: string;
  /** Rendered when `page` is not in the registry (legacy migration aid). */
  fallback: ReactElement | null;
}

function scheduleRouteVisible(pageId: string, data: Record<string, unknown>): () => void {
  let cancelled = false;
  scheduleAfterPaint(() => {
    if (!cancelled) markRouteVisible(pageId, data);
  });
  return () => { cancelled = true; };
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
  const activePageId = activeResolution?.pageId;
  const activePageKey = activeResolution?.pageKey;
  const isRegistered = Boolean(activeResolution);

  const [mounted, setMounted] = useState<Set<string>>(() => pickInitialMounted(page));
  const idlePrewarmStartedRef = useRef(false);
  const activePageIdRef = useRef<string | null>(null);

  useEffect(() => {
    markRouteRequested(page, {
      registered: isRegistered,
      descriptorId: activeDescriptor?.id,
    });
  }, [activeDescriptor?.id, isRegistered, page]);

  useEffect(() => {
    if (isRegistered && activePageKey && !mounted.has(activePageKey)) return;
    return scheduleRouteVisible(page, {
      descriptorId: activeDescriptor?.id,
      mounted: activePageKey ? mounted.has(activePageKey) : true,
      registered: isRegistered,
    });
  }, [activeDescriptor?.id, activePageKey, isRegistered, mounted, page]);

  useEffect(() => {
    const previousPageId = activePageIdRef.current;
    if (previousPageId && previousPageId !== (activePageId ?? null)) {
      const previous = resolvePage(previousPageId);
      if (previous?.descriptor.keepAlive === 'none') {
        releasePageRuntimeLease(previousPageId, 'unmount');
      }
    }
    activePageIdRef.current = activePageId ?? null;
    if (!activePageId) return;
    acquirePageRuntimeLease(activePageId, 'activate');
  }, [activePageId]);

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

  // After first paint, pre-warm `idle` pages one per idle slot. Mounting
  // several heavy primary tabs in the same callback creates a visible main
  // thread burst and makes tab clicks feel sticky.
  useEffect(() => {
    let cancelled = false;
    let cancelIdle: (() => void) | undefined;
    const mountedPages: string[] = [];
    const mountNext = (remaining: string[]) => {
      if (cancelled) return;
      const [nextPage, ...rest] = remaining;
      if (!nextPage) {
        markPhaseEnd('pages:prewarm', { pages: mountedPages });
        return;
      }
      cancelIdle = scheduleIdle(() => {
        if (cancelled) return;
        mountedPages.push(nextPage);
        acquirePageRuntimeLease(nextPage, 'prewarm');
        setMounted((prev) => {
          if (prev.has(nextPage)) return prev;
          const next = new Set(prev);
          next.add(nextPage);
          return next;
        });
        mountNext(rest);
      }, 2500);
    };
    cancelIdle = scheduleIdle(() => {
      if (idlePrewarmStartedRef.current) return;
      idlePrewarmStartedRef.current = true;
      const idlePages = listIdlePreloadPages().map((p) => p.id);
      if (idlePages.length === 0) return;
      markPhaseStart('pages:prewarm');
      mountNext(idlePages);
    });
    return () => {
      cancelled = true;
      cancelIdle?.();
    };
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
          for (const dropId of toDrop) {
            if (dropId !== activePageKey) {
              releasePageRuntimeLease(dropId, 'evict');
            }
          }
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

  // Global LRU cap (D-07 Phase 1c): max 5 hidden pages total.
  // When total hidden pages exceed PAGE_HOST_LRU_CAP, evict the oldest
  // via scheduler.teardown lane and emit page.evict telemetry.
  const PAGE_HOST_LRU_CAP = 5;
  useEffect(() => {
    if (!activePageKey) return;
    const hiddenPages = Array.from(mounted).filter((k) => k !== activePageKey);
    if (hiddenPages.length <= PAGE_HOST_LRU_CAP) return;

    const recent = recentRef.current;
    const hiddenByRecency = hiddenPages.sort((a, b) => {
      const ai = recent.indexOf(a);
      const bi = recent.indexOf(b);
      return (bi === -1 ? Infinity : bi) - (ai === -1 ? Infinity : ai);
    });
    const toEvict = hiddenByRecency.slice(PAGE_HOST_LRU_CAP);
    if (toEvict.length === 0) return;

    scheduler.teardown('pagehost:global-lru-evict', () => {
      for (const evictKey of toEvict) {
        releasePageRuntimeLease(evictKey, 'evict');
        log.info('pageHost', `page.evict: ${evictKey}`, { reason: 'global-lru-cap', cap: PAGE_HOST_LRU_CAP });
      }
      setMounted((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const evictKey of toEvict) {
          if (next.has(evictKey) && evictKey !== activePageKey) {
            next.delete(evictKey);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
  }, [activePageKey, mounted]);

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
        desc.match ? null : (
          <RegisteredPageFrame
            key={desc.id}
            desc={desc}
            pageId={desc.id}
            pageKey={desc.id}
            isActive={desc.id === page}
            mounted={mounted.has(desc.id)}
          />
        ),
      )}
      {dynamicPages.map((resolved) =>
        <RegisteredPageFrame
          key={resolved.pageKey}
          desc={resolved.descriptor}
          pageId={resolved.pageId}
          pageKey={resolved.pageKey}
          isActive={resolved.pageKey === page}
          mounted={mounted.has(resolved.pageKey)}
        />,
      )}
      {!isRegistered && fallback}
    </>
  );
}

const RegisteredPageFrame = memo(function RegisteredPageFrame({
  desc,
  pageId,
  pageKey,
  isActive,
  mounted,
}: {
  desc: PageDescriptor;
  pageId: string;
  pageKey: string;
  isActive: boolean;
  mounted: boolean;
}): ReactElement | null {
  useEffect(() => {
    if (mounted && !isActive) {
      recordHiddenSurfaceRender(pageKey, { descriptorId: desc.id, pageId });
    }
  });

  if (desc.keepAlive === 'none') {
    if (!isActive) return null;
    return (
      <div key={pageKey} data-page={pageId} data-page-descriptor={desc.id} style={{ display: 'contents' }}>
        <PageFrameCommitProfiler active={isActive} descriptorId={desc.id} pageId={pageId} pageKey={pageKey}>
          <PageActivityProvider active={isActive} descriptorId={desc.id} pageId={pageId}>
            {renderFactory(desc, pageId, isActive)}
          </PageActivityProvider>
        </PageFrameCommitProfiler>
      </div>
    );
  }
  if (!mounted && !isActive) return null;
  return (
    <div
      key={pageKey}
      data-page={pageId}
      data-page-descriptor={desc.id}
      style={{ display: isActive ? 'contents' : 'none' }}
    >
      <PageFrameCommitProfiler active={isActive} descriptorId={desc.id} pageId={pageId} pageKey={pageKey}>
        <PageActivityProvider active={isActive} descriptorId={desc.id} pageId={pageId}>
          {renderFactory(desc, pageId, isActive)}
        </PageActivityProvider>
      </PageFrameCommitProfiler>
    </div>
  );
});

function PageFrameCommitProfiler({
  active,
  children,
  descriptorId,
  pageId,
  pageKey,
}: {
  active: boolean;
  children: ReactNode;
  descriptorId: string;
  pageId: string;
  pageKey: string;
}): ReactElement {
  if (!isFrontendRuntimeProfilerEnabled()) return <>{children}</>;
  const owner = `page-frame:${pageKey}`;
  const onRender: ProfilerOnRenderCallback = (
    id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime,
  ) => {
    recordReactCommit({
      actualDuration,
      baseDuration,
      commitTime,
      data: { active, descriptorId, surface: 'page-frame' },
      id,
      owner,
      pageId,
      phase,
      source: 'shell',
      startTime,
    });
  };
  return (
    <Profiler id={owner} onRender={onRender}>
      {children}
    </Profiler>
  );
}

function renderFactory(desc: PageDescriptor, pageId: string, active: boolean): ReactElement | null {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    const result = desc.factory({ pageId, descriptorId: desc.id, active });
    const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    recordSurfaceRender(pageId, ms, { descriptorId: desc.id });
    return result;
  } catch (err) {
    log.error('PageHost', `factory for ${desc.id} threw`, { pageId, err });
    return null;
  }
}
