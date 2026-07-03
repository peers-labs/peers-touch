import type { PrototypeWorktreeTarget } from './types';

/**
 * The worktree/branch this portal instance is serving. Injected by
 * `make run-prototype` via env; read-only, shown in the header.
 */
export const CURRENT_WORKTREE: PrototypeWorktreeTarget = {
  id: 'current',
  label: import.meta.env.VITE_PROTOTYPE_BRANCH ?? 'current',
  branch: import.meta.env.VITE_PROTOTYPE_BRANCH ?? 'current',
  worktreePath: import.meta.env.VITE_PROTOTYPE_WORKTREE_PATH ?? 'current',
  sites: {},
};
