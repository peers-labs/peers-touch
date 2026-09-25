import type { SocialApiError } from './socialTypes';

const FEDERATED_HANDLE_PATTERN = /^@[^@\s]+@[^@\s]+$/;

export type FriendRequestDecisionAction = 'accept' | 'reject';
export type FriendRequestDecisionPhase = 'pending' | 'unknown';
export type PeopleSearchFeedback =
  | 'idle'
  | 'loading'
  | 'results'
  | 'local-no-result'
  | 'unresolved-federated-handle'
  | 'remote-unavailable'
  | 'failed';

interface FriendRequestDecision {
  readonly action: FriendRequestDecisionAction;
  readonly phase: FriendRequestDecisionPhase;
}

export class FriendRequestDecisionFence {
  private readonly entries = new Map<string, FriendRequestDecision>();

  begin(scope: string, requestId: string, action: FriendRequestDecisionAction): boolean {
    const key = this.key(scope, requestId);
    if (!scope || !requestId || this.entries.has(key)) return false;
    this.entries.set(key, { action, phase: 'pending' });
    return true;
  }

  markUnknown(scope: string, requestId: string): void {
    const key = this.key(scope, requestId);
    const current = this.entries.get(key);
    if (current) this.entries.set(key, { ...current, phase: 'unknown' });
  }

  release(scope: string, requestId: string): void {
    this.entries.delete(this.key(scope, requestId));
  }

  syncAuthoritativeRequests(
    scope: string,
    authoritativeRequestIds: ReadonlySet<string>,
  ): void {
    const prefix = `${scope}\u0000`;
    for (const key of this.entries.keys()) {
      if (!key.startsWith(prefix)) continue;
      if (!authoritativeRequestIds.has(key.slice(prefix.length))) {
        this.entries.delete(key);
      }
    }
  }

  snapshot(scope: string): Readonly<Record<string, FriendRequestDecision>> {
    const prefix = `${scope}\u0000`;
    return Object.fromEntries(
      [...this.entries.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, state]) => [key.slice(prefix.length), state]),
    );
  }

  private key(scope: string, requestId: string): string {
    return `${scope}\u0000${requestId}`;
  }
}

export const friendRequestDecisionFence = new FriendRequestDecisionFence();

export function classifyPeopleSearchFeedback(input: {
  readonly query: string;
  readonly resultCount: number;
  readonly loading: boolean;
  readonly error: SocialApiError | null;
}): PeopleSearchFeedback {
  const query = input.query.trim();
  if (!query) return 'idle';
  if (input.loading) return 'loading';
  if (input.resultCount > 0) return 'results';
  const federated = FEDERATED_HANDLE_PATTERN.test(query);
  if (!input.error) {
    return federated ? 'unresolved-federated-handle' : 'local-no-result';
  }
  const { code, path, status } = input.error.context;
  const resolveFailure = federated && path.includes('/actor/federation/resolve');
  if (resolveFailure && (status === 404 || code?.toUpperCase().includes('NOT_FOUND'))) {
    return 'unresolved-federated-handle';
  }
  if (resolveFailure && (status === undefined || status >= 500)) {
    return 'remote-unavailable';
  }
  return 'failed';
}
