export type PendingMutations = Record<string, true>;

export interface RevalidationState {
  loading: boolean;
  error: string | null;
  lastLoadedAt: number | null;
  pendingMutations: PendingMutations;
}

export function toStoreError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'operation_failed';
}

export function beginMutation(pendingMutations: PendingMutations, key: string): PendingMutations {
  return { ...pendingMutations, [key]: true };
}

export function endMutation(pendingMutations: PendingMutations, key: string): PendingMutations {
  const next = { ...pendingMutations };
  delete next[key];
  return next;
}
