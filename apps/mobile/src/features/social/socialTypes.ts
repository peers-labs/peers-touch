export { readableErrorMessage } from '../../utils/errorMessage';

export interface StationSuccessEnvelope<T> {
  code?: string;
  msg?: string;
  data?: T;
}

export interface StationErrorEnvelope {
  code?: string;
  msg?: string;
  message?: string;
  detail?: string;
}

export interface SocialTimestamp {
  seconds?: number;
  nanos?: number;
}

export interface FriendRequest {
  id?: string;
  requestId: string;
  senderId?: string;
  senderDid: string;
  receiverId?: string;
  receiverDid: string;
  status: number;
  message: string;
  createdAt?: SocialTimestamp;
  updatedAt?: SocialTimestamp;
  respondedAt?: SocialTimestamp;
  senderDisplayName: string;
  senderAvatar: string;
  receiverDisplayName: string;
  receiverAvatar: string;
}

export interface FriendChatSession {
  ulid: string;
  participantADid: string;
  participantBDid: string;
  lastMessageUlid: string;
  lastMessageAt?: SocialTimestamp;
  unreadCountA: number;
  unreadCountB: number;
  createdAt?: SocialTimestamp;
  updatedAt?: SocialTimestamp;
  participantADisplayName: string;
  participantAAvatar: string;
  participantBDisplayName: string;
  participantBAvatar: string;
  participantAOnline: boolean;
  participantBOnline: boolean;
}

export interface FriendChatMessage {
  ulid: string;
  sessionUlid: string;
  senderDid: string;
  receiverDid: string;
  type: number;
  content: string;
  status: number;
  sentAt?: SocialTimestamp;
  deliveredAt?: SocialTimestamp;
  readAt?: SocialTimestamp;
  createdAt?: SocialTimestamp;
  updatedAt?: SocialTimestamp;
  replyToUlid?: string;
  threadRootUlid?: string;
  recalled?: boolean;
  editedAt?: SocialTimestamp;
  encryptedPayload?: Uint8Array;
  attachments?: FriendMessageAttachment[];
}

export interface FriendMessageAttachment {
  cid: string;
  filename: string;
  mimeType: string;
  size: number;
  thumbnailCid?: string;
  visibility?: string;
  mediaEncryption?: unknown;
  encryptionSuite?: string;
  encryptionKeyB64?: string;
  encryptionNonceB64?: string;
  plaintextSha256B64?: string;
  ciphertextSha256B64?: string;
  plaintextSize?: number;
  ciphertextSize?: number;
}

export interface SocialNotification {
  id: string;
  recipientId: string;
  actorId: string;
  type: number;
  category: number;
  status: number;
  targetType: string;
  targetId: string;
  title: string;
  body: string;
  metadata: Record<string, string>;
  createdAt?: SocialTimestamp | string;
  readAt?: SocialTimestamp | string;
}

export interface UnreadCounts {
  total: number;
  byCategory?: Record<string, number>;
  by_category?: Record<string, number>;
}

export interface SocialConversation {
  session: FriendChatSession;
  peerDid: string;
  peerName: string;
  peerAvatar: string;
  peerOnline: boolean;
  unread: number;
  lastMessage?: FriendChatMessage;
}

export interface FriendshipStatus {
  targetDid: string;
  blocked: boolean;
}

export interface TypingEntry {
  typing: boolean;
  lastUpdate: number;
}

export interface ActorSearchResult {
  id: string;
  actorId: string;
  username: string;
  displayName: string;
  avatar: string;
  federation?: {
    handle: string;
    homeStationDomain: string;
    fromCache: boolean;
    isLocal: boolean;
    locatorSeq: number;
  };
}

export interface PeerProfileLink {
  label: string;
  url: string;
}

export interface PeerProfile {
  id: string;
  username: string;
  acct: string;
  displayName: string;
  note: string;
  url: string;
  avatar: string;
  header: string;
  locked: boolean;
  createdAt: string;
  statusesCount: number;
  followingCount: number;
  followersCount: number;
  region: string;
  timezone: string;
  tags: string[];
  links: PeerProfileLink[];
  defaultVisibility: string;
  manuallyApprovesFollowers: boolean;
  messagePermission: string;
  autoExpireDays: number;
  networkId: string;
}

export interface FederationResolveView {
  federatedHandle?: string;
  federated_handle?: string;
  homeStationDomain?: string;
  home_station_domain?: string;
  fromCache?: boolean;
  from_cache?: boolean;
  isLocal?: boolean;
  is_local?: boolean;
  locatorSeq?: number | string;
  locator_seq?: number | string;
  profile?: {
    id?: string;
    actorId?: string | number;
    actor_id?: string | number;
    username?: string;
    preferredUsername?: string;
    preferred_username?: string;
    displayName?: string;
    display_name?: string;
    avatar?: string;
  };
}

export interface SocialApiErrorContext {
  method: string;
  path: string;
  status?: number;
  code?: string;
  message: string;
}

export class SocialApiError extends Error {
  readonly context: SocialApiErrorContext;

  constructor(context: SocialApiErrorContext) {
    super(`${context.method} ${context.path}${context.status ? ` HTTP ${context.status}` : ''}: ${context.message}`);
    this.name = 'SocialApiError';
    this.context = context;
  }
}
