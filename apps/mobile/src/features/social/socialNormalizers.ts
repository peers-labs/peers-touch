import type {
  ActorSearchResult,
  FederationResolveView,
  FriendChatMessage,
  FriendChatSession,
  FriendRequest,
  PeerProfile,
  PeerProfileLink,
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
  return {
    ...raw,
    requestId: String(raw.requestId ?? raw.id ?? record.request_id ?? ''),
    senderDid: String(raw.senderDid ?? raw.senderId ?? record.sender_did ?? record.sender_id ?? ''),
    receiverDid: String(raw.receiverDid ?? raw.receiverId ?? record.receiver_did ?? record.receiver_id ?? ''),
    status: normalizeFriendRequestStatus(raw.status),
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
    participantADid: String(raw.participantADid ?? record.participant_a_did ?? ''),
    participantBDid: String(raw.participantBDid ?? record.participant_b_did ?? ''),
    lastMessageUlid: String(raw.lastMessageUlid ?? record.last_message_ulid ?? ''),
    unreadCountA: Number(raw.unreadCountA ?? record.unread_count_a ?? 0),
    unreadCountB: Number(raw.unreadCountB ?? record.unread_count_b ?? 0),
    participantADisplayName: String(raw.participantADisplayName ?? record.participant_a_display_name ?? ''),
    participantAAvatar: String(raw.participantAAvatar ?? record.participant_a_avatar ?? ''),
    participantBDisplayName: String(raw.participantBDisplayName ?? record.participant_b_display_name ?? ''),
    participantBAvatar: String(raw.participantBAvatar ?? record.participant_b_avatar ?? ''),
    participantAOnline: Boolean(raw.participantAOnline ?? record.participant_a_online ?? false),
    participantBOnline: Boolean(raw.participantBOnline ?? record.participant_b_online ?? false),
  };
}

export function normalizeMessage(raw: Partial<FriendChatMessage>): FriendChatMessage {
  const record = raw as Record<string, unknown>;
  return {
    ...raw,
    ulid: String(raw.ulid ?? ''),
    sessionUlid: String(raw.sessionUlid ?? record.session_ulid ?? ''),
    senderDid: String(raw.senderDid ?? record.sender_did ?? ''),
    receiverDid: String(raw.receiverDid ?? record.receiver_did ?? ''),
    type: Number(raw.type ?? 0),
    content: String(raw.content ?? ''),
    status: Number(raw.status ?? 0),
    replyToUlid: String(raw.replyToUlid ?? record.reply_to_ulid ?? ''),
    threadRootUlid: String(raw.threadRootUlid ?? record.thread_root_ulid ?? ''),
    recalled: Boolean(raw.recalled ?? false),
    editedAt: (raw.editedAt ?? record.edited_at) as FriendChatMessage['editedAt'],
    encryptedPayload: raw.encryptedPayload,
  };
}

export function normalizeNotification(raw: Partial<SocialNotification>): SocialNotification {
  const record = raw as Record<string, unknown>;
  return {
    ...raw,
    id: String(raw.id ?? ''),
    recipientId: String(raw.recipientId ?? record.recipient_id ?? ''),
    actorId: String(raw.actorId ?? record.actor_id ?? ''),
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

export function normalizeActorSearchResult(raw: Partial<ActorSearchResult>): ActorSearchResult {
  const record = raw as Record<string, unknown>;
  const stableId = String(raw.id ?? raw.actorId ?? record.actor_id ?? '');
  return {
    id: stableId,
    actorId: stableId,
    username: String(raw.username ?? ''),
    displayName: String(raw.displayName ?? record.display_name ?? ''),
    avatar: String(raw.avatar ?? ''),
  };
}

export function federationViewToResult(view: FederationResolveView): ActorSearchResult | null {
  const profile = view.profile;
  if (!profile) return null;
  const record = profile as Record<string, unknown>;
  const id = String(profile.id ?? profile.actorId ?? profile.actor_id ?? '');
  const username = String(profile.username ?? profile.preferredUsername ?? profile.preferred_username ?? '');
  const displayName = String(profile.displayName ?? profile.display_name ?? username);
  const avatar = String(profile.avatar ?? '');
  const federationRecord = view as Record<string, unknown>;
  return {
    id,
    actorId: id,
    username,
    displayName,
    avatar,
    federation: {
      handle: String(view.federatedHandle ?? view.federated_handle ?? ''),
      homeStationDomain: String(view.homeStationDomain ?? view.home_station_domain ?? ''),
      fromCache: Boolean(view.fromCache ?? view.from_cache ?? false),
      isLocal: Boolean(view.isLocal ?? view.is_local ?? false),
      locatorSeq: Number(view.locatorSeq ?? view.locator_seq ?? federationRecord.locatorSeq ?? 0),
    },
  };
}

export function normalizePeerProfile(raw: Partial<PeerProfile>): PeerProfile {
  const record = raw as Record<string, unknown>;
  const peersTouch = record.peers_touch as Record<string, unknown> | undefined;
  return {
    id: String(raw.id ?? ''),
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

function normalizeMetadata(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((next, [key, entry]) => {
    next[key] = String(entry ?? '');
    return next;
  }, {});
}
