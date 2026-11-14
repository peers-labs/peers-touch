import type {
  FederationCatalogEntry,
  FederationResolveView,
} from '../../services/desktop_api';

export interface ActorSearchResult {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  homeStationPeerId: string;
  federation?: {
    handle: string;
    homeStationDomain: string;
    fromCache: boolean;
    isLocal: boolean;
    locatorSeq: number;
  };
  homeStationName?: string;
}

export type FindPeopleScopeKind = 'federation' | 'station';

export interface FindPeopleScopePresentation {
  name: string;
  labelKey: 'chat.social.findPeople.scopeFederationNamed';
  tooltipKey: 'chat.social.findPeople.scopeFederationTooltip';
}

export function findPeopleScopePresentation(
  name: string,
  id: string,
): FindPeopleScopePresentation {
  const displayName = name.trim() || id.trim().slice(0, 8);
  return {
    name: displayName,
    labelKey: 'chat.social.findPeople.scopeFederationNamed',
    tooltipKey: 'chat.social.findPeople.scopeFederationTooltip',
  };
}

interface FriendRequestFederationContext {
  senderPtid: string;
  receiverPtid: string;
  federationId: string;
}

export function friendRequestFederationId(
  requests: readonly FriendRequestFederationContext[],
  currentUserPtid: string | null,
  peerPtid: string,
): string {
  if (!currentUserPtid || !peerPtid) return '';
  const federationIds = new Set(
    requests
      .filter((request) => (
        (
          request.senderPtid === currentUserPtid
          && request.receiverPtid === peerPtid
        )
        || (
          request.senderPtid === peerPtid
          && request.receiverPtid === currentUserPtid
        )
      ))
      .map((request) => request.federationId.trim())
      .filter(Boolean),
  );
  return federationIds.size === 1
    ? federationIds.values().next().value ?? ''
    : '';
}

export function resolvedProfileToSearchResult(
  view: FederationResolveView,
): ActorSearchResult | null {
  const profile = view.profile;
  const id = profile?.ref?.ptid.trim() ?? '';
  if (!profile || !id) return null;

  return {
    id,
    username: profile.username,
    displayName: profile.displayName,
    avatar: profile.avatar,
    homeStationPeerId: view.homeStationPeerId,
    federation: {
      handle: view.federatedHandle,
      homeStationDomain: view.homeStationDomain,
      fromCache: view.fromCache,
      isLocal: view.isLocal,
      locatorSeq: Number(view.locatorSeq),
    },
  };
}

export function catalogEntryToSearchResult(
  entry: FederationCatalogEntry,
): ActorSearchResult {
  const handle = entry.federatedHandle || '';
  const parts = handle.replace(/^@/, '').split('@');
  const localPart = parts[0] || '';
  const host = parts[1] || '';

  return {
    id: entry.actorPtid,
    username: localPart,
    displayName: entry.displayName || localPart,
    avatar: entry.avatarUrl || '',
    homeStationPeerId: entry.homeStationPeerId,
    federation: {
      handle,
      homeStationDomain: host,
      fromCache: false,
      isLocal: false,
      locatorSeq: 0,
    },
    homeStationName: entry.homeStationName,
  };
}

/** Structural shape of the local actor-search API item (see desktop_api). */
export interface LocalActorSearchItem {
  actorPtid: string;
  username: string;
  displayName: string;
  avatar?: string;
  homeStationPeerId: string;
}

export function localActorToSearchResult(
  actor: LocalActorSearchItem,
): ActorSearchResult | null {
  const id = actor.actorPtid.trim();
  if (!id) return null;

  return {
    id,
    username: actor.username,
    displayName: actor.displayName || actor.username,
    avatar: actor.avatar || '',
    homeStationPeerId: actor.homeStationPeerId,
  };
}

export function mergeActorSearchResults(
  ...groups: ReadonlyArray<ReadonlyArray<ActorSearchResult>>
): ActorSearchResult[] {
  const byActorPtid = new Map<string, ActorSearchResult>();
  for (const group of groups) {
    for (const actor of group) {
      if (!actor.id.trim()) continue;
      byActorPtid.set(actor.id, actor);
    }
  }
  return [...byActorPtid.values()];
}

export interface FederationScopeOption {
  federationId: string;
  federationName: string;
}

/**
 * Order the Find-People Federation chips. The most-recently-used context is
 * pinned first when present; everything else falls back to a stable Latin
 * alphabetical order on the display name (then id), so the row never depends
 * on backend return order. Pure and side-effect free for deterministic tests.
 */
export function orderFederationOptions(
  options: readonly FederationScopeOption[],
  recentFederationId?: string,
): FederationScopeOption[] {
  const recent = recentFederationId?.trim();
  const label = (option: FederationScopeOption): string =>
    (option.federationName.trim() || option.federationId.trim()).toLowerCase();
  const sorted = [...options].sort((a, b) => {
    const byLabel = label(a).localeCompare(label(b), 'en');
    if (byLabel !== 0) return byLabel;
    return a.federationId.localeCompare(b.federationId, 'en');
  });
  if (!recent) return sorted;
  const recentIndex = sorted.findIndex((option) => option.federationId === recent);
  if (recentIndex <= 0) return sorted;
  const [recentOption] = sorted.splice(recentIndex, 1);
  return [recentOption, ...sorted];
}

const RECENT_FEDERATION_STORAGE_KEY = 'peers.find-people.recent-federation';

/** Read the persisted most-recent Federation scope (best-effort, SSR-safe). */
export function readRecentFederationId(): string {
  try {
    return window.localStorage.getItem(RECENT_FEDERATION_STORAGE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

/** Persist the Federation scope the user just picked as the recent default. */
export function writeRecentFederationId(federationId: string): void {
  const id = federationId.trim();
  if (!id) return;
  try {
    window.localStorage.setItem(RECENT_FEDERATION_STORAGE_KEY, id);
  } catch {
    // Storage can be unavailable (private mode); ordering just falls back to
    // alphabetical, so ignore write failures.
  }
}
