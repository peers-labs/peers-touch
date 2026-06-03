import { fromBinary } from '@bufbuild/protobuf';
import type { Timestamp } from '@bufbuild/protobuf/wkt';
import { FriendChatMessageSchema } from '../../gen/proto/domain/chat/friend_chat_pb';
import type { FriendChatMessage as ProtoFriendChatMessage } from '../../gen/proto/domain/chat/friend_chat_pb';
import {
  MessageMutation_Kind,
  StreamEventSchema,
} from '../../gen/proto/domain/realtime/event_pb';
import type { MessageMutationKind } from './socialProjection';
import type { FriendChatMessage, SocialTimestamp } from './socialTypes';

export type RealtimeWireEvent =
  | { kind: 'message'; sessionUlid: string; message: FriendChatMessage }
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
    const message = decodeFriendChatMessage(frame.value.ciphertext);
    return message ? { kind: 'message', sessionUlid: frame.value.sessionUlid, message } : null;
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
  if (!message.ulid) return null;
  return adaptFriendChatMessage(message);
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
