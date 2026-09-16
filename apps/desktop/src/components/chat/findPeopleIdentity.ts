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
