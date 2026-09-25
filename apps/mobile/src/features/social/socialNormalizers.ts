import type {
  Actor,
  ActorProfile,
} from '../../gen/proto/domain/actor/actor_pb';
import type {
  ActorSearchResult,
  FederationResolveView,
  FriendChatSession,
  FriendRequest,
  PeerProfile,
  PeerProfileLink,
  SocialMessage,
  SocialNotification,
  SocialTimestamp,
  UnreadCounts,
} from './socialTypes';

const FRIEND_REQUEST_STATUS_PENDING = 1;
const FRIEND_REQUEST_STATUS_ACCEPTED = 2;
const FRIEND_REQUEST_STATUS_REJECTED = 3;
const NOTIFICATION_STATUS_UNREAD = 1;
const NOTIFICATION_TYPE_FRIEND_REQUEST = 200;
const NOTIFICATION_TYPE_FRIEND_ACCEPTED = 201;
const NOTIFICATION_TYPE_FRIEND_MESSAGE = 202;

type FederationResolveInput =
  Partial<Omit<FederationResolveView, 'profile'>>
  & {
    profile?: Partial<
      Pick<ActorProfile, 'avatar' | 'displayName' | 'id' | 'username'>
    > & {
      ref?: { ptid?: string };
    };
  };

export function timestampMillis(timestamp?: SocialTimestamp | string): number {
  if (!timestamp) return 0;
  if (typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof timestamp.seconds === 'number') return timestamp.seconds * 1000 + Math.floor((timestamp.nanos ?? 0) / 1000000);
  return 0;
}

export function normalizeFriendRequest(raw: Partial<FriendRequest>): FriendRequest {
  const record = raw as Record<string, unknown>;
  const sender = (record.sender ?? {}) as Record<string, unknown>;
  const receiver = (record.receiver ?? {}) as Record<string, unknown>;
  return {
    ...raw,
    requestId: String(raw.requestId ?? raw.id ?? record.request_id ?? ''),
    federationId: String(raw.federationId ?? record.federation_id ?? ''),
    senderPtid: String(sender.ptid ?? record.sender_ptid ?? raw.senderPtid ?? ''),
    receiverPtid: String(receiver.ptid ?? record.receiver_ptid ?? raw.receiverPtid ?? ''),
    senderHomeStationPeerId: String(
      raw.senderHomeStationPeerId ?? record.sender_home_station_peer_id ?? '',
    ),
    receiverHomeStationPeerId: String(
      raw.receiverHomeStationPeerId ?? record.receiver_home_station_peer_id ?? '',
    ),
    status: normalizeFriendRequestStatus(record.state ?? raw.status),
    message: String(raw.message ?? ''),
    senderDisplayName: String(raw.senderDisplayName ?? record.sender_display_name ?? ''),
    senderAvatar: String(raw.senderAvatar ?? record.sender_avatar ?? ''),
    receiverDisplayName: String(raw.receiverDisplayName ?? record.receiver_display_name ?? ''),
    receiverAvatar: String(raw.receiverAvatar ?? record.receiver_avatar ?? ''),
  };
}

export function normalizeSession(raw: Partial<FriendChatSession>): FriendChatSession {
  const record = raw as Record<string, unknown>;
  return {
    ...raw,
    ulid: String(raw.ulid ?? ''),
    participantAPtid: String(raw.participantAPtid ?? record.participant_a_ptid ?? ''),
    participantBPtid: String(raw.participantBPtid ?? record.participant_b_ptid ?? ''),
    lastMessageUlid: String(raw.lastMessageUlid ?? record.last_message_ulid ?? ''),
    unreadCountA: Number(raw.unreadCountA ?? record.unread_count_a ?? 0),
    unreadCountB: Number(raw.unreadCountB ?? record.unread_count_b ?? 0),
    participantADisplayName: String(raw.participantADisplayName ?? record.participant_a_display_name ?? ''),
    participantAAvatar: String(raw.participantAAvatar ?? record.participant_a_avatar ?? ''),
    participantBDisplayName: String(raw.participantBDisplayName ?? record.participant_b_display_name ?? ''),
    participantBAvatar: String(raw.participantBAvatar ?? record.participant_b_avatar ?? ''),
    participantAOnline: Boolean(raw.participantAOnline ?? record.participant_a_online ?? false),
    participantBOnline: Boolean(raw.participantBOnline ?? record.participant_b_online ?? false),
    lastMessage: raw.lastMessage
      ? normalizeMessage(raw.lastMessage)
      : record.last_message
        ? normalizeMessage(record.last_message as Partial<SocialMessage>)
        : undefined,
  };
}

export function normalizeMessage(raw: Partial<SocialMessage>): SocialMessage {
  const record = raw as Record<string, unknown>;
  return {
    ...raw,
    ulid: String(raw.ulid ?? ''),
    sessionUlid: String(raw.sessionUlid ?? record.session_ulid ?? ''),
    senderPtid: String(raw.senderPtid ?? record.sender_ptid ?? ''),
    receiverPtid: String(raw.receiverPtid ?? record.receiver_ptid ?? ''),
    type: Number(raw.type ?? 0),
    content: String(raw.content ?? ''),
    status: Number(raw.status ?? 0),
    replyToUlid: String(raw.replyToUlid ?? record.reply_to_ulid ?? ''),
    threadRootUlid: String(raw.threadRootUlid ?? record.thread_root_ulid ?? ''),
    recalled: Boolean(raw.recalled ?? false),
    editedAt: (raw.editedAt ?? record.edited_at) as SocialMessage['editedAt'],
    encryptedPayload: bytesValue(raw.encryptedPayload ?? record.encryptedPayload ?? record.encrypted_payload),
    attachments: normalizeMessageAttachments(raw.attachments ?? record.attachments),
  };
}

function normalizeMessageAttachments(value: unknown): SocialMessage['attachments'] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    return {
      cid: String(record.cid ?? ''),
      filename: String(record.filename ?? ''),
      mimeType: String(record.mimeType ?? record.mime_type ?? ''),
      size: Number(record.size ?? 0),
      thumbnailCid: String(record.thumbnailCid ?? record.thumbnail_cid ?? ''),
      visibility: String(record.visibility ?? ''),
      mediaEncryption: record.mediaEncryption ?? record.media_encryption,
      encryptionSuite: String(record.encryptionSuite ?? record.encryption_suite ?? ''),
      encryptionKeyB64: String(record.encryptionKeyB64 ?? record.encryption_key_b64 ?? ''),
      encryptionNonceB64: String(record.encryptionNonceB64 ?? record.encryption_nonce_b64 ?? ''),
      plaintextSha256B64: String(record.plaintextSha256B64 ?? record.plaintext_sha256_b64 ?? ''),
      ciphertextSha256B64: String(record.ciphertextSha256B64 ?? record.ciphertext_sha256_b64 ?? ''),
      plaintextSize: Number(record.plaintextSize ?? record.plaintext_size ?? 0),
      ciphertextSize: Number(record.ciphertextSize ?? record.ciphertext_size ?? 0),
    };
  }).filter((attachment) => attachment.cid || attachment.filename);
}

export function normalizeNotification(raw: Partial<SocialNotification>): SocialNotification {
  const record = raw as Record<string, unknown>;
  return {
    ...raw,
    id: String(raw.id ?? ''),
    recipientId: String(raw.recipientId ?? record.recipient_id ?? ''),
    actorPtid: String(raw.actorPtid ?? record.actor_ptid ?? ''),
    type: normalizeNotificationType(raw.type),
    category: normalizeNumberEnum(raw.category),
    status: normalizeNotificationStatus(raw.status),
    targetType: String(raw.targetType ?? record.target_type ?? ''),
    targetId: String(raw.targetId ?? record.target_id ?? ''),
    title: String(raw.title ?? ''),
    body: String(raw.body ?? ''),
    metadata: normalizeMetadata(raw.metadata ?? record.metadata),
    createdAt: (raw.createdAt ?? record.created_at) as SocialNotification['createdAt'],
    readAt: (raw.readAt ?? record.read_at) as SocialNotification['readAt'],
  };
}

export function normalizeUnreadCounts(raw: UnreadCounts): UnreadCounts {
  return {
    total: Number(raw.total ?? 0),
    byCategory: raw.byCategory ?? raw.by_category ?? {},
  };
}

export function normalizeActorSearchResult(raw: Actor): ActorSearchResult {
  const ptid = raw.ref?.ptid ?? '';
  return {
    id: ptid,
    ptid,
    homeStationPeerId: raw.homeStationPeerId,
    username: raw.username,
    displayName: raw.displayName,
    avatar: raw.avatar,
  };
}

export function federationViewToResult(view: FederationResolveInput): ActorSearchResult | null {
  const profile = view.profile;
  if (!profile) return null;
  const id = profile.ref?.ptid ?? '';
  return {
    id,
    ptid: id,
    homeStationPeerId: view.homeStationPeerId ?? '',
    username: profile.username ?? '',
    displayName: profile.displayName || profile.username || '',
    avatar: profile.avatar ?? '',
    federation: {
      handle: view.federatedHandle ?? '',
      homeStationDomain: view.homeStationDomain ?? '',
      fromCache: view.fromCache ?? false,
      isLocal: view.isLocal ?? false,
      locatorSeq: Number(view.locatorSeq ?? 0n),
    },
  };
}

export function normalizePeerProfile(raw: Partial<PeerProfile>): PeerProfile {
  const record = raw as Record<string, unknown>;
  const peersTouch = record.peers_touch as Record<string, unknown> | undefined;
  return {
    id: String(raw.id ?? ''),
    profileRevision: normalizePositiveRevision(
      raw.profileRevision ?? record.profile_revision,
    ),
    username: String(raw.username ?? ''),
    acct: String(raw.acct ?? ''),
    displayName: String(raw.displayName ?? record.display_name ?? raw.username ?? ''),
    note: String(raw.note ?? ''),
    url: String(raw.url ?? ''),
    avatar: String(raw.avatar ?? ''),
    header: String(raw.header ?? ''),
    locked: Boolean(raw.locked ?? false),
    createdAt: String(raw.createdAt ?? record.created_at ?? ''),
    statusesCount: Number(raw.statusesCount ?? record.statuses_count ?? 0),
    followingCount: Number(raw.followingCount ?? record.following_count ?? 0),
    followersCount: Number(raw.followersCount ?? record.followers_count ?? 0),
    region: String(raw.region ?? ''),
    timezone: String(raw.timezone ?? ''),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    links: normalizeProfileLinks(raw.links ?? record.links),
    defaultVisibility: String(raw.defaultVisibility ?? record.default_visibility ?? ''),
    manuallyApprovesFollowers: Boolean(raw.manuallyApprovesFollowers ?? record.manually_approves_followers ?? false),
    messagePermission: String(raw.messagePermission ?? record.message_permission ?? ''),
    autoExpireDays: Number(raw.autoExpireDays ?? record.auto_expire_days ?? 0),
    networkId: String(raw.networkId ?? peersTouch?.network_id ?? ''),
  };
}

function normalizePositiveRevision(value: unknown): bigint {
  try {
    const revision = BigInt(value as string | number | bigint);
    return revision > 0n ? revision : 0n;
  } catch {
    return 0n;
  }
}

function normalizeFriendRequestStatus(status: unknown): number {
  if (typeof status === 'number') return status;
  if (typeof status === 'string') {
    if (/^\d+$/.test(status)) return Number(status);
    if (status.endsWith('PENDING')) return FRIEND_REQUEST_STATUS_PENDING;
    if (status.endsWith('ACCEPTED')) return FRIEND_REQUEST_STATUS_ACCEPTED;
    if (status.endsWith('REJECTED')) return FRIEND_REQUEST_STATUS_REJECTED;
  }
  return 0;
}

function normalizeProfileLinks(value: unknown): PeerProfileLink[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = item as Record<string, unknown>;
    return {
      label: String(record.label ?? ''),
      url: String(record.url ?? ''),
    };
  });
}

function normalizeNotificationType(type: unknown): number {
  if (typeof type === 'number') return type;
  if (typeof type === 'string') {
    if (/^\d+$/.test(type)) return Number(type);
    if (type.endsWith('FRIEND_REQUEST')) return NOTIFICATION_TYPE_FRIEND_REQUEST;
    if (type.endsWith('FRIEND_ACCEPTED')) return NOTIFICATION_TYPE_FRIEND_ACCEPTED;
    if (type.endsWith('FRIEND_MESSAGE')) return NOTIFICATION_TYPE_FRIEND_MESSAGE;
  }
  return 0;
}

function normalizeNotificationStatus(status: unknown): number {
  if (typeof status === 'number') return status;
  if (typeof status === 'string') {
    if (/^\d+$/.test(status)) return Number(status);
    if (status.endsWith('UNREAD')) return NOTIFICATION_STATUS_UNREAD;
    if (status.endsWith('READ')) return 2;
    if (status.endsWith('ARCHIVED')) return 3;
  }
  return 0;
}

function normalizeNumberEnum(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (/^\d+$/.test(value)) return Number(value);
    if (value.endsWith('SOCIAL')) return 1;
    if (value.endsWith('CHAT')) return 2;
    if (value.endsWith('SYSTEM')) return 3;
    if (value.endsWith('TASK')) return 4;
  }
  return 0;
}

function bytesValue(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return new Uint8Array(value.map(Number));
  if (typeof value === 'string' && value.trim()) return base64ToBytes(value.trim());
  return new Uint8Array();
}

function base64ToBytes(value: string): Uint8Array {
  try {
    const binary = globalThis.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return new Uint8Array();
  }
}

function normalizeMetadata(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((next, [key, entry]) => {
    next[key] = String(entry ?? '');
    return next;
  }, {});
}
