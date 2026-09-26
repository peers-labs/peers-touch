import { useSyncExternalStore } from 'react';

import {
  ChatRetentionPreset,
  ChatStorageOperationState,
  type ChatStorageResult,
  type ChatStorageSnapshot,
} from '../gen/proto/domain/chat/storage_pb';
import type {
  MobileRuntimeDescriptor,
  RuntimeOperationResult,
} from '../app/lifecycle/types';
import {
  chatStorageClearCache,
  chatStorageSetRetention,
  chatStorageSnapshot,
} from '../services/mobileCommands';
import {
  currentMessagingProjectionScope,
  subscribeMessagingProjectionScope,
  type MessagingProjectionScope,
} from './messagingRuntime';

const RECONCILE_INTERVAL_MS = 5 * 60_000;
const RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60_000;

export type MobileChatStorageCleanupProjection =
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

export type MobileChatStorageRetentionProjection =
  | {
      readonly status: 'idle' | 'saving';
      readonly result: null;
      readonly error: string | null;
    }
  | {
      readonly status: 'succeeded' | 'failed';
      readonly result: ChatStorageResult | null;
      readonly error: string | null;
    };

export interface MobileChatStorageProjection {
  readonly status: 'idle' | 'measuring' | 'ready' | 'stale' | 'unavailable';
  readonly snapshot: ChatStorageSnapshot | null;
  readonly stale: boolean;
  readonly error: string | null;
  readonly cleanup: MobileChatStorageCleanupProjection;
  readonly retention: MobileChatStorageRetentionProjection;
}

const idleCleanup: MobileChatStorageCleanupProjection = Object.freeze({
  status: 'idle',
  result: null,
  error: null,
});

const idleRetention: MobileChatStorageRetentionProjection = Object.freeze({
  status: 'idle',
  result: null,
  error: null,
});

const idleProjection: MobileChatStorageProjection = Object.freeze({
  status: 'idle',
  snapshot: null,
  stale: false,
  error: null,
  cleanup: idleCleanup,
  retention: idleRetention,
});

class MobileChatStorageRuntime {
  private projection = idleProjection;
  private listeners = new Set<() => void>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private inFlight: { revision: string; promise: Promise<void> } | null = null;
  private cleanupInFlight: {
    revision: string;
    promise: Promise<ChatStorageResult | null>;
  } | null = null;
  private retentionInFlight: {
    revision: string;
    promise: Promise<ChatStorageResult | null>;
  } | null = null;
  private unsubscribeScope: (() => void) | null = null;
  private lastRetentionSweepAtUnixMs = 0;

  install(): void {
    if (this.interval !== null) return;
    this.unsubscribeScope = subscribeMessagingProjectionScope((scope) => {
      this.lastRetentionSweepAtUnixMs = 0;
      this.publish(idleProjection);
      if (scope) void this.refresh();
    });
    this.interval = globalThis.setInterval(() => {
      void this.reconcile();
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
    this.retentionInFlight = null;
    this.lastRetentionSweepAtUnixMs = 0;
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
      cleanup: this.projection.cleanup,
      retention: this.projection.retention,
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
          cleanup: this.projection.cleanup,
          retention: this.projection.retention,
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
              cleanup: this.projection.cleanup,
              retention: this.projection.retention,
            }
          : {
              status: 'unavailable',
              snapshot: null,
              stale: false,
              error: message,
              cleanup: this.projection.cleanup,
              retention: this.projection.retention,
            });
      })
      .finally(() => {
        if (this.inFlight?.promise === operation) this.inFlight = null;
      });
    this.inFlight = { revision, promise: operation };
    return operation;
  }

  async reconcile(): Promise<void> {
    await this.refresh();
    const preset = this.projection.snapshot?.retentionPolicy?.retentionPreset;
    if (
      preset
      && preset !== ChatRetentionPreset.CHAT_RETENTION_PRESET_FOREVER
      && this.projection.status === 'ready'
      && this.projection.retention.status !== 'saving'
      && Date.now() - this.lastRetentionSweepAtUnixMs >= RETENTION_SWEEP_INTERVAL_MS
    ) {
      await this.setRetention(preset as ChatRetentionPreset);
    }
  }

  clearCache(): Promise<ChatStorageResult | null> {
    const scope = currentMessagingProjectionScope();
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
    const operation = chatStorageClearCache({
      stationPeerId: scope.stationPeerId,
      actorPtid: scope.actorPtid,
      deviceId: scope.deviceId,
      scopeRevision: revision,
    })
      .then((result) => {
        if (!sameScope(scope, currentMessagingProjectionScope())) return null;
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
          retention: this.projection.retention,
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
        if (!sameScope(scope, currentMessagingProjectionScope())) return null;
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

  setRetention(retentionPreset: ChatRetentionPreset): Promise<ChatStorageResult | null> {
    const scope = currentMessagingProjectionScope();
    if (!scope) return Promise.resolve(null);
    const revision = chatStorageScopeRevision(scope);
    if (this.retentionInFlight?.revision === revision) {
      return this.retentionInFlight.promise;
    }
    this.publish({
      ...this.projection,
      retention: { status: 'saving', result: null, error: null },
    });
    const operation = chatStorageSetRetention({
      stationPeerId: scope.stationPeerId,
      actorPtid: scope.actorPtid,
      deviceId: scope.deviceId,
      scopeRevision: revision,
      retentionPreset,
    })
      .then((result) => {
        if (!sameScope(scope, currentMessagingProjectionScope())) return null;
        if (!isChatStorageResultForScope(scope, result)) {
          this.publish({
            ...this.projection,
            retention: {
              status: 'failed',
              result: null,
              error: 'chat retention returned a stale scope',
            },
          });
          return null;
        }
        const succeeded = !result.error
          && result.operation?.state === ChatStorageOperationState.SUCCEEDED;
        if (succeeded) this.lastRetentionSweepAtUnixMs = Date.now();
        this.publish({
          status: 'ready',
          snapshot: result.snapshot ?? null,
          stale: false,
          error: null,
          cleanup: this.projection.cleanup,
          retention: {
            status: succeeded ? 'succeeded' : 'failed',
            result,
            error: succeeded
              ? null
              : result.error?.message ?? 'chat retention did not complete',
          },
        });
        return result;
      })
      .catch((error: unknown) => {
        if (!sameScope(scope, currentMessagingProjectionScope())) return null;
        const message = error instanceof Error ? error.message : String(error);
        this.publish({
          ...this.projection,
          retention: { status: 'failed', result: null, error: message },
        });
        return null;
      })
      .finally(() => {
        if (this.retentionInFlight?.promise === operation) {
          this.retentionInFlight = null;
        }
      });
    this.retentionInFlight = { revision, promise: operation };
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

export function isChatStorageResultForScope(
  scope: MessagingProjectionScope,
  result: ChatStorageResult,
): boolean {
  const snapshot = result.snapshot;
  const operation = result.operation;
  const operationMatches = !operation
    ? Boolean(result.error)
    : operation.scopeRevision === chatStorageScopeRevision(scope)
      && operation.scope?.stationPeerId === scope.stationPeerId
      && operation.scope.actorPtid === scope.actorPtid
      && operation.scope.deviceId === scope.deviceId;
  return Boolean(
    snapshot
    && isChatStorageSnapshotForScope(scope, snapshot)
    && operationMatches,
  );
}

export function chatStorageReleasedBytes(result: ChatStorageResult | null): bigint | null {
  const operation = result?.operation;
  if (!operation) return null;
  return operation.physicalBytesBefore > operation.physicalBytesAfter
    ? operation.physicalBytesBefore - operation.physicalBytesAfter
    : 0n;
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
      void mobileChatStorageProjectionRuntime.reconcile();
    },

    async suspend(): Promise<void> {
      // Measurement is bounded and read-only; the next resume refresh reconciles it.
    },

    async resume(): Promise<void> {
      void mobileChatStorageProjectionRuntime.reconcile();
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
