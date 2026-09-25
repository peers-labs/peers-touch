import { useSyncExternalStore } from 'react';

import type { ChatStorageSnapshot } from '../services/desktop_api';
import { api } from '../services/desktop_api';
import type { RuntimeDescriptor } from '../kernel/runtime';
import {
  messagingDomainRuntime,
  type MessagingRuntimeScope,
} from '../messaging/runtime';

const RECONCILE_INTERVAL_MS = 5 * 60_000;

export type ChatStorageProjection =
  | {
      readonly status: 'idle' | 'unavailable';
      readonly snapshot: null;
      readonly stale: false;
      readonly error: string | null;
    }
  | {
      readonly status: 'measuring' | 'ready' | 'stale';
      readonly snapshot: ChatStorageSnapshot | null;
      readonly stale: boolean;
      readonly error: string | null;
    };

const idleProjection: ChatStorageProjection = Object.freeze({
  status: 'idle',
  snapshot: null,
  stale: false,
  error: null,
});

class DesktopChatStorageRuntime {
  private projection = idleProjection;
  private listeners = new Set<() => void>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private inFlight: { revision: string; promise: Promise<void> } | null = null;
  private unsubscribeScope: (() => void) | null = null;

  install(): void {
    if (this.interval !== null) return;
    this.unsubscribeScope = messagingDomainRuntime.subscribeScope((scope) => {
      this.publish(idleProjection);
      if (scope) void this.refresh();
    });
    this.interval = globalThis.setInterval(() => {
      void this.refresh();
    }, RECONCILE_INTERVAL_MS);
  }

  teardown(): void {
    if (this.interval !== null) {
      globalThis.clearInterval(this.interval);
      this.interval = null;
    }
    this.unsubscribeScope?.();
    this.unsubscribeScope = null;
    this.inFlight = null;
    this.publish(idleProjection);
  }

  async bootstrap(actorPtid: string | null): Promise<void> {
    this.publish(idleProjection);
    if (actorPtid) await this.refresh();
  }

  refresh(): Promise<void> {
    const scope = messagingDomainRuntime.captureScope();
    if (!scope) {
      this.publish(idleProjection);
      return Promise.resolve();
    }
    const revision = chatStorageScopeRevision(scope);
    if (this.inFlight?.revision === revision) return this.inFlight.promise;
    const previous = this.projection.snapshot?.revision === revision
      ? this.projection.snapshot
      : null;
    this.publish({
      status: 'measuring',
      snapshot: previous,
      stale: previous !== null,
      error: null,
    });
    const operation = api.chatStorageSnapshot({
      stationPeerId: scope.stationPeerId,
      actorPtid: scope.actorPtid,
      deviceId: scope.endpointId,
      scopeRevision: revision,
    })
      .then((snapshot) => {
        if (!this.accepts(scope, snapshot)) return;
        this.publish({
          status: 'ready',
          snapshot,
          stale: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (!messagingDomainRuntime.isCurrent(scope)) return;
        const message = error instanceof Error ? error.message : String(error);
        this.publish(previous
          ? {
              status: 'stale',
              snapshot: previous,
              stale: true,
              error: message,
            }
          : {
              status: 'unavailable',
              snapshot: null,
              stale: false,
              error: message,
            });
      })
      .finally(() => {
        if (this.inFlight?.promise === operation) this.inFlight = null;
      });
    this.inFlight = { revision, promise: operation };
    return operation;
  }

  getSnapshot = (): ChatStorageProjection => this.projection;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private accepts(
    scope: MessagingRuntimeScope,
    snapshot: ChatStorageSnapshot,
  ): boolean {
    return messagingDomainRuntime.isCurrent(scope)
      && isChatStorageSnapshotForScope(scope, snapshot);
  }

  private publish(projection: ChatStorageProjection): void {
    this.projection = Object.freeze(projection);
    this.listeners.forEach((listener) => listener());
  }
}

export function chatStorageScopeRevision(scope: MessagingRuntimeScope): string {
  return [
    scope.stationPeerId,
    scope.actorPtid,
    scope.endpointId,
    scope.activationGeneration,
  ].join('\u001f');
}

export function isChatStorageSnapshotForScope(
  scope: MessagingRuntimeScope,
  snapshot: ChatStorageSnapshot,
): boolean {
  return Boolean(
    snapshot.revision === chatStorageScopeRevision(scope)
    && snapshot.scope?.stationPeerId === scope.stationPeerId
    && snapshot.scope.actorPtid === scope.actorPtid
    && snapshot.scope.deviceId === scope.endpointId,
  );
}

export const chatStorageProjectionRuntime = new DesktopChatStorageRuntime();

export const chatStorageRuntime: RuntimeDescriptor = {
  id: 'chat-storage',
  scope: 'session',
  install(): void {
    chatStorageProjectionRuntime.install();
  },
  teardown(): void {
    chatStorageProjectionRuntime.teardown();
  },
  bootstrap(actorPtid: string | null): Promise<void> {
    return chatStorageProjectionRuntime.bootstrap(actorPtid);
  },
  reconcile(): Promise<void> {
    return chatStorageProjectionRuntime.refresh();
  },
};

export function useChatStorageProjection(): ChatStorageProjection {
  return useSyncExternalStore(
    chatStorageProjectionRuntime.subscribe,
    chatStorageProjectionRuntime.getSnapshot,
    chatStorageProjectionRuntime.getSnapshot,
  );
}
