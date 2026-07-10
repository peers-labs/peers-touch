import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create, toBinary } from '@bufbuild/protobuf';

import { EVENT } from '../kernel/events/catalog';
import { eventBus } from '../kernel/events';
import {
  GroupMembershipChange_Kind,
  StreamEventSchema,
} from '../gen/proto/domain/realtime/event_pb';
import {
  installEventStreamBridge,
  startEventStream,
  stopEventStream,
  teardownEventStreamBridge,
} from './eventStream';
import type {
  RealtimeGroupFederationEventPayload,
  RealtimeGroupMembershipChangeKind,
  RealtimeGroupSkdmEnvelopeDeliveredPayload,
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
        actorDid: 'did:peer:bob',
      }),
    ]);
  });

  it('dispatches group SKDM envelope delivery events', async () => {
    let realtimeHandler: TauriEventHandler = () => {
      throw new Error('realtime:event handler was not installed');
    };
    listenMock.mockImplementation(async (eventName: string, handler: TauriEventHandler) => {
      if (eventName === 'realtime:event') realtimeHandler = handler;
      return () => undefined;
    });
    const payloads: RealtimeGroupSkdmEnvelopeDeliveredPayload[] = [];
    const unsubscribe = eventBus.subscribe(EVENT.REALTIME_GROUP_SKDM_ENVELOPE_DELIVERED, (payload) => {
      payloads.push(payload);
    });

    await installEventStreamBridge();
    realtimeHandler({
      payload: {
        event_id: 'stream-event-1',
        data_b64: groupSkdmEnvelopeDeliveredFrameBase64(),
      },
    });
    unsubscribe();

    expect(payloads).toEqual([
      expect.objectContaining({
        eventId: 'stream-event-1',
        groupUlid: 'group-1',
        membershipEpoch: 3,
        senderDid: 'did:peer:alice',
        senderKeyId: 7,
        senderHomeStationPeerId: 'station-a',
        recipientDid: 'did:peer:bob',
        recipientDeviceId: 'bob-device-1',
        idempotencyKey: 'skdm-1',
        encryptedPayloadB64: Buffer.from('sealed-skdm').toString('base64'),
      }),
    ]);
  });

  it('keeps browser gateway resync fallback low-frequency', async () => {
    vi.useFakeTimers();
    (window as any).__PT_GATEWAY_BASE__ = 'http://127.0.0.1:3031';
    const payloads: unknown[] = [];
    const unsubscribe = eventBus.subscribe(EVENT.REALTIME_RESYNC, (payload) => {
      payloads.push(payload);
    });

    try {
      await startEventStream();

      await vi.advanceTimersByTimeAsync(2_000);
      expect(payloads).toEqual([]);

      await vi.advanceTimersByTimeAsync(28_000);
      expect(payloads).toEqual([
        {
          newestEventId: '',
          reason: 'browser-dev-gateway-resync',
        },
      ]);
    } finally {
      await stopEventStream();
      unsubscribe();
      vi.useRealTimers();
    }
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
        actorDid: 'did:peer:member-1',
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
        actorDid: 'did:peer:bob',
      },
    },
  });
  return Buffer.from(toBinary(StreamEventSchema, event)).toString('base64');
}

function groupSkdmEnvelopeDeliveredFrameBase64(): string {
  const event = create(StreamEventSchema, {
    eventId: 'stream-event-1',
    kind: {
      case: 'groupSkdmEnvelopeDelivered',
      value: {
        groupUlid: 'group-1',
        membershipEpoch: 3n,
        senderDid: 'did:peer:alice',
        senderKeyId: 7,
        senderHomeStationPeerId: 'station-a',
        recipientDid: 'did:peer:bob',
        recipientDeviceId: 'bob-device-1',
        idempotencyKey: 'skdm-1',
        encryptedPayload: new TextEncoder().encode('sealed-skdm'),
        deliveredTsUnixMs: 123n,
      },
    },
  });
  return Buffer.from(toBinary(StreamEventSchema, event)).toString('base64');
}
