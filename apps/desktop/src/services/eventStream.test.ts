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
  teardownEventStreamBridge,
} from './eventStream';
import type { RealtimeGroupMembershipChangeKind } from '../kernel/events/types';

type TauriEventHandler = (event: { payload: unknown }) => void;

class TestWindow extends EventTarget {
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
