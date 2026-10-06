import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create, toBinary } from '@bufbuild/protobuf';

import { EVENT } from '../kernel/events/catalog';
import { eventBus } from '../kernel/events';
import {
  GroupMembershipChange_Kind,
  MomentEvent_Kind,
  SocialGraphEvent_Kind,
  StreamEventSchema,
} from '../gen/proto/domain/realtime/event_pb';
import {
  installEventStreamBridge,
  teardownEventStreamBridge,
} from './eventStream';
import type {
  MomentCreatedPayload,
  MomentRevokedPayload,
  RelationshipChangedPayload,
  RealtimeGroupFederationEventPayload,
  RealtimeGroupMembershipChangeKind,
} from '../kernel/events/types';

type TauriEventHandler = (event: { payload: unknown }) => void;

class TestWindow extends EventTarget {
  setInterval(handler: TimerHandler, timeout?: number, ...arguments_: unknown[]): number {
    return globalThis.setInterval(handler, timeout, ...arguments_) as unknown as number;
  }

  clearInterval(id?: number): void {
    globalThis.clearInterval(id);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    super.addEventListener(type, listener);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    super.removeEventListener(type, listener);
  }

  dispatchEvent(event: Event): boolean {
    return super.dispatchEvent(event);
  }
}

const listenMock = vi.hoisted(() => vi.fn());
const originalWindow = globalThis.window;
const originalCustomEvent = globalThis.CustomEvent;

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

vi.mock('./desktop_api', () => ({
  api: {
    realtimeStreamStart: vi.fn(),
    realtimeStreamStop: vi.fn(),
  },
}));

describe('event stream group membership decode', () => {
  beforeEach(() => {
    (globalThis as any).window = new TestWindow();
    if (typeof globalThis.CustomEvent === 'undefined') {
      (globalThis as any).CustomEvent = class<T = unknown> extends Event {
        detail: T;

        constructor(type: string, init?: CustomEventInit<T>) {
          super(type);
          this.detail = init?.detail as T;
        }
      };
    }
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => undefined);
    teardownEventStreamBridge();
  });

  afterEach(() => {
    teardownEventStreamBridge();
    (globalThis as any).window = originalWindow;
    (globalThis as any).CustomEvent = originalCustomEvent;
  });

  it.each([
    [GroupMembershipChange_Kind.TRANSFERRED, 'TRANSFERRED'],
    [GroupMembershipChange_Kind.DISSOLVED, 'DISSOLVED'],
  ] as const)('dispatches %s group membership changes', async (wireKind, expectedKind) => {
    let realtimeHandler: TauriEventHandler = () => {
      throw new Error('realtime:event handler was not installed');
    };
    listenMock.mockImplementation(async (eventName: string, handler: TauriEventHandler) => {
      if (eventName === 'realtime:event') realtimeHandler = handler;
      return () => undefined;
    });
    const payloads: RealtimeGroupMembershipChangeKind[] = [];
    const unsubscribe = eventBus.subscribe(EVENT.REALTIME_GROUP_MEMBERSHIP_CHANGE, (payload) => {
      payloads.push(payload.kind);
    });

    await installEventStreamBridge();
    expect(realtimeHandler).toBeTypeOf('function');
    realtimeHandler({
      payload: {
        event_id: 'raw-event-1',
        data_b64: groupMembershipFrameBase64(wireKind),
      },
    });
    unsubscribe();

    expect(payloads).toEqual([expectedKind]);
  });

  it('dispatches group federation events', async () => {
    let realtimeHandler: TauriEventHandler = () => {
      throw new Error('realtime:event handler was not installed');
    };
    listenMock.mockImplementation(async (eventName: string, handler: TauriEventHandler) => {
      if (eventName === 'realtime:event') realtimeHandler = handler;
      return () => undefined;
    });
    const payloads: RealtimeGroupFederationEventPayload[] = [];
    const unsubscribe = eventBus.subscribe(EVENT.REALTIME_GROUP_FEDERATION_EVENT, (payload) => {
      payloads.push(payload);
    });

    await installEventStreamBridge();
    realtimeHandler({
      payload: {
        event_id: 'stream-event-1',
        data_b64: groupFederationFrameBase64(),
      },
    });
    unsubscribe();

    expect(payloads).toEqual([
      expect.objectContaining({
        eventId: 'stream-event-1',
        groupUlid: 'group-1',
        groupEventUlid: 'group-event-2',
        seq: 2,
        eventType: 'group.proposal.accepted',
        authorityStationPeerId: 'station-a',
        eventHash: 'hash-2',
        messageUlid: 'message-1',
        actorPtid: 'did:peer:bob',
      }),
    ]);
  });

  it('dispatches an imported private Moment wake through the typed event bus', async () => {
    let realtimeHandler: TauriEventHandler = () => {
      throw new Error('realtime:event handler was not installed');
    };
    listenMock.mockImplementation(async (eventName: string, handler: TauriEventHandler) => {
      if (eventName === 'realtime:event') realtimeHandler = handler;
      return () => undefined;
    });
    const payloads: MomentCreatedPayload[] = [];
    const unsubscribe = eventBus.subscribe(EVENT.MOMENT_CREATED, (payload) => {
      payloads.push(payload);
    });

    await installEventStreamBridge();
    realtimeHandler({
      payload: {
        actor_ptid: 'ptid:bob',
        session_epoch: 7,
        station_peer_id: 'station-b',
        station_url: 'https://station-b.test/',
        event_id: 'remote-private-event-1',
        data_b64: privateMomentFrameBase64(),
      },
    });
    unsubscribe();

    expect(payloads).toEqual([{
      eventId: 'remote-private-event-1',
      targetActorPtid: 'ptid:bob',
      sessionEpoch: 7,
      stationPeerId: 'station-b',
      stationUrl: 'https://station-b.test',
      postId: '01REMOTEPRIVATEPOST',
      authorActorPtid: 'ptid:alice',
      occurredAtUnixMs: 456,
      audience: 'FRIENDS',
    }]);
  });

  it('drops a Moment wake whose stream actor does not match the event target', async () => {
    let realtimeHandler: TauriEventHandler = () => {
      throw new Error('realtime:event handler was not installed');
    };
    listenMock.mockImplementation(async (eventName: string, handler: TauriEventHandler) => {
      if (eventName === 'realtime:event') realtimeHandler = handler;
      return () => undefined;
    });
    const payloads: MomentCreatedPayload[] = [];
    const unsubscribe = eventBus.subscribe(EVENT.MOMENT_CREATED, (payload) => {
      payloads.push(payload);
    });

    await installEventStreamBridge();
    realtimeHandler({
      payload: {
        actor_ptid: 'ptid:eve',
        session_epoch: 7,
        station_peer_id: 'station-b',
        station_url: 'https://station-b.test',
        event_id: 'remote-private-wrong-actor',
        data_b64: privateMomentFrameBase64(),
      },
    });
    unsubscribe();

    expect(payloads).toEqual([]);
  });

  it('dispatches a typed private revocation and preserves its reason', async () => {
    let realtimeHandler: TauriEventHandler = () => {
      throw new Error('realtime:event handler was not installed');
    };
    listenMock.mockImplementation(async (eventName: string, handler: TauriEventHandler) => {
      if (eventName === 'realtime:event') realtimeHandler = handler;
      return () => undefined;
    });
    const payloads: MomentRevokedPayload[] = [];
    const unsubscribe = eventBus.subscribe(EVENT.MOMENT_REVOKED, (payload) => {
      payloads.push(payload);
    });

    await installEventStreamBridge();
    realtimeHandler({
      payload: {
        actor_ptid: 'ptid:bob',
        session_epoch: 7,
        station_peer_id: 'station-b',
        station_url: 'https://station-b.test/',
        event_id: 'remote-private-revocation-1',
        data_b64: privateMomentRevocationFrameBase64(
          'PRIVATE_RESOURCE_INVALIDATION_REASON_RECIPIENT_BLOCKED',
        ),
      },
    });
    unsubscribe();

    expect(payloads).toEqual([{
      eventId: 'remote-private-event-1',
      targetActorPtid: 'ptid:bob',
      sessionEpoch: 7,
      stationPeerId: 'station-b',
      stationUrl: 'https://station-b.test',
      postId: '01REMOTEPRIVATEPOST',
      authorActorPtid: undefined,
      occurredAtUnixMs: 456,
      reason: 'RECIPIENT_BLOCKED',
    }]);
  });

  it('requests reconciliation for an unknown private revocation reason', async () => {
    let realtimeHandler: TauriEventHandler = () => {
      throw new Error('realtime:event handler was not installed');
    };
    listenMock.mockImplementation(async (eventName: string, handler: TauriEventHandler) => {
      if (eventName === 'realtime:event') realtimeHandler = handler;
      return () => undefined;
    });
    const payloads: Array<{ newestEventId?: string; reason: string }> = [];
    const unsubscribe = eventBus.subscribe(EVENT.MOMENT_RESYNC_REQUESTED, (payload) => {
      payloads.push(payload);
    });

    await installEventStreamBridge();
    realtimeHandler({
      payload: {
        actor_ptid: 'ptid:bob',
        session_epoch: 7,
        station_peer_id: 'station-b',
        station_url: 'https://station-b.test/',
        event_id: 'remote-private-revocation-unknown',
        data_b64: privateMomentRevocationFrameBase64(
          'PRIVATE_RESOURCE_INVALIDATION_REASON_FUTURE',
        ),
      },
    });
    unsubscribe();

    expect(payloads).toEqual([{
      newestEventId: 'remote-private-event-1',
      reason: 'unknown-private-revocation',
    }]);
  });

  it('maps relationship block events to the shared projection event', async () => {
    let realtimeHandler: TauriEventHandler = () => {
      throw new Error('realtime:event handler was not installed');
    };
    listenMock.mockImplementation(async (eventName: string, handler: TauriEventHandler) => {
      if (eventName === 'realtime:event') realtimeHandler = handler;
      return () => undefined;
    });
    const payloads: RelationshipChangedPayload[] = [];
    const unsubscribe = eventBus.subscribe(EVENT.RELATIONSHIP_CHANGED, (payload) => {
      payloads.push(payload);
    });

    await installEventStreamBridge();
    realtimeHandler({
      payload: {
        actor_ptid: 'ptid:bob',
        session_epoch: 7,
        station_peer_id: 'station-b',
        station_url: 'https://station-b.test/',
        event_id: 'relationship-block-1',
        data_b64: socialGraphFrameBase64(
          SocialGraphEvent_Kind.RELATIONSHIP_BLOCKED,
        ),
      },
    });
    unsubscribe();

    expect(payloads).toEqual([{
      targetActorPtid: 'ptid:alice',
      action: 'block',
    }]);
  });

});

function groupMembershipFrameBase64(kind: GroupMembershipChange_Kind): string {
  const event = create(StreamEventSchema, {
    eventId: 'stream-event-1',
    kind: {
      case: 'groupMembershipChange',
      value: {
        eventId: 'membership-change-1',
        groupUlid: 'group-1',
        actorPtid: 'did:peer:member-1',
        kind,
        changedTsUnixMs: 123n,
      },
    },
  });
  return Buffer.from(toBinary(StreamEventSchema, event)).toString('base64');
}

function groupFederationFrameBase64(): string {
  const event = create(StreamEventSchema, {
    eventId: 'stream-event-1',
    kind: {
      case: 'groupFederationEvent',
      value: {
        groupUlid: 'group-1',
        eventUlid: 'group-event-2',
        seq: 2n,
        eventType: 'group.proposal.accepted',
        authorityStationPeerId: 'station-a',
        authorityEpoch: 1n,
        eventHash: 'hash-2',
        messageUlid: 'message-1',
        membershipEpoch: 1n,
        committedTsUnixMs: 123n,
        actorPtid: 'did:peer:bob',
      },
    },
  });
  return Buffer.from(toBinary(StreamEventSchema, event)).toString('base64');
}

function privateMomentFrameBase64(): string {
  const event = create(StreamEventSchema, {
    eventId: 'remote-private-event-1',
    kind: {
      case: 'moment',
      value: {
        kind: MomentEvent_Kind.CREATED,
        postId: '01REMOTEPRIVATEPOST',
        authorActorPtid: 'ptid:alice',
        actorPtid: 'ptid:bob',
        audience: 'FRIENDS',
        occurredTsUnixMs: 456n,
      },
    },
  });
  return Buffer.from(toBinary(StreamEventSchema, event)).toString('base64');
}

function privateMomentRevocationFrameBase64(reason: string): string {
  const event = create(StreamEventSchema, {
    eventId: 'remote-private-event-1',
    kind: {
      case: 'moment',
      value: {
        kind: MomentEvent_Kind.DELETED,
        postId: '01REMOTEPRIVATEPOST',
        actorPtid: 'ptid:bob',
        audience: reason,
        occurredTsUnixMs: 456n,
      },
    },
  });
  return Buffer.from(toBinary(StreamEventSchema, event)).toString('base64');
}

function socialGraphFrameBase64(kind: SocialGraphEvent_Kind): string {
  const event = create(StreamEventSchema, {
    eventId: 'relationship-event-1',
    kind: {
      case: 'socialGraphEvent',
      value: {
        kind,
        actorPtid: 'ptid:alice',
        targetPtid: 'ptid:bob',
      },
    },
  });
  return Buffer.from(toBinary(StreamEventSchema, event)).toString('base64');
}
