// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { create, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';

import {
  MessageEnvelopeSchema,
  MomentEvent_Kind,
  MomentEventSchema,
  SocialGraphEvent_Kind,
  SocialGraphEventSchema,
  StreamEventSchema,
} from '../../gen/proto/domain/realtime/event_pb';
import { decodeRealtimeSseChunk } from './socialWire';

function encodeFrame(input: Parameters<typeof create<typeof StreamEventSchema>>[1]): string {
  const event = create(StreamEventSchema, input);
  return `data: ${Buffer.from(toBinary(StreamEventSchema, event)).toString('base64')}`;
}

describe('social realtime wire', () => {
  it('projects Chat envelopes as wake hints without decoding message payloads', () => {
    const chunk = encodeFrame({
      eventId: 'event-chat',
      tsUnixMs: 122n,
      kind: {
        case: 'message',
        value: create(MessageEnvelopeSchema, {
          sessionUlid: 'conversation-1',
          ciphertext: new Uint8Array([0xff, 0x00]),
        }),
      },
    });

    expect(decodeRealtimeSseChunk(chunk)).toEqual([{
      kind: 'messaging-wake',
      conversationId: 'conversation-1',
      cursor: 'event-chat',
      timestampMs: 122,
    }]);
  });

  it('preserves the generated event cursor and decodes Moment events', () => {
    const chunk = encodeFrame({
      eventId: 'event-42',
      tsUnixMs: 123n,
      kind: {
        case: 'moment',
        value: create(MomentEventSchema, {
          kind: MomentEvent_Kind.COMMENTED,
          postId: 'post-1',
          actorPtid: 'ptid:alice',
          commentId: 'comment-1',
          occurredTsUnixMs: 456n,
        }),
      },
    });

    expect(decodeRealtimeSseChunk(chunk)).toEqual([{
      kind: 'moment',
      momentKind: 'post-commented',
      postId: 'post-1',
      authorActorPtid: '',
      actorPtid: 'ptid:alice',
      commentId: 'comment-1',
      reactionKind: '',
      removed: false,
      audience: '',
      cursor: 'event-42',
      timestampMs: 456,
    }]);
  });

  it('decodes SocialGraph events without inventing client identity', () => {
    const chunk = encodeFrame({
      eventId: 'event-43',
      tsUnixMs: 789n,
      kind: {
        case: 'socialGraphEvent',
        value: create(SocialGraphEventSchema, {
          kind: SocialGraphEvent_Kind.FRIEND_REQUEST_RECEIVED,
          actorPtid: 'ptid:alice',
          targetPtid: 'ptid:bob',
          requestId: 'request-1',
        }),
      },
    });

    expect(decodeRealtimeSseChunk(chunk)).toEqual([{
      kind: 'social-graph',
      graphKind: 'friend-request-received',
      actorPtid: 'ptid:alice',
      targetPtid: 'ptid:bob',
      requestId: 'request-1',
      conversationId: '',
      cursor: 'event-43',
      timestampMs: 789,
    }]);
  });

  it('decodes relationship invalidations as Social-owned graph events', () => {
    const chunk = encodeFrame({
      eventId: 'event-44',
      tsUnixMs: 790n,
      kind: {
        case: 'socialGraphEvent',
        value: create(SocialGraphEventSchema, {
          kind: SocialGraphEvent_Kind.RELATIONSHIP_BLOCKED,
          actorPtid: 'ptid:alice',
          targetPtid: 'ptid:bob',
        }),
      },
    });

    expect(decodeRealtimeSseChunk(chunk)).toEqual([{
      kind: 'social-graph',
      graphKind: 'relationship-blocked',
      actorPtid: 'ptid:alice',
      targetPtid: 'ptid:bob',
      requestId: '',
      conversationId: '',
      cursor: 'event-44',
      timestampMs: 790,
    }]);
  });

  it('fails closed into an explicit resync event when a frame is invalid', () => {
    expect(decodeRealtimeSseChunk('data: not-base64')).toEqual([{
      kind: 'resync',
      newestEventId: '',
      reason: 'decode-failed',
      cursor: '',
      timestampMs: expect.any(Number),
    }]);
  });
});
