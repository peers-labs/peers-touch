import { useSyncExternalStore } from 'react';

import { ChatStorageOperationState } from '../gen/proto/domain/chat/storage_pb';
import type {
  ChatStorageResult,
  ChatStorageSnapshot,
} from '../services/desktop_api';
import { api } from '../services/desktop_api';
import type {
  RuntimeDescriptor,
  RuntimePageAcquireReason,
} from '../kernel/runtime';
import {
  messagingDomainRuntime,
  type MessagingRuntimeScope,
} from '../messaging/runtime';

const RECONCILE_INTERVAL_MS = 5 * 60_000;

export type ChatStorageCleanupProjection =
  | {
      readonly status: 'idle' | 'clearing';
      readonly result: null;
      readonly error: string | null;
    }
  | {
      readonly status: 'succeeded' | 'failed';
      readonly result: ChatStorageResult | null;
      readonly error: string | null;
    };

export interface ChatStorageProjection {
  readonly status: 'idle' | 'measuring' | 'ready' | 'stale' | 'unavailable';
  readonly snapshot: ChatStorageSnapshot | null;
  readonly stale: boolean;
  readonly error: string | null;
  readonly cleanup: ChatStorageCleanupProjection;
}

const idleCleanup: ChatStorageCleanupProjection = Object.freeze({
  status: 'idle',
  result: null,
  error: null,
});

const idleProjection: ChatStorageProjection = Object.freeze({
  status: 'idle',
  snapshot: null,
  stale: false,
  error: null,
  cleanup: idleCleanup,
});

class DesktopChatStorageRuntime {
  private projection = idleProjection;
  private listeners = new Set<() => void>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private inFlight: { revision: string; promise: Promise<void> } | null = null;
  private cleanupInFlight: {
    revision: string;
    promise: Promise<ChatStorageResult | null>;
  } | null = null;
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
    this.cleanupInFlight = null;
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
      cleanup: this.projection.cleanup,
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
          cleanup: this.projection.cleanup,
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
              cleanup: this.projection.cleanup,
            }
          : {
              status: 'unavailable',
              snapshot: null,
              stale: false,
              error: message,
              cleanup: this.projection.cleanup,
            });
      })
      .finally(() => {
        if (this.inFlight?.promise === operation) this.inFlight = null;
      });
    this.inFlight = { revision, promise: operation };
    return operation;
  }

  clearCache(): Promise<ChatStorageResult | null> {
    const scope = messagingDomainRuntime.captureScope();
    if (!scope) return Promise.resolve(null);
    const revision = chatStorageScopeRevision(scope);
    if (this.cleanupInFlight?.revision === revision) {
      return this.cleanupInFlight.promise;
    }
    this.publish({
      ...this.projection,
      cleanup: {
        status: 'clearing',
        result: null,
        error: null,
      },
    });
    const operation = api.chatStorageClearCache({
      stationPeerId: scope.stationPeerId,
      actorPtid: scope.actorPtid,
      deviceId: scope.endpointId,
      scopeRevision: revision,
    })
      .then((result) => {
        if (!messagingDomainRuntime.isCurrent(scope)) return null;
        if (!isChatStorageResultForScope(scope, result)) {
          this.publish({
            ...this.projection,
            cleanup: {
              status: 'failed',
              result: null,
              error: 'chat cache cleanup returned a stale scope',
            },
          });
          return null;
        }
        const succeeded = !result.error
          && result.operation?.state === ChatStorageOperationState.SUCCEEDED;
        this.publish({
          status: 'ready',
          snapshot: result.snapshot ?? null,
          stale: false,
          error: null,
          cleanup: {
            status: succeeded ? 'succeeded' : 'failed',
            result,
            error: succeeded
              ? null
              : result.error?.message ?? 'chat cache cleanup did not complete',
          },
        });
        return result;
      })
      .catch((error: unknown) => {
        if (!messagingDomainRuntime.isCurrent(scope)) return null;
        const message = error instanceof Error ? error.message : String(error);
        this.publish({
          ...this.projection,
          cleanup: {
            status: 'failed',
            result: null,
            error: message,
          },
        });
        return null;
      })
      .finally(() => {
        if (this.cleanupInFlight?.promise === operation) {
          this.cleanupInFlight = null;
        }
      });
    this.cleanupInFlight = { revision, promise: operation };
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

export function isChatStorageResultForScope(
  scope: MessagingRuntimeScope,
  result: ChatStorageResult,
): boolean {
  const snapshot = result.snapshot;
  const operation = result.operation;
  return Boolean(
    snapshot
    && operation
    && isChatStorageSnapshotForScope(scope, snapshot)
    && operation.scopeRevision === chatStorageScopeRevision(scope)
    && operation.scope?.stationPeerId === scope.stationPeerId
    && operation.scope.actorPtid === scope.actorPtid
    && operation.scope.deviceId === scope.endpointId,
  );
}

export function chatStorageReleasedBytes(result: ChatStorageResult | null): bigint | null {
  const operation = result?.operation;
  if (!operation) return null;
  return operation.physicalBytesBefore > operation.physicalBytesAfter
    ? operation.physicalBytesBefore - operation.physicalBytesAfter
    : 0n;
}

export function shouldRefreshChatStorageForPage(
  pageId: string,
  reason: RuntimePageAcquireReason,
): boolean {
  return pageId === 'settings' && reason === 'activate';
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
  acquirePage(pageId, reason): Promise<void> | undefined {
    if (!shouldRefreshChatStorageForPage(pageId, reason)) return undefined;
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
