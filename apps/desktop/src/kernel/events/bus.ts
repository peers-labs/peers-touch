import type { EventPayloadMap } from './types';
import { EVENT_NAMES } from './catalog';
import { eventDebugBuffer } from './debug';

class AppEventBus {
  private readonly catalog = new Set<string>(EVENT_NAMES);

  private ensureKnownType(type: string) {
    if (this.catalog.has(type)) return;
    throw new Error(`Unknown event type: ${type}`);
  }

  publish<TType extends keyof EventPayloadMap>(
    type: TType,
    ...args: EventPayloadMap[TType] extends void ? [payload?: EventPayloadMap[TType]] : [payload: EventPayloadMap[TType]]
  ) {
    if (typeof window === 'undefined') return;
    this.ensureKnownType(type);
    const payload = (args[0] as EventPayloadMap[TType]) ?? undefined;
    eventDebugBuffer.push({
      type,
      payload,
      timestamp_ms: Date.now(),
    });
    window.dispatchEvent(new CustomEvent(type, { detail: payload }));
  }

  subscribe<TType extends keyof EventPayloadMap>(
    type: TType,
    handler: (payload: EventPayloadMap[TType]) => void,
  ) {
    if (typeof window === 'undefined') return () => {};
    this.ensureKnownType(type);
    const listener = (event: Event) => {
      const payload = (event as CustomEvent<EventPayloadMap[TType]>).detail;
      handler(payload);
    };
    window.addEventListener(type, listener);
    return () => window.removeEventListener(type, listener);
  }

  once<TType extends keyof EventPayloadMap>(
    type: TType,
    handler: (payload: EventPayloadMap[TType]) => void,
  ) {
    const off = this.subscribe(type, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  subscribeMany<TType extends keyof EventPayloadMap>(
    types: TType[],
    handler: (event: { type: TType; payload: EventPayloadMap[TType] }) => void,
  ) {
    const offs = types.map((type) =>
      this.subscribe(type, (payload) => handler({ type, payload })),
    );
    return () => {
      offs.forEach((off) => off());
    };
  }
}

export const eventBus = new AppEventBus();
