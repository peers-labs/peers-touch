import { useSyncExternalStore } from 'react';

import type { ChatStorageSnapshot } from '../gen/proto/domain/chat/storage_pb';
import type {
  MobileRuntimeDescriptor,
  RuntimeOperationResult,
} from '../app/lifecycle/types';
import { chatStorageSnapshot } from '../services/mobileCommands';
import {
  currentMessagingProjectionScope,
  subscribeMessagingProjectionScope,
  type MessagingProjectionScope,
} from './messagingRuntime';

const RECONCILE_INTERVAL_MS = 5 * 60_000;

export type MobileChatStorageProjection =
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

const idleProjection: MobileChatStorageProjection = Object.freeze({
  status: 'idle',
  snapshot: null,
  stale: false,
  error: null,
});

class MobileChatStorageRuntime {
  private projection = idleProjection;
  private listeners = new Set<() => void>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private inFlight: { revision: string; promise: Promise<void> } | null = null;
  private unsubscribeScope: (() => void) | null = null;

  install(): void {
    if (this.interval !== null) return;
    this.unsubscribeScope = subscribeMessagingProjectionScope((scope) => {
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

  refresh(): Promise<void> {
    const scope = currentMessagingProjectionScope();
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
    const operation = chatStorageSnapshot({
      stationPeerId: scope.stationPeerId,
      actorPtid: scope.actorPtid,
      deviceId: scope.deviceId,
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
        if (!sameScope(scope, currentMessagingProjectionScope())) return;
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

  getSnapshot = (): MobileChatStorageProjection => this.projection;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private accepts(
    scope: MessagingProjectionScope,
    snapshot: ChatStorageSnapshot,
  ): boolean {
    return Boolean(
      sameScope(scope, currentMessagingProjectionScope())
      && isChatStorageSnapshotForScope(scope, snapshot),
    );
  }

  private publish(projection: MobileChatStorageProjection): void {
    this.projection = Object.freeze(projection);
    this.listeners.forEach((listener) => listener());
  }
}

export function chatStorageScopeRevision(scope: MessagingProjectionScope): string {
  return [
    scope.stationPeerId,
    scope.actorPtid,
    scope.deviceId,
    scope.activationGeneration,
  ].join('\u001f');
}

export function isChatStorageSnapshotForScope(
  scope: MessagingProjectionScope,
  snapshot: ChatStorageSnapshot,
): boolean {
  return Boolean(
    snapshot.revision === chatStorageScopeRevision(scope)
    && snapshot.scope?.stationPeerId === scope.stationPeerId
    && snapshot.scope.actorPtid === scope.actorPtid
    && snapshot.scope.deviceId === scope.deviceId,
  );
}

function sameScope(
  left: MessagingProjectionScope,
  right: MessagingProjectionScope | null,
): boolean {
  return Boolean(
    right
    && left.stationPeerId === right.stationPeerId
    && left.actorPtid === right.actorPtid
    && left.profileId === right.profileId
    && left.deviceId === right.deviceId
    && left.activationGeneration === right.activationGeneration,
  );
}

export const mobileChatStorageProjectionRuntime = new MobileChatStorageRuntime();

export function createChatStorageRuntimeDescriptor(): MobileRuntimeDescriptor {
  return {
    id: 'chat-storage',
    title: 'Chat Storage Runtime',
    responsibility:
      'Owns scope-fenced device-local Chat storage measurement and stale snapshot retention.',
    dependsOn: ['messaging'],

    async bootstrap(): Promise<void> {
      mobileChatStorageProjectionRuntime.install();
      void mobileChatStorageProjectionRuntime.refresh();
    },

    async suspend(): Promise<void> {
      // Measurement is bounded and read-only; the next resume refresh reconciles it.
    },

    async resume(): Promise<void> {
      void mobileChatStorageProjectionRuntime.refresh();
    },

    async teardown(): Promise<RuntimeOperationResult> {
      const startedAt = performance.now();
      mobileChatStorageProjectionRuntime.teardown();
      return {
        runtimeId: 'chat-storage',
        success: true,
        durationMs: performance.now() - startedAt,
      };
    },
  };
}

export function useMobileChatStorageProjection(): MobileChatStorageProjection {
  return useSyncExternalStore(
    mobileChatStorageProjectionRuntime.subscribe,
    mobileChatStorageProjectionRuntime.getSnapshot,
    mobileChatStorageProjectionRuntime.getSnapshot,
  );
}
