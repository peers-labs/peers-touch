export { readableErrorMessage } from '../../utils/errorMessage';
export type { FederationResolveView } from '../../gen/proto/domain/federation/federation_resolve_pb';

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
  federationId: string;
  senderPtid: string;
  receiverPtid: string;
  senderHomeStationPeerId: string;
  receiverHomeStationPeerId: string;
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
  participantAPtid: string;
  participantBPtid: string;
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
  lastMessage?: SocialMessage;
}

export interface SocialMessage {
  ulid: string;
  eventSequence?: number;
  messagingState?: string;
  sessionUlid: string;
  senderPtid: string;
  receiverPtid: string;
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
  moderated?: boolean;
  moderationReasonCode?: string;
  reactions?: Array<{
    actorPtid: string;
    reaction: string;
    createdAtUnixMs: number;
  }>;
  pinnedByPtid?: string;
  pinnedAtUnixMs?: number;
  encryptedPayload?: Uint8Array;
  attachments?: SocialMessageAttachment[];
}

export interface SocialMessageAttachment {
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
  availabilityState?: 'remote' | 'local';
  voiceNote?: {
    durationMs: number;
    codec: string;
    waveform: number[];
  };
}

export interface SocialNotification {
  id: string;
  recipientId: string;
  actorPtid: string;
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
  peerPtid: string;
  peerName: string;
  peerAvatar: string;
  peerOnline: boolean;
  unread: number;
  lastMessage?: SocialMessage;
}

export interface FriendshipStatus {
  targetPtid: string;
  targetHomeStationPeerId?: string;
  blocked: boolean;
  following?: boolean;
  followedBy?: boolean;
  interactionAllowed?: boolean;
  deniedReason?: number;
  allowedActions?: readonly number[];
  revision?: number;
}

export interface TypingEntry {
  typing: boolean;
  lastUpdate: number;
}

export interface ActorSearchResult {
  id: string;
  ptid: string;
  homeStationPeerId: string;
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
  profileRevision: bigint;
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
  federatedHandle: string;
  homeStationPeerId: string;
  homeStationDomain: string;
  discoverability: 'hidden' | 'by_handle' | 'indexed';
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
