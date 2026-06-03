import type { FriendChatSession } from '../gen/proto/domain/chat/friend_chat_pb';

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
    participantAOnline: booleanValue(session.participantAOnline, record.participant_a_online),
    participantBOnline: booleanValue(session.participantBOnline, record.participant_b_online),
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

export function seedPresenceFromSessions(sessions: FriendChatSession[]): Record<string, boolean> {
  const presenceSeed: Record<string, boolean> = {};
  for (const session of sessions) {
    if (session.participantADid && presenceSeed[session.participantADid] === undefined) {
      presenceSeed[session.participantADid] = session.participantAOnline;
    }
    if (session.participantBDid && presenceSeed[session.participantBDid] === undefined) {
      presenceSeed[session.participantBDid] = session.participantBOnline;
    }
  }
  return presenceSeed;
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

function booleanValue(...values: unknown[]): boolean {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string' && value.trim()) {
      return value === 'true' || value === '1';
    }
  }
  return false;
}
