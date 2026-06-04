import { fromBinary } from '@bufbuild/protobuf';
import type { Timestamp } from '@bufbuild/protobuf/wkt';
import { GroupMessageSchema } from '../../gen/proto/domain/chat/group_chat_pb';
import type { GroupMessage } from '../../gen/proto/domain/chat/group_chat_pb';
import { FriendChatMessageSchema } from '../../gen/proto/domain/chat/friend_chat_pb';
import type { FriendChatMessage as ProtoFriendChatMessage } from '../../gen/proto/domain/chat/friend_chat_pb';
import {
  ConversationSettingsChanged_Kind,
  GroupMembershipChange_Kind,
  MessageMutation_Kind,
  StreamEventSchema,
} from '../../gen/proto/domain/realtime/event_pb';
import type { MessageMutationKind } from './socialProjection';
import type { FriendChatMessage, SocialTimestamp } from './socialTypes';

export type RealtimeWireEvent =
  | { kind: 'message'; sessionUlid: string; message: FriendChatMessage }
  | { kind: 'group-message'; groupUlid: string; message: GroupMessage }
  | { kind: 'receipt'; sessionUlid: string; messageUlid: string; receiptKind: number }
  | {
    kind: 'mutation';
    sessionUlid: string;
    messageUlid: string;
    mutationKind: MessageMutationKind;
    newContent: string;
    newCiphertext: Uint8Array<ArrayBufferLike>;
    mutatedTsUnixMs: number;
  }
  | { kind: 'typing'; sessionUlid: string; fromActorId: string; typing: boolean }
  | { kind: 'presence'; actorId: string; online: boolean }
  | { kind: 'group-membership'; groupUlid: string; actorDid: string; membershipKind: GroupMembershipKind }
  | { kind: 'settings-changed'; conversationKind: 'friend' | 'group'; containerUlid: string }
  | { kind: 'resync' };

export function decodeRealtimeSseChunk(chunk: string): RealtimeWireEvent[] {
  return parseSseData(chunk).map((encoded) => {
    try {
      return decodeRealtimeEvent(base64ToBytes(encoded)) ?? { kind: 'resync' };
    } catch {
      return { kind: 'resync' };
    }
  });
}

function decodeRealtimeEvent(bytes: Uint8Array): RealtimeWireEvent | null {
  const event = fromBinary(StreamEventSchema, bytes);
  const frame = event.kind;

  if (frame.case === 'message') {
    const message = decodeRealtimeMessage(frame.value.sessionUlid, frame.value.ciphertext);
    if (!message) return null;
    return message.kind === 'group'
      ? { kind: 'group-message', groupUlid: message.message.groupUlid || frame.value.sessionUlid, message: message.message }
      : { kind: 'message', sessionUlid: frame.value.sessionUlid, message: message.message };
  }
  if (frame.case === 'receipt') {
    return {
      kind: 'receipt',
      sessionUlid: frame.value.sessionUlid,
      messageUlid: frame.value.ulid,
      receiptKind: frame.value.kind,
    };
  }
  if (frame.case === 'mutation') {
    const mutationKind = mutationKindFromEnum(frame.value.kind);
    if (!mutationKind) return null;
    return {
      kind: 'mutation',
      sessionUlid: frame.value.sessionUlid,
      messageUlid: frame.value.ulid,
      mutationKind,
      newContent: frame.value.newContent,
      newCiphertext: copyBytes(frame.value.newCiphertext),
      mutatedTsUnixMs: Number(frame.value.mutatedTsUnixMs),
    };
  }
  if (frame.case === 'typing') {
    return {
      kind: 'typing',
      sessionUlid: frame.value.sessionUlid,
      fromActorId: frame.value.fromActorId,
      typing: frame.value.typing,
    };
  }
  if (frame.case === 'presence') {
    return { kind: 'presence', actorId: frame.value.actorId, online: frame.value.online };
  }
  if (frame.case === 'groupMembershipChange') {
    const membershipKind = groupMembershipKindFromEnum(frame.value.kind);
    if (!membershipKind) return null;
    return {
      kind: 'group-membership',
      groupUlid: frame.value.groupUlid,
      actorDid: frame.value.actorDid,
      membershipKind,
    };
  }
  if (frame.case === 'conversationSettingsChanged') {
    const conversationKind = conversationSettingsKindFromEnum(frame.value.kind);
    if (!conversationKind || !frame.value.containerUlid) return null;
    return {
      kind: 'settings-changed',
      conversationKind,
      containerUlid: frame.value.containerUlid,
    };
  }
  if (frame.case === 'resync') return { kind: 'resync' };
  return null;
}

function parseSseData(chunk: string): string[] {
  const dataLines = chunk
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  return dataLines.length > 0 ? [dataLines.join('')] : [];
}

function decodeFriendChatMessage(bytes: Uint8Array): FriendChatMessage | null {
  const message = fromBinary(FriendChatMessageSchema, bytes);
  if (!message.ulid || !message.receiverDid) return null;
  return adaptFriendChatMessage(message);
}

function decodeRealtimeMessage(
  sessionUlid: string,
  bytes: Uint8Array,
): { kind: 'friend'; message: FriendChatMessage } | { kind: 'group'; message: GroupMessage } | null {
  try {
    const friendMessage = decodeFriendChatMessage(bytes);
    if (friendMessage) return { kind: 'friend', message: friendMessage };
  } catch {
    // Try group payload below; both arms use generated proto decoders.
  }

  try {
    const groupMessage = fromBinary(GroupMessageSchema, bytes);
    if (groupMessage.ulid && (groupMessage.groupUlid || sessionUlid)) {
      return {
        kind: 'group',
        message: {
          ...groupMessage,
          groupUlid: groupMessage.groupUlid || sessionUlid,
          encryptedPayload: copyBytes(groupMessage.encryptedPayload),
        },
      };
    }
  } catch {
    return null;
  }
  return null;
}

function adaptFriendChatMessage(message: ProtoFriendChatMessage): FriendChatMessage {
  return {
    ulid: message.ulid,
    sessionUlid: message.sessionUlid,
    senderDid: message.senderDid,
    receiverDid: message.receiverDid,
    type: message.type,
    content: message.content,
    status: message.status,
    sentAt: adaptTimestamp(message.sentAt),
    deliveredAt: adaptTimestamp(message.deliveredAt),
    readAt: adaptTimestamp(message.readAt),
    createdAt: adaptTimestamp(message.createdAt),
    updatedAt: adaptTimestamp(message.updatedAt),
    replyToUlid: message.replyToUlid,
    threadRootUlid: message.threadRootUlid,
    recalled: message.recalled,
    editedAt: adaptTimestamp(message.editedAt),
    encryptedPayload: copyBytes(message.encryptedPayload),
  };
}

function adaptTimestamp(timestamp?: Timestamp): SocialTimestamp | undefined {
  if (!timestamp) return undefined;
  return {
    seconds: Number(timestamp.seconds),
    nanos: timestamp.nanos,
  };
}

function mutationKindFromEnum(value: number): MessageMutationKind | null {
  if (value === MessageMutation_Kind.RECALL) return 'RECALL';
  if (value === MessageMutation_Kind.EDIT) return 'EDIT';
  if (value === MessageMutation_Kind.DELETE) return 'DELETE';
  return null;
}

export type GroupMembershipKind = 'ADDED' | 'REMOVED' | 'LEFT' | 'UPDATED';

function groupMembershipKindFromEnum(value: number): GroupMembershipKind | null {
  if (value === GroupMembershipChange_Kind.ADDED) return 'ADDED';
  if (value === GroupMembershipChange_Kind.REMOVED) return 'REMOVED';
  if (value === GroupMembershipChange_Kind.LEFT) return 'LEFT';
  if (value === GroupMembershipChange_Kind.UPDATED) return 'UPDATED';
  return null;
}

function conversationSettingsKindFromEnum(value: number): 'friend' | 'group' | null {
  if (value === ConversationSettingsChanged_Kind.FRIEND) return 'friend';
  if (value === ConversationSettingsChanged_Kind.GROUP) return 'group';
  return null;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function copyBytes(value: Uint8Array): Uint8Array {
  const next = new Uint8Array(value.byteLength);
  next.set(value);
  return next;
}
