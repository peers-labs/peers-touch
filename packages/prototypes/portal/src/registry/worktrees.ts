import type { PrototypeSite, PrototypeWorktreeTarget } from './types';

const CURRENT_TARGET: PrototypeWorktreeTarget = {
  id: 'current',
  label: 'Current Worktree',
  branch: import.meta.env.VITE_PROTOTYPE_BRANCH ?? 'current',
  worktreePath: import.meta.env.VITE_PROTOTYPE_WORKTREE_PATH ?? 'current',
  sites: {},
};

export const WORKTREE_TARGETS: PrototypeWorktreeTarget[] = [
  CURRENT_TARGET,
  ...parseWorktreeTargets(import.meta.env.VITE_PROTOTYPE_WORKTREES),
];

function parseWorktreeTargets(raw: unknown): PrototypeWorktreeTarget[] {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isWorktreeTarget);
  } catch {
    return [];
  }
}

function isWorktreeTarget(value: unknown): value is PrototypeWorktreeTarget {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<PrototypeWorktreeTarget>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id !== 'current' &&
    typeof candidate.label === 'string' &&
    typeof candidate.branch === 'string' &&
    typeof candidate.worktreePath === 'string' &&
    isSiteMap(candidate.sites)
  );
}

function isSiteMap(value: unknown): value is Partial<Record<PrototypeSite, string>> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<Record<PrototypeSite, unknown>>;
  return ['desktop', 'mobile', 'dashboard'].every((site) => {
    const url = candidate[site as PrototypeSite];
    return url === undefined || typeof url === 'string';
  });
}

