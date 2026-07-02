import type { PrototypeWorktreeTarget } from './types';

/**
 * The worktree this portal instance is itself serving. Injected by
 * `make run-prototype` via env. Always available for immediate render; the
 * live switcher list is discovered at runtime from the dev-server registry.
 */
export const SELF_TARGET: PrototypeWorktreeTarget = {
  id: 'self',
  label: import.meta.env.VITE_PROTOTYPE_BRANCH ?? 'current',
  branch: import.meta.env.VITE_PROTOTYPE_BRANCH ?? 'current',
  worktreePath: import.meta.env.VITE_PROTOTYPE_WORKTREE_PATH ?? 'current',
  self: true,
  sites: {},
};

type DiscoveryEntry = {
  ref: string;
  branch: string;
  worktreePath: string;
  portalUrl: string;
  self: boolean;
};

/**
 * Ask the dev server which worktrees have a portal running right now. Only
 * live portals are switchable; each is previewed via iframe (never imported).
 * Returns the self target alone when discovery is unavailable (e.g. build
 * preview), so the switcher degrades to a single, honest entry.
 */
export async function discoverWorktreeTargets(): Promise<PrototypeWorktreeTarget[]> {
  try {
    const response = await fetch('/__prototype/worktrees', { headers: { accept: 'application/json' } });
    if (!response.ok) {
      return [SELF_TARGET];
    }
    const entries = (await response.json()) as DiscoveryEntry[];
    if (!Array.isArray(entries) || entries.length === 0) {
      return [SELF_TARGET];
    }
    return entries.map((entry) =>
      entry.self
        ? { ...SELF_TARGET, id: entry.ref }
        : {
            id: entry.ref,
            label: entry.branch,
            branch: entry.branch,
            worktreePath: entry.worktreePath,
            portalUrl: entry.portalUrl,
            sites: {},
          },
    );
  } catch {
    return [SELF_TARGET];
  }
}
