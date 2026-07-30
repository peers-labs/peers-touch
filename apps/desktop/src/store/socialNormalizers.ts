import type { FriendChatSession } from '../gen/proto/domain/chat/friend_chat_pb';
import type { Conversation, ConversationMember } from '../gen/proto/domain/chat/conversation_pb';
import { ConversationKind, ConversationStatus, MemberRole, MemberStatus } from '../gen/proto/domain/chat/conversation_pb';
import type { Timestamp } from '@bufbuild/protobuf/wkt';

export interface FriendRequestData {
  id: string;
  senderId: string;
  receiverId: string;
  status: number;
  message: string;
  createdAt: string;
  respondedAt: string;
  senderDisplayName: string;
  senderAvatar: string;
  receiverDisplayName: string;
  receiverAvatar: string;
}

type RawRecord = Record<string, unknown>;

export function normalizeFriendChatSession(raw: unknown): FriendChatSession {
  const record = recordFromUnknown(raw);
  const session = record as Partial<FriendChatSession>;
  return {
    ...(session as FriendChatSession),
    participantADid: stringValue(session.participantADid, record.participant_a_did),
    participantBDid: stringValue(session.participantBDid, record.participant_b_did),
    participantADisplayName: stringValue(session.participantADisplayName, record.participant_a_display_name),
    participantAAvatar: stringValue(session.participantAAvatar, record.participant_a_avatar),
    participantBDisplayName: stringValue(session.participantBDisplayName, record.participant_b_display_name),
    participantBAvatar: stringValue(session.participantBAvatar, record.participant_b_avatar),
  };
}

export function normalizeFriendRequests(raw: unknown): FriendRequestData[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeFriendRequestData);
}

export function normalizeFriendRequestData(raw: unknown): FriendRequestData {
  const record = recordFromUnknown(raw);
  return {
    id: stringValue(record.id, record.Id),
    senderId: stringValue(record.senderId, record.sender_id, record.senderDid, record.sender_did),
    receiverId: stringValue(record.receiverId, record.receiver_id, record.receiverDid, record.receiver_did),
    status: numberValue(record.status),
    message: stringValue(record.message),
    createdAt: stringValue(record.createdAt, record.created_at),
    respondedAt: stringValue(record.respondedAt, record.responded_at),
    senderDisplayName: stringValue(record.senderDisplayName, record.sender_display_name),
    senderAvatar: stringValue(record.senderAvatar, record.sender_avatar),
    receiverDisplayName: stringValue(record.receiverDisplayName, record.receiver_display_name),
    receiverAvatar: stringValue(record.receiverAvatar, record.receiver_avatar),
  };
}

function recordFromUnknown(value: unknown): RawRecord {
  return value && typeof value === 'object' ? value as RawRecord : {};
}

function stringValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  }
  return '';
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

const CONVERSATION_KIND_MAP: Record<string, number> = {
  CONVERSATION_KIND_UNSPECIFIED: ConversationKind.UNSPECIFIED,
  CONVERSATION_KIND_DIRECT: ConversationKind.DIRECT,
  CONVERSATION_KIND_GROUP: ConversationKind.GROUP,
};

const CONVERSATION_STATUS_MAP: Record<string, number> = {
  CONVERSATION_STATUS_UNSPECIFIED: ConversationStatus.UNSPECIFIED,
  CONVERSATION_STATUS_ACTIVE: ConversationStatus.ACTIVE,
  CONVERSATION_STATUS_DISSOLVED: ConversationStatus.DISSOLVED,
  CONVERSATION_STATUS_DEGRADED_READ_ONLY: ConversationStatus.DEGRADED_READ_ONLY,
  CONVERSATION_STATUS_ORPHANED_READ_ONLY: ConversationStatus.ORPHANED_READ_ONLY,
};

const MEMBER_ROLE_MAP: Record<string, number> = {
  MEMBER_ROLE_UNSPECIFIED: MemberRole.UNSPECIFIED,
  MEMBER_ROLE_MEMBER: MemberRole.MEMBER,
  MEMBER_ROLE_ADMIN: MemberRole.ADMIN,
  MEMBER_ROLE_OWNER: MemberRole.OWNER,
};

const MEMBER_STATUS_MAP: Record<string, number> = {
  MEMBER_STATUS_UNSPECIFIED: MemberStatus.UNSPECIFIED,
  MEMBER_STATUS_ACTIVE: MemberStatus.ACTIVE,
  MEMBER_STATUS_LEFT: MemberStatus.LEFT,
  MEMBER_STATUS_REMOVED: MemberStatus.REMOVED,
};

function enumValue(value: unknown, map: Record<string, number>): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return map[value] ?? 0;
  return 0;
}

function normalizeTimestamp(value: unknown): Timestamp | undefined {
  if (!value) return undefined;
  if (typeof value === 'object' && value !== null && 'seconds' in value) {
    return value as Timestamp;
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) {
      return { seconds: BigInt(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1_000_000, $typeName: 'google.protobuf.Timestamp' } as Timestamp;
    }
  }
  return undefined;
}

export function normalizeConversation(raw: unknown): Conversation {
  const r = recordFromUnknown(raw);
  return {
    $typeName: 'peers_touch.model.chat.v1.Conversation',
    conversationId: stringValue(r.conversationId, r.conversation_id),
    kind: enumValue(r.kind, CONVERSATION_KIND_MAP) as ConversationKind,
    authorityStationPeerId: stringValue(r.authorityStationPeerId, r.authority_station_peer_id),
    membershipEpoch: BigInt(numberValue(r.membershipEpoch ?? r.membership_epoch)),
    status: enumValue(r.status, CONVERSATION_STATUS_MAP) as ConversationStatus,
    createdAt: normalizeTimestamp(r.createdAt ?? r.created_at),
    updatedAt: normalizeTimestamp(r.updatedAt ?? r.updated_at),
    name: stringValue(r.name),
    maxMembers: numberValue(r.maxMembers ?? r.max_members),
  } as Conversation;
}

export function normalizeConversations(raw: unknown): Conversation[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeConversation);
}

export function normalizeConversationMember(raw: unknown): ConversationMember {
  const r = recordFromUnknown(raw);
  return {
    $typeName: 'peers_touch.model.chat.v1.ConversationMember',
    conversationId: stringValue(r.conversationId, r.conversation_id),
    ptid: stringValue(r.ptid),
    role: enumValue(r.role, MEMBER_ROLE_MAP) as MemberRole,
    memberStatus: enumValue(r.memberStatus ?? r.member_status, MEMBER_STATUS_MAP) as MemberStatus,
    actorHomeStationPeerId: stringValue(r.actorHomeStationPeerId, r.actor_home_station_peer_id),
    actorHomeStationDomain: stringValue(r.actorHomeStationDomain, r.actor_home_station_domain),
    nickname: stringValue(r.nickname),
    muted: Boolean(r.muted),
    joinedAt: normalizeTimestamp(r.joinedAt ?? r.joined_at),
  } as ConversationMember;
}

export function normalizeConversationMembers(raw: unknown): ConversationMember[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeConversationMember);
}
