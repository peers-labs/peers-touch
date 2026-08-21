import type { FriendChatSession } from '../gen/proto/domain/chat/friend_chat_pb';
import type { GroupMember } from '../gen/proto/domain/chat/group_chat_pb';
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
  currentUserDid: string | null;
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

function exactSessionProfile(
  sessions: readonly FriendChatSession[],
  ptid: string,
): { name: string; avatar: string } | null {
  for (const session of sessions) {
    if (session.participantADid === ptid) {
      return {
        name: session.participantADisplayName || ptid,
        avatar: session.participantAAvatar || '',
      };
    }
    if (session.participantBDid === ptid) {
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
  currentUserDid,
  currentUserProfile,
  peerProfiles,
  sessions,
  nickname,
  fallbackName,
  fallbackAvatar,
}: ResolveActorIdentityInput): ActorIdentityProjection {
  const canonicalPtid = ptid.trim();
  const groupNickname = nickname?.trim() || '';
  const isSelf = Boolean(currentUserDid && canonicalPtid === currentUserDid);

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
