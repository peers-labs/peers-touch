// Desktop page contract.
//
// A `PageDescriptor` declares HOW a page is mounted (preload), HOW long
// it stays in the DOM (keepAlive), and WHICH runtimes own its data
// (runtimes). The PageHost (kernel/PageHost.tsx) consumes the registry
// to mount visible pages immediately and pre-warm `idle` pages during
// `requestIdleCallback`.
//
// Pages MUST NOT trigger first-load API calls in mount-time effects.
// Data is owned by runtimes; mount-time effects are reserved for view-
// bound side-effects (focus, scroll restore, transient subscriptions).

import type { ReactElement } from 'react';

export type Preload =
  /** Mount as soon as the host renders (e.g. landing page). */
  | 'eager'
  /** Mount during the first idle window after first paint. */
  | 'idle'
  /** Mount only when the page becomes active. */
  | 'on-visit';

export type KeepAlive =
  /** Stay mounted (display:none when not active) for the process lifetime. */
  | 'forever'
  /** Most-recently-used cache; older pages are unmounted. */
  | { lru: number }
  /** Unmount when the page leaves. */
  | 'none';

export interface PageDescriptor {
  /** Stable identifier matching `Page` ids in `types/navigation.ts`. */
  readonly id: string;
  /** Optional human label for diagnostics; not user-visible. */
  readonly title?: string;
  /**
   * Optional matcher for dynamic routes such as `applet:<id>`.
   * Exact `id` matches always win before dynamic descriptors are considered.
   */
  readonly match?: (pageId: string) => boolean;
  /** Render the page tree. The host wraps it in keep-alive container divs. */
  factory(context: PageFactoryContext): ReactElement;
  readonly preload: Preload;
  readonly keepAlive: KeepAlive;
  /**
   * Runtime ids the page depends on. PageHost guarantees these are
   * installed (and bootstrapped if the user is authenticated) before the
   * page becomes visible.
   */
  readonly runtimes: ReadonlyArray<string>;
}

export interface PageFactoryContext {
  /** Actual route id, e.g. `applet:hello-lynx` for dynamic descriptors. */
  readonly pageId: string;
  /** Descriptor id, e.g. `applet:*` for dynamic descriptors. */
  readonly descriptorId: string;
  /** True only while this PageFrame owns the active route. */
  readonly active: boolean;
}

export interface PageResolution {
  readonly descriptor: PageDescriptor;
  readonly pageId: string;
  readonly pageKey: string;
  readonly dynamic: boolean;
}

const registry = new Map<string, PageDescriptor>();
const dynamicRegistry: PageDescriptor[] = [];

export function registerPage(desc: PageDescriptor): void {
  registry.set(desc.id, desc);
  if (desc.match && !dynamicRegistry.some((item) => item.id === desc.id)) {
    dynamicRegistry.push(desc);
  }
}

export function getPage(id: string): PageDescriptor | undefined {
  return resolvePage(id)?.descriptor;
}

export function getExactPage(id: string): PageDescriptor | undefined {
  return registry.get(id);
}

export function resolvePage(id: string): PageResolution | undefined {
  const exact = registry.get(id);
  if (exact) {
    return {
      descriptor: exact,
      pageId: id,
      pageKey: exact.id,
      dynamic: false,
    };
  }
  const dynamic = dynamicRegistry.find((desc) => desc.match?.(id) === true);
  if (!dynamic) return undefined;
  return {
    descriptor: dynamic,
    pageId: id,
    pageKey: id,
    dynamic: true,
  };
}

export function listPages(): PageDescriptor[] {
  return Array.from(registry.values());
}

export function listIdlePreloadPages(): PageDescriptor[] {
  return listPages().filter((p) => !p.match && p.preload === 'idle');
}

/** Test aid — registry is process-singleton in production. */
export function _resetPageRegistryForTests(): void {
  registry.clear();
  dynamicRegistry.length = 0;
}
