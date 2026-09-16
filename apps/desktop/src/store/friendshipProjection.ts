import type {
  Follower,
  Following,
} from '../gen/proto/domain/social/relationship_pb';
import type { AccountProfile } from '../services/desktop_api';
import type { DesktopIMConversationProjection } from './socialProjection';
import type { FriendRequestData } from './socialNormalizers';

export interface MutualFriendProjection {
  actorPtid: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  federatedHandle: string;
  homeStationDomain: string;
  homeStationPeerId: string;
}

export interface ChatActorIdentityProjection extends MutualFriendProjection {
  conversationId?: string;
  federationId: string;
  federationName: string;
}

export type ChatFriendContactProjection = ChatActorIdentityProjection;

export interface ChatFederationProjection {
  federationId: string;
  name: string;
}

export interface ChatActorIdentityMetadataParts {
  federation: string;
  station: string;
}

export interface ProjectChatFriendContactsInput {
  conversations: readonly DesktopIMConversationProjection[];
  friendRequests: readonly FriendRequestData[];
  peerProfiles: Readonly<Record<string, AccountProfile | null>>;
  currentUserPtid: string;
  federations: readonly ChatFederationProjection[];
}

export function singleFederationId(
  federations: readonly { federationId: string }[],
): string {
  const ids = Array.from(new Set(
    federations
      .map((federation) => federation.federationId.trim())
      .filter(Boolean),
  ));
  return ids.length === 1 ? ids[0] : '';
}

export function projectMutualFriends(
  followers: readonly Follower[],
  following: readonly Following[],
): MutualFriendProjection[] {
  const followersByPtid = new Map(
    followers
      .filter((follower) => follower.actorPtid)
      .map((follower) => [follower.actorPtid, follower] as const),
  );

  return following
    .filter((candidate) => candidate.actorPtid && followersByPtid.has(candidate.actorPtid))
    .map((candidate) => {
      const follower = followersByPtid.get(candidate.actorPtid);
      return {
        actorPtid: candidate.actorPtid,
        username: candidate.username || follower?.username || '',
        displayName: candidate.displayName || follower?.displayName || '',
        avatarUrl: candidate.avatarUrl || follower?.avatarUrl || '',
        federatedHandle: candidate.federatedHandle || follower?.federatedHandle || '',
        homeStationDomain: candidate.homeStationDomain || follower?.homeStationDomain || '',
        homeStationPeerId: candidate.homeStationPeerId || follower?.homeStationPeerId || '',
      };
    })
    .sort((left, right) => left.actorPtid.localeCompare(right.actorPtid));
}

export function projectChatFriendContacts({
  conversations,
  friendRequests,
  peerProfiles,
  currentUserPtid,
  federations,
}: ProjectChatFriendContactsInput): ChatFriendContactProjection[] {
  const conversationsByPeer = new Map(
    conversations
      .filter((conversation) => conversation.kind === 'friend' && conversation.peerPtid)
      .map((conversation) => [conversation.peerPtid as string, conversation] as const),
  );
  const acceptedRequestByPeer = new Map<string, FriendRequestData>();

  for (const request of friendRequests) {
    if (request.status !== 2) continue;
    const peerPtid = request.senderPtid === currentUserPtid
      ? request.receiverPtid
      : request.receiverPtid === currentUserPtid
        ? request.senderPtid
        : '';
    if (
      peerPtid
      && (
        !acceptedRequestByPeer.has(peerPtid)
        || friendRequestTime(request)
          >= friendRequestTime(acceptedRequestByPeer.get(peerPtid)!)
      )
    ) {
      acceptedRequestByPeer.set(peerPtid, request);
    }
  }

  const defaultFederationId = singleFederationId(federations);
  const federationNames = new Map(
    federations.map((federation) => [
      federation.federationId,
      federation.name.trim(),
    ]),
  );

  return [...acceptedRequestByPeer.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([actorPtid, request]) => {
    const conversation = conversationsByPeer.get(actorPtid);
    const profile = peerProfiles[actorPtid];
    const profileHandle = canonicalFederatedHandle(profile);
    const federatedHandle = profileHandle;
    const requestAvatar = request.senderPtid === actorPtid
      ? request.senderAvatar
      : request.receiverAvatar;
    const requestDisplayName = request.senderPtid === actorPtid
      ? request.senderDisplayName
      : request.receiverDisplayName;
    const homeStationDomain = homeStationDomainFromHandle(profileHandle)
      || homeStationDomainFromHandle(federatedHandle);
    const homeStationPeerId = request.senderPtid === actorPtid
      ? request.senderHomeStationPeerId
      : request.receiverHomeStationPeerId;
    const federationId = conversation?.federationId
      || request.federationId
      || defaultFederationId;
    const username = profile?.username?.trim()
      || localPartFromHandle(federatedHandle);

    return {
      actorPtid,
      ...(conversation ? { conversationId: conversation.id } : {}),
      username,
      displayName: profile?.display_name?.trim()
        || requestDisplayName
        || username
        || conversation?.title
        || actorPtid,
      avatarUrl: profile?.avatar?.trim()
        || requestAvatar
        || conversation?.avatar
        || '',
      federatedHandle,
      homeStationDomain,
      homeStationPeerId,
      federationId,
      federationName: federationNames.get(federationId) || '',
    };
  });
}

function friendRequestTime(request: FriendRequestData): number {
  return Date.parse(request.respondedAt || request.createdAt) || 0;
}

function localPartFromHandle(handle: string): string {
  const value = handle.trim().replace(/^@/, '');
  const separator = value.indexOf('@');
  return separator >= 0 ? value.slice(0, separator) : value;
}

export function chatActorIdentityMetadata(
  identity: Pick<
    ChatActorIdentityProjection,
    | 'federatedHandle'
    | 'actorPtid'
    | 'homeStationDomain'
    | 'homeStationPeerId'
    | 'federationId'
    | 'federationName'
  >,
): string {
  const { federation, station } = chatActorIdentityMetadataParts(identity);
  return [federation, station].filter(Boolean).join(' · ')
    || identity.actorPtid;
}

export function chatActorIdentityMetadataParts(
  identity: Pick<
    ChatActorIdentityProjection,
    | 'federatedHandle'
    | 'homeStationDomain'
    | 'homeStationPeerId'
    | 'federationId'
    | 'federationName'
  >,
): ChatActorIdentityMetadataParts {
  const federation = identity.federationName.trim()
    || identity.federationId.trim();
  const station = identity.homeStationDomain.trim()
    || homeStationDomainFromHandle(identity.federatedHandle)
    || identity.federatedHandle.trim()
    || identity.homeStationPeerId.trim();
  return { federation, station };
}

function canonicalFederatedHandle(profile: AccountProfile | null | undefined): string {
  if (!profile) return '';
  for (const candidate of [profile.acct, profile.username]) {
    const value = candidate.trim();
    if (value.startsWith('@') && value.indexOf('@', 1) > 1) {
      return value;
    }
  }
  return '';
}

function homeStationDomainFromHandle(handle: string): string {
  const value = handle.trim().replace(/^@/, '');
  const separator = value.indexOf('@');
  return separator >= 0 ? value.slice(separator + 1) : '';
}
