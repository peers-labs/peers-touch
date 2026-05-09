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
  /** Render the page tree. The host wraps it in keep-alive container divs. */
  factory(): ReactElement;
  readonly preload: Preload;
  readonly keepAlive: KeepAlive;
  /**
   * Runtime ids the page depends on. PageHost guarantees these are
   * installed (and bootstrapped if the user is authenticated) before the
   * page becomes visible.
   */
  readonly runtimes: ReadonlyArray<string>;
}

const registry = new Map<string, PageDescriptor>();

export function registerPage(desc: PageDescriptor): void {
  registry.set(desc.id, desc);
}

export function getPage(id: string): PageDescriptor | undefined {
  return registry.get(id);
}

export function listPages(): PageDescriptor[] {
  return Array.from(registry.values());
}

export function listIdlePreloadPages(): PageDescriptor[] {
  return listPages().filter((p) => p.preload === 'idle');
}

/** Test aid — registry is process-singleton in production. */
export function _resetPageRegistryForTests(): void {
  registry.clear();
}
