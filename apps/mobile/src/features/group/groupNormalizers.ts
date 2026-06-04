import type { Timestamp } from '@bufbuild/protobuf/wkt';

import type { Group, GroupMember, GroupMessage } from '../../gen/proto/domain/chat/group_chat_pb';

type RawRecord = Record<string, unknown>;

export function normalizeGroup(raw: Partial<Group>): Group {
  const record = raw as RawRecord;
  return {
    ...raw,
    ulid: stringValue(raw.ulid),
    name: stringValue(raw.name),
    description: stringValue(raw.description),
    avatarCid: stringValue(raw.avatarCid, record.avatar_cid),
    ownerDid: stringValue(raw.ownerDid, record.owner_did),
    type: numberValue(raw.type),
    visibility: numberValue(raw.visibility),
    memberCount: numberValue(raw.memberCount, record.member_count),
    maxMembers: numberValue(raw.maxMembers, record.max_members),
    muted: booleanValue(raw.muted),
    settings: normalizeStringMap(raw.settings ?? record.settings),
    createdAt: (raw.createdAt ?? record.created_at) as Timestamp | undefined,
    updatedAt: (raw.updatedAt ?? record.updated_at) as Timestamp | undefined,
  } as Group;
}

export function normalizeGroupMember(raw: Partial<GroupMember>): GroupMember {
  const record = raw as RawRecord;
  return {
    ...raw,
    groupUlid: stringValue(raw.groupUlid, record.group_ulid),
    actorDid: stringValue(raw.actorDid, record.actor_did),
    role: numberValue(raw.role),
    nickname: stringValue(raw.nickname),
    muted: booleanValue(raw.muted),
    mutedUntil: (raw.mutedUntil ?? record.muted_until) as Timestamp | undefined,
    joinedAt: (raw.joinedAt ?? record.joined_at) as Timestamp | undefined,
    invitedBy: stringValue(raw.invitedBy, record.invited_by),
  } as GroupMember;
}

export function normalizeGroupMessage(raw: Partial<GroupMessage>): GroupMessage {
  const record = raw as RawRecord;
  return {
    ...raw,
    ulid: stringValue(raw.ulid),
    groupUlid: stringValue(raw.groupUlid, record.group_ulid),
    senderDid: stringValue(raw.senderDid, record.sender_did),
    type: numberValue(raw.type),
    content: stringValue(raw.content),
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
    replyToUlid: stringValue(raw.replyToUlid, record.reply_to_ulid),
    threadRootUlid: stringValue(raw.threadRootUlid, record.thread_root_ulid),
    mentionedDids: Array.isArray(raw.mentionedDids) ? raw.mentionedDids.map(String) : [],
    mentionAll: booleanValue(raw.mentionAll, record.mention_all),
    sentAt: (raw.sentAt ?? record.sent_at) as Timestamp | undefined,
    createdAt: (raw.createdAt ?? record.created_at) as Timestamp | undefined,
    updatedAt: (raw.updatedAt ?? record.updated_at) as Timestamp | undefined,
    recalled: booleanValue(raw.recalled),
    encryptedPayload: bytesValue(raw.encryptedPayload ?? record.encryptedPayload ?? record.encrypted_payload),
    editedAt: (raw.editedAt ?? record.edited_at) as Timestamp | undefined,
  } as GroupMessage;
}

export function timestampMillis(timestamp?: Timestamp | string): number {
  if (!timestamp) return 0;
  if (typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  const seconds = typeof timestamp.seconds === 'bigint' ? Number(timestamp.seconds) : Number(timestamp.seconds ?? 0);
  return seconds * 1000 + Math.floor(Number(timestamp.nanos ?? 0) / 1_000_000);
}

function stringValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  }
  return '';
}

function numberValue(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function booleanValue(...values: unknown[]): boolean {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string' && value.trim()) return value === 'true' || value === '1';
  }
  return false;
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

function normalizeStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  return Object.entries(value as RawRecord).reduce<Record<string, string>>((next, [key, entry]) => {
    next[key] = String(entry ?? '');
    return next;
  }, {});
}
