import type { FriendChatSession, GroupMember } from './socialProjection';
import type { FederationResolveView } from '../gen/proto/domain/federation/federation_resolve_pb';
import { ActorVisibility } from '../gen/proto/domain/actor/actor_pb';
import type { AccountProfile } from '../services/desktop_api';

export interface CurrentActorProfileProjection {
  displayName: string;
  username: string;
  avatar?: string;
}

export interface ActorIdentityProjection {
  ptid: string;
  displayName: string;
  avatarUrl: string;
  isSelf: boolean;
  resolution: 'self' | 'station' | 'session' | 'fallback';
}

export interface ResolveActorIdentityInput {
  ptid: string;
  currentUserPtid: string | null;
  currentUserProfile: CurrentActorProfileProjection | null;
  peerProfiles: Readonly<Record<string, AccountProfile | null>>;
  sessions: readonly FriendChatSession[];
  nickname?: string;
  fallbackName?: string;
  fallbackAvatar?: string;
}

export interface GroupAvatarSlotProjection {
  ptid: string;
  name: string;
  avatar: string;
}

export function actorDisplayName(
  value: string | null | undefined,
  fallback = '',
): string {
  const name = value?.trim() ?? '';
  return !name
    || /^(null|undefined)$/i.test(name)
    || /^(ptid:|did:|https?:\/\/)/i.test(name)
    || /^@?\S+@\S+$/.test(name)
    ? fallback
    : name;
}

export function remoteProfileHandle(
  profile: Pick<AccountProfile, 'acct' | 'username'>
    & Partial<Pick<AccountProfile, 'federated_handle'>>,
): string {
  for (const candidate of [profile.federated_handle, profile.acct, profile.username]) {
    const value = candidate?.trim() ?? '';
    const handle = value.replace(/^@/, '');
    const separator = handle.indexOf('@');
    if (separator > 0 && separator < handle.length - 1 && !/\s/.test(handle)) {
      return `@${handle}`;
    }
  }
  return '';
}

export function accountProfileFromFederationResolve(
  view: FederationResolveView,
  expectedPtid: string,
): AccountProfile | null {
  const profile = view.profile;
  const actorPtid = profile?.peersTouch?.networkId.trim() ?? '';
  if (!profile || !actorPtid || actorPtid !== expectedPtid.trim()) {
    return null;
  }
  return {
    id: profile.id,
    profile_revision: Number(profile.profileRevision),
    username: profile.username,
    acct: profile.acct,
    display_name: profile.displayName,
    note: profile.note,
    url: profile.url,
    avatar: profile.avatar,
    header: profile.header,
    locked: profile.locked,
    created_at: profile.createdAt,
    statuses_count: Number(profile.statusesCount),
    following_count: Number(profile.followingCount),
    followers_count: Number(profile.followersCount),
    region: profile.region,
    timezone: profile.timezone,
    tags: [...profile.tags],
    links: profile.links.map((link) => ({
      label: link.label,
      url: link.url,
    })),
    default_visibility: profile.defaultVisibility,
    manually_approves_followers: profile.manuallyApprovesFollowers,
    message_permission: profile.messagePermission,
    auto_expire_days: Number(profile.autoExpireDays),
    federated_handle: view.federatedHandle,
    home_station_peer_id: view.homeStationPeerId,
    home_station_domain: view.homeStationDomain,
    discoverability: actorVisibilityLabel(profile.discoverability),
    kind: Number(profile.kind ?? 0),
    peers_touch: {
      network_id: actorPtid,
    },
  };
}

function actorVisibilityLabel(
  visibility: ActorVisibility,
): AccountProfile['discoverability'] {
  switch (visibility) {
    case ActorVisibility.INDEXED:
      return 'indexed';
    case ActorVisibility.BY_HANDLE:
      return 'by_handle';
    case ActorVisibility.HIDDEN:
    case ActorVisibility.UNSPECIFIED:
      return 'hidden';
  }
}

function exactSessionProfile(
  sessions: readonly FriendChatSession[],
  ptid: string,
): { name: string; avatar: string } | null {
  for (const session of sessions) {
    if (session.participantAPtid === ptid) {
      return {
        name: actorDisplayName(session.participantADisplayName),
        avatar: session.participantAAvatar || '',
      };
    }
    if (session.participantBPtid === ptid) {
      return {
        name: actorDisplayName(session.participantBDisplayName),
        avatar: session.participantBAvatar || '',
      };
    }
  }
  return null;
}

export function resolveActorIdentity({
  ptid,
  currentUserPtid,
  currentUserProfile,
  peerProfiles,
  sessions,
  nickname,
  fallbackName,
  fallbackAvatar,
}: ResolveActorIdentityInput): ActorIdentityProjection {
  const canonicalPtid = ptid.trim();
  const groupNickname = actorDisplayName(nickname);
  const sessionProfile = exactSessionProfile(sessions, canonicalPtid);
  const isSelf = Boolean(currentUserPtid && canonicalPtid === currentUserPtid);

  if (isSelf) {
    const displayName = groupNickname
      || actorDisplayName(currentUserProfile?.displayName)
      || actorDisplayName(currentUserProfile?.username)
      || sessionProfile?.name
      || actorDisplayName(fallbackName)
      || canonicalPtid;
    return {
      ptid: canonicalPtid,
      displayName,
      avatarUrl: currentUserProfile?.avatar?.trim()
        || sessionProfile?.avatar || fallbackAvatar?.trim() || '',
      isSelf: true,
      resolution: 'self',
    };
  }

  const stationProfile = peerProfiles[canonicalPtid];
  if (stationProfile) {
    return {
      ptid: canonicalPtid,
      displayName: groupNickname
        || actorDisplayName(stationProfile.display_name)
        || actorDisplayName(stationProfile.username)
        || sessionProfile?.name
        || actorDisplayName(fallbackName)
        || canonicalPtid,
      avatarUrl: stationProfile.avatar?.trim()
        || sessionProfile?.avatar || fallbackAvatar?.trim() || '',
      isSelf: false,
      resolution: 'station',
    };
  }

  if (sessionProfile) {
    return {
      ptid: canonicalPtid,
      displayName: groupNickname
        || sessionProfile.name.trim()
        || actorDisplayName(fallbackName)
        || canonicalPtid,
      avatarUrl: sessionProfile.avatar.trim() || fallbackAvatar?.trim() || '',
      isSelf: false,
      resolution: 'session',
    };
  }

  return {
    ptid: canonicalPtid,
    displayName: groupNickname || actorDisplayName(fallbackName) || canonicalPtid,
    avatarUrl: fallbackAvatar?.trim() || '',
    isSelf: false,
    resolution: 'fallback',
  };
}

export function projectGroupAvatarSlots(
  members: readonly Pick<GroupMember, 'ptid' | 'nickname'>[],
  resolve: (ptid: string, nickname: string) => ActorIdentityProjection,
  limit = 4,
): GroupAvatarSlotProjection[] {
  return [...members]
    .filter((member) => member.ptid.trim())
    .sort((left, right) => left.ptid.localeCompare(right.ptid))
    .slice(0, limit)
    .map((member) => {
      const profile = resolve(member.ptid, member.nickname);
      return {
        ptid: profile.ptid,
        name: profile.displayName,
        avatar: profile.avatarUrl,
      };
    });
}
