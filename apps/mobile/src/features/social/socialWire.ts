import { fromBinary } from '@bufbuild/protobuf';
import {
  CallSignal_Kind,
  ConversationSettingsChanged_Kind,
  MomentEvent_Kind,
  SocialGraphEvent_Kind,
  StreamEventSchema,
} from '../../gen/proto/domain/realtime/event_pb';

interface RealtimeWireMetadata {
  readonly cursor: string;
  readonly timestampMs: number;
}

export type RealtimeWireEvent = RealtimeWireMetadata & (
  | { kind: 'heartbeat'; floorEventId: string }
  | { kind: 'messaging-wake'; conversationId: string }
  | { kind: 'typing'; sessionUlid: string; fromActorPtid: string; typing: boolean }
  | { kind: 'presence'; ptid: string; online: boolean }
  | { kind: 'settings-changed'; conversationKind: 'friend' | 'group'; containerUlid: string }
  | {
    kind: 'moment';
    momentKind: 'post-created' | 'post-deleted' | 'post-commented' | 'post-reacted';
    postId: string;
    authorActorPtid: string;
    actorPtid: string;
    commentId: string;
    reactionKind: string;
    removed: boolean;
    audience: string;
  }
  | {
    kind: 'social-graph';
    graphKind:
      | 'friend-request-received'
      | 'friend-request-accepted'
      | 'friend-request-rejected'
      | 'conversation-created'
      | 'unfriended'
      | 'relationship-blocked'
      | 'relationship-unblocked';
    actorPtid: string;
    targetPtid: string;
    requestId: string;
    conversationId: string;
  }
  | { kind: 'resync'; newestEventId: string; reason: string }
  | {
    kind: 'call-signal';
    sessionUlid: string;
    fromActorPtid: string;
    signalKind: CallSignalKind;
    callId: string;
    winningDeviceId: string;
    payload: Uint8Array;
  }
);

export function decodeRealtimeSseChunk(chunk: string): RealtimeWireEvent[] {
  return parseSseData(chunk).map((encoded) => {
    try {
      return decodeRealtimeEvent(base64ToBytes(encoded));
    } catch {
      return decodeFailureEvent();
    }
  });
}

function decodeRealtimeEvent(bytes: Uint8Array): RealtimeWireEvent {
  const event = fromBinary(StreamEventSchema, bytes);
  const frame = event.kind;
  const metadata: RealtimeWireMetadata = {
    cursor: event.eventId,
    timestampMs: safeTimestamp(event.tsUnixMs),
  };

  if (frame.case === 'hb') {
    return {
      ...metadata,
      kind: 'heartbeat',
      floorEventId: frame.value.floorEventId,
      cursor: frame.value.floorEventId || metadata.cursor,
    };
  }
  if (frame.case === 'message') {
    return {
      ...metadata,
      kind: 'messaging-wake',
      conversationId: frame.value.sessionUlid,
    };
  }
  if (frame.case === 'receipt') {
    return {
      ...metadata,
      kind: 'messaging-wake',
      conversationId: frame.value.sessionUlid,
    };
  }
  if (frame.case === 'mutation') {
    return {
      ...metadata,
      kind: 'messaging-wake',
      conversationId: frame.value.sessionUlid,
    };
  }
  if (frame.case === 'typing') {
    return {
      ...metadata,
      kind: 'typing',
      sessionUlid: frame.value.sessionUlid,
      fromActorPtid: frame.value.fromActorPtid,
      typing: frame.value.typing,
    };
  }
  if (frame.case === 'presence') {
    return {
      ...metadata,
      kind: 'presence',
      ptid: frame.value.actorPtid,
      online: frame.value.online,
    };
  }
  if (frame.case === 'groupMembershipChange') {
    return {
      ...metadata,
      kind: 'messaging-wake',
      conversationId: frame.value.groupUlid,
    };
  }
  if (frame.case === 'conversationSettingsChanged') {
    const conversationKind = conversationSettingsKindFromEnum(frame.value.kind);
    if (!conversationKind || !frame.value.containerUlid) {
      return resyncEvent(metadata, 'invalid-conversation-settings-event');
    }
    return {
      ...metadata,
      kind: 'settings-changed',
      conversationKind,
      containerUlid: frame.value.containerUlid,
    };
  }
  if (frame.case === 'moment') {
    const momentKind = momentKindFromEnum(frame.value.kind);
    if (!momentKind || !frame.value.postId) {
      return resyncEvent(metadata, 'invalid-moment-event');
    }
    return {
      ...metadata,
      kind: 'moment',
      momentKind,
      postId: frame.value.postId,
      authorActorPtid: frame.value.authorActorPtid,
      actorPtid: frame.value.actorPtid,
      commentId: frame.value.commentId,
      reactionKind: frame.value.reactionKind,
      removed: frame.value.removed,
      audience: frame.value.audience,
      timestampMs: safeTimestamp(frame.value.occurredTsUnixMs) || metadata.timestampMs,
    };
  }
  if (frame.case === 'socialGraphEvent') {
    const graphKind = socialGraphKindFromEnum(frame.value.kind);
    if (!graphKind) return resyncEvent(metadata, 'invalid-social-graph-event');
    return {
      ...metadata,
      kind: 'social-graph',
      graphKind,
      actorPtid: frame.value.actorPtid,
      targetPtid: frame.value.targetPtid,
      requestId: frame.value.requestId,
      conversationId: frame.value.conversationId,
    };
  }
  if (frame.case === 'resync') {
    return {
      ...metadata,
      kind: 'resync',
      newestEventId: frame.value.newestEventId,
      reason: frame.value.reason,
      cursor: frame.value.newestEventId || metadata.cursor,
    };
  }
  if (frame.case === 'signaling') {
    const signalKind = callSignalKindFromEnum(frame.value.kind);
    if (!signalKind) return resyncEvent(metadata, 'invalid-call-signal-kind');
    return {
      ...metadata,
      kind: 'call-signal',
      sessionUlid: frame.value.sessionUlid,
      fromActorPtid: frame.value.fromActorPtid,
      signalKind,
      callId: frame.value.callId,
      winningDeviceId: frame.value.winningDeviceId,
      payload: copyBytes(frame.value.payload),
    };
  }
  return resyncEvent(metadata, `unsupported-event:${frame.case ?? 'none'}`);
}

function parseSseData(chunk: string): string[] {
  const dataLines = chunk
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  return dataLines.length > 0 ? [dataLines.join('')] : [];
}

function conversationSettingsKindFromEnum(value: number): 'friend' | 'group' | null {
  if (value === ConversationSettingsChanged_Kind.FRIEND) return 'friend';
  if (value === ConversationSettingsChanged_Kind.GROUP) return 'group';
  return null;
}

function momentKindFromEnum(
  value: number,
): Extract<RealtimeWireEvent, { kind: 'moment' }>['momentKind'] | null {
  if (value === MomentEvent_Kind.CREATED) return 'post-created';
  if (value === MomentEvent_Kind.DELETED) return 'post-deleted';
  if (value === MomentEvent_Kind.COMMENTED) return 'post-commented';
  if (value === MomentEvent_Kind.REACTED) return 'post-reacted';
  return null;
}

function socialGraphKindFromEnum(
  value: number,
): Extract<RealtimeWireEvent, { kind: 'social-graph' }>['graphKind'] | null {
  if (value === SocialGraphEvent_Kind.FRIEND_REQUEST_RECEIVED) return 'friend-request-received';
  if (value === SocialGraphEvent_Kind.FRIEND_REQUEST_ACCEPTED) return 'friend-request-accepted';
  if (value === SocialGraphEvent_Kind.FRIEND_REQUEST_REJECTED) return 'friend-request-rejected';
  if (value === SocialGraphEvent_Kind.CONVERSATION_CREATED) return 'conversation-created';
  if (value === SocialGraphEvent_Kind.UNFRIENDED) return 'unfriended';
  if (value === SocialGraphEvent_Kind.RELATIONSHIP_BLOCKED) return 'relationship-blocked';
  if (value === SocialGraphEvent_Kind.RELATIONSHIP_UNBLOCKED) return 'relationship-unblocked';
  return null;
}

function safeTimestamp(value: bigint): number {
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : 0;
}

function decodeFailureEvent(): RealtimeWireEvent {
  return {
    kind: 'resync',
    newestEventId: '',
    reason: 'decode-failed',
    cursor: '',
    timestampMs: Date.now(),
  };
}

function resyncEvent(
  metadata: RealtimeWireMetadata,
  reason: string,
): RealtimeWireEvent {
  return {
    ...metadata,
    kind: 'resync',
    newestEventId: metadata.cursor,
    reason,
  };
}

function base64ToBytes(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export type CallSignalKind =
  | 'OFFER'
  | 'ANSWER'
  | 'CANDIDATE'
  | 'HANGUP'
  | 'CALL_REQUEST'
  | 'CALL_ACCEPT'
  | 'CALL_REJECT'
  | 'CALL_END'
  | 'CALL_NO_ANSWER';

function callSignalKindFromEnum(value: number): CallSignalKind | null {
  if (value === CallSignal_Kind.OFFER) return 'OFFER';
  if (value === CallSignal_Kind.ANSWER) return 'ANSWER';
  if (value === CallSignal_Kind.CANDIDATE) return 'CANDIDATE';
  if (value === CallSignal_Kind.HANGUP) return 'HANGUP';
  if (value === CallSignal_Kind.CALL_REQUEST) return 'CALL_REQUEST';
  if (value === CallSignal_Kind.CALL_ACCEPT) return 'CALL_ACCEPT';
  if (value === CallSignal_Kind.CALL_REJECT) return 'CALL_REJECT';
  if (value === CallSignal_Kind.CALL_END) return 'CALL_END';
  if (value === CallSignal_Kind.CALL_NO_ANSWER) return 'CALL_NO_ANSWER';
  return null;
}

function copyBytes(value: Uint8Array): Uint8Array {
  const next = new Uint8Array(value.byteLength);
  next.set(value);
  return next;
}
