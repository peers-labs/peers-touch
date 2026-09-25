import type { FriendChatSession, GroupMember } from './socialProjection';
import type { FederationResolveView } from '../gen/proto/domain/federation/federation_resolve_pb';
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

export function remoteProfileHandle(
  profile: Pick<AccountProfile, 'acct' | 'username'>,
): string {
  for (const candidate of [profile.acct, profile.username]) {
    const value = candidate.trim();
    if (
      value.startsWith('@')
      && value.indexOf('@', 1) > 1
    ) {
      return value;
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
    peers_touch: {
      network_id: actorPtid,
    },
  };
}

function exactSessionProfile(
  sessions: readonly FriendChatSession[],
  ptid: string,
): { name: string; avatar: string } | null {
  for (const session of sessions) {
    if (session.participantAPtid === ptid) {
      return {
        name: session.participantADisplayName || ptid,
        avatar: session.participantAAvatar || '',
      };
    }
    if (session.participantBPtid === ptid) {
      return {
        name: session.participantBDisplayName || ptid,
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
  const groupNickname = nickname?.trim() || '';
  const isSelf = Boolean(currentUserPtid && canonicalPtid === currentUserPtid);

  if (isSelf) {
    const displayName = groupNickname
      || currentUserProfile?.displayName?.trim()
      || currentUserProfile?.username?.trim()
      || fallbackName?.trim()
      || canonicalPtid;
    return {
      ptid: canonicalPtid,
      displayName,
      avatarUrl: currentUserProfile?.avatar?.trim() || fallbackAvatar?.trim() || '',
      isSelf: true,
      resolution: 'self',
    };
  }

  const stationProfile = peerProfiles[canonicalPtid];
  if (stationProfile) {
    return {
      ptid: canonicalPtid,
      displayName: groupNickname
        || stationProfile.display_name?.trim()
        || stationProfile.username?.trim()
        || fallbackName?.trim()
        || canonicalPtid,
      avatarUrl: stationProfile.avatar?.trim() || fallbackAvatar?.trim() || '',
      isSelf: false,
      resolution: 'station',
    };
  }

  const sessionProfile = exactSessionProfile(sessions, canonicalPtid);
  if (sessionProfile) {
    return {
      ptid: canonicalPtid,
      displayName: groupNickname
        || sessionProfile.name.trim()
        || fallbackName?.trim()
        || canonicalPtid,
      avatarUrl: sessionProfile.avatar.trim() || fallbackAvatar?.trim() || '',
      isSelf: false,
      resolution: 'session',
    };
  }

  return {
    ptid: canonicalPtid,
    displayName: groupNickname || fallbackName?.trim() || canonicalPtid,
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
