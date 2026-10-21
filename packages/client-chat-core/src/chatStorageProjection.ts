import {
  runConversationClearBatch,
  type ConversationClearBatchProgress,
  type ConversationClearBatchResult,
} from './storageBatch.js';

export interface ChatStorageScopeIdentity {
  readonly stationPeerId: string;
  readonly actorPtid: string;
  readonly deviceId: string;
  readonly activationGeneration: number;
}

export interface ChatStorageSnapshotScopeLike {
  readonly stationPeerId?: string;
  readonly actorPtid?: string;
  readonly deviceId?: string;
}

export interface ChatStorageSnapshotLike {
  readonly revision?: string;
  readonly scope?: ChatStorageSnapshotScopeLike;
}

export interface ChatStorageOperationLike {
  readonly scopeRevision?: string;
  readonly scope?: ChatStorageSnapshotScopeLike;
  readonly physicalBytesBefore?: bigint;
  readonly physicalBytesAfter?: bigint;
}

export interface ChatStorageResultLike<
  Snapshot extends ChatStorageSnapshotLike,
  Operation extends ChatStorageOperationLike,
> {
  readonly snapshot?: Snapshot;
  readonly operation?: Operation;
  readonly error?: unknown;
}

export type ChatStorageActivityProjection<
  Result,
  Running extends 'clearing' | 'saving',
> =
  | {
      readonly status: 'idle' | Running;
      readonly result: null;
      readonly error: string | null;
    }
  | {
      readonly status: 'succeeded' | 'failed';
      readonly result: Result | null;
      readonly error: string | null;
    };

export interface ChatStorageProjection<Snapshot, Result> {
  readonly status: 'idle' | 'measuring' | 'ready' | 'stale' | 'unavailable';
  readonly snapshot: Snapshot | null;
  readonly stale: boolean;
  readonly error: string | null;
  readonly cleanup: ChatStorageActivityProjection<Result, 'clearing'>;
  readonly retention: ChatStorageActivityProjection<Result, 'saving'>;
}

export interface ChatStorageBatchAcceptanceScenario {
  readonly delayMs?: number;
  readonly failureConversationId?: string;
  readonly scopeChangeConversationId?: string;
}

export interface ChatStorageRuntimeMessages {
  readonly staleCleanup: string;
  readonly cleanupIncomplete: string;
  readonly staleRetention: string;
  readonly retentionIncomplete: string;
  readonly staleConversationCleanup: string;
  readonly acceptanceUnavailable: string;
  readonly acceptanceAmbiguous: string;
}

export interface ChatStorageRuntimePorts<
  Scope,
  Snapshot extends ChatStorageSnapshotLike,
  Operation extends ChatStorageOperationLike,
  Result extends ChatStorageResultLike<Snapshot, Operation>,
  Retention,
> {
  readonly captureScope: () => Scope | null;
  readonly subscribeScope: (listener: (scope: Scope | null) => void) => () => void;
  readonly isCurrentScope: (scope: Scope) => boolean;
  readonly scopeIdentity: (scope: Scope) => ChatStorageScopeIdentity;
  readonly loadSnapshot: (
    scope: Scope,
    scopeRevision: string,
  ) => Promise<Snapshot>;
  readonly clearCache: (
    scope: Scope,
    scopeRevision: string,
  ) => Promise<Result>;
  readonly setRetention: (
    scope: Scope,
    scopeRevision: string,
    retention: Retention,
  ) => Promise<Result>;
  readonly clearConversation: (
    scope: Scope,
    scopeRevision: string,
    conversationId: string,
  ) => Promise<Result>;
  readonly retentionPreset: (snapshot: Snapshot) => Retention | null;
  readonly retentionIsForever: (retention: Retention) => boolean;
  readonly operationSucceeded: (result: Result) => boolean;
  readonly acceptanceEnabled: () => boolean;
  readonly invalidateScopeForAcceptance: () => void | Promise<void>;
  readonly messages: ChatStorageRuntimeMessages;
  readonly now?: () => number;
  readonly reconcileIntervalMs?: number;
  readonly retentionSweepIntervalMs?: number;
}

const DEFAULT_RECONCILE_INTERVAL_MS = 5 * 60_000;
const DEFAULT_RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60_000;

export class ChatStorageProjectionRuntime<
  Scope,
  Snapshot extends ChatStorageSnapshotLike,
  Operation extends ChatStorageOperationLike,
  Result extends ChatStorageResultLike<Snapshot, Operation>,
  Retention,
> {
  private projection: ChatStorageProjection<Snapshot, Result> =
    idleChatStorageProjection();
  private readonly listeners = new Set<() => void>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private inFlight: { revision: string; promise: Promise<void> } | null = null;
  private cleanupInFlight: {
    revision: string;
    promise: Promise<Result | null>;
  } | null = null;
  private retentionInFlight: {
    revision: string;
    promise: Promise<Result | null>;
  } | null = null;
  private conversationClearInFlight: {
    revision: string;
    conversationId: string;
    promise: Promise<Result | null>;
  } | null = null;
  private batchAcceptanceScenario: ChatStorageBatchAcceptanceScenario | null =
    null;
  private unsubscribeScope: (() => void) | null = null;
  private lastRetentionSweepAtUnixMs = 0;

  constructor(
    private readonly ports: ChatStorageRuntimePorts<
      Scope,
      Snapshot,
      Operation,
      Result,
      Retention
    >,
  ) {}

  install(): void {
    if (this.interval !== null) return;
    this.unsubscribeScope = this.ports.subscribeScope((scope) => {
      this.lastRetentionSweepAtUnixMs = 0;
      this.publish(idleChatStorageProjection());
      if (scope) void this.refresh();
    });
    this.interval = globalThis.setInterval(
      () => void this.reconcile(),
      this.ports.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS,
    );
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
    this.conversationClearInFlight = null;
    this.batchAcceptanceScenario = null;
    this.lastRetentionSweepAtUnixMs = 0;
    this.publish(idleChatStorageProjection());
  }

  async bootstrap(active: boolean): Promise<void> {
    this.publish(idleChatStorageProjection());
    if (active) await this.reconcile();
  }

  refresh(): Promise<void> {
    const scope = this.ports.captureScope();
    if (!scope) {
      this.publish(idleChatStorageProjection());
      return Promise.resolve();
    }
    const revision = chatStorageScopeRevision(
      this.ports.scopeIdentity(scope),
    );
    if (this.inFlight?.revision === revision) return this.inFlight.promise;
    const currentSnapshot = this.projection.snapshot;
    const previous = currentSnapshot?.revision === revision
      ? currentSnapshot
      : null;
    this.publish({
      status: 'measuring',
      snapshot: previous,
      stale: previous !== null,
      error: null,
      cleanup: this.projection.cleanup,
      retention: this.projection.retention,
    });
    const operation = this.ports.loadSnapshot(scope, revision)
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
        if (!this.ports.isCurrentScope(scope)) return;
        const message = errorMessage(error);
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
    const snapshot = this.projection.snapshot;
    const preset = snapshot ? this.ports.retentionPreset(snapshot) : null;
    const now = (this.ports.now ?? Date.now)();
    if (
      preset !== null
      && !this.ports.retentionIsForever(preset)
      && this.projection.status === 'ready'
      && this.projection.retention.status !== 'saving'
      && now - this.lastRetentionSweepAtUnixMs
        >= (
          this.ports.retentionSweepIntervalMs
          ?? DEFAULT_RETENTION_SWEEP_INTERVAL_MS
        )
    ) {
      await this.setRetention(preset);
    }
  }

  clearCache(): Promise<Result | null> {
    const scope = this.ports.captureScope();
    if (!scope) return Promise.resolve(null);
    const revision = chatStorageScopeRevision(
      this.ports.scopeIdentity(scope),
    );
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
    const operation = this.ports.clearCache(scope, revision)
      .then((result) => {
        if (!this.ports.isCurrentScope(scope)) return null;
        if (!this.resultMatches(scope, result)) {
          this.publish({
            ...this.projection,
            cleanup: {
              status: 'failed',
              result: null,
              error: this.ports.messages.staleCleanup,
            },
          });
          return null;
        }
        const succeeded = this.ports.operationSucceeded(result);
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
              : resultErrorMessage(
                  result,
                  this.ports.messages.cleanupIncomplete,
                ),
          },
        });
        return result;
      })
      .catch((error: unknown) => {
        if (!this.ports.isCurrentScope(scope)) return null;
        this.publish({
          ...this.projection,
          cleanup: {
            status: 'failed',
            result: null,
            error: errorMessage(error),
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

  setRetention(retention: Retention): Promise<Result | null> {
    const scope = this.ports.captureScope();
    if (!scope) return Promise.resolve(null);
    const revision = chatStorageScopeRevision(
      this.ports.scopeIdentity(scope),
    );
    if (this.retentionInFlight?.revision === revision) {
      return this.retentionInFlight.promise;
    }
    this.publish({
      ...this.projection,
      retention: { status: 'saving', result: null, error: null },
    });
    const operation = this.ports.setRetention(scope, revision, retention)
      .then((result) => {
        if (!this.ports.isCurrentScope(scope)) return null;
        if (!this.resultMatches(scope, result)) {
          this.publish({
            ...this.projection,
            retention: {
              status: 'failed',
              result: null,
              error: this.ports.messages.staleRetention,
            },
          });
          return null;
        }
        const succeeded = this.ports.operationSucceeded(result);
        if (succeeded) {
          this.lastRetentionSweepAtUnixMs =
            (this.ports.now ?? Date.now)();
        }
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
              : resultErrorMessage(
                  result,
                  this.ports.messages.retentionIncomplete,
                ),
          },
        });
        return result;
      })
      .catch((error: unknown) => {
        if (!this.ports.isCurrentScope(scope)) return null;
        this.publish({
          ...this.projection,
          retention: {
            status: 'failed',
            result: null,
            error: errorMessage(error),
          },
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

  clearConversation(conversationId: string): Promise<Result | null> {
    const scope = this.ports.captureScope();
    if (!scope || !conversationId.trim()) return Promise.resolve(null);
    const revision = chatStorageScopeRevision(
      this.ports.scopeIdentity(scope),
    );
    if (
      this.conversationClearInFlight?.revision === revision
      && this.conversationClearInFlight.conversationId === conversationId
    ) {
      return this.conversationClearInFlight.promise;
    }
    const operation = this.ports
      .clearConversation(scope, revision, conversationId)
      .then((result) => {
        if (!this.ports.isCurrentScope(scope)) return null;
        if (!this.resultMatches(scope, result)) {
          throw new Error(this.ports.messages.staleConversationCleanup);
        }
        if (result.snapshot) {
          this.publish({
            status: 'ready',
            snapshot: result.snapshot,
            stale: false,
            error: null,
            cleanup: this.projection.cleanup,
            retention: this.projection.retention,
          });
        }
        return result;
      })
      .finally(() => {
        if (this.conversationClearInFlight?.promise === operation) {
          this.conversationClearInFlight = null;
        }
      });
    this.conversationClearInFlight = {
      revision,
      conversationId,
      promise: operation,
    };
    return operation;
  }

  clearConversations(
    conversationIds: readonly string[],
    onProgress?: (progress: ConversationClearBatchProgress) => void,
  ): Promise<ConversationClearBatchResult> {
    const scope = this.ports.captureScope();
    return runConversationClearBatch({
      conversationIds,
      onProgress,
      clearConversation: async (conversationId) => {
        if (!scope || !this.ports.isCurrentScope(scope)) {
          return { state: 'scope_changed' };
        }
        const scenario = this.batchAcceptanceScenario;
        if (scenario?.delayMs) {
          await new Promise((resolve) => {
            globalThis.setTimeout(resolve, scenario.delayMs);
          });
        }
        if (scenario?.failureConversationId === conversationId) {
          this.batchAcceptanceScenario = null;
          return { state: 'failed' };
        }
        if (scenario?.scopeChangeConversationId === conversationId) {
          this.batchAcceptanceScenario = null;
          await this.ports.invalidateScopeForAcceptance();
          return { state: 'scope_changed' };
        }
        const result = await this.clearConversation(conversationId);
        if (!this.ports.isCurrentScope(scope)) {
          return { state: 'scope_changed' };
        }
        if (!result || !this.ports.operationSucceeded(result)) {
          return { state: 'failed' };
        }
        return {
          state: 'succeeded',
          releasedBytes: chatStorageReleasedBytes(result) ?? 0n,
        };
      },
    });
  }

  configureAcceptanceBatchScenario(
    scenario: ChatStorageBatchAcceptanceScenario | null,
  ): void {
    if (!this.ports.acceptanceEnabled()) {
      throw new Error(this.ports.messages.acceptanceUnavailable);
    }
    if (scenario === null) {
      this.batchAcceptanceScenario = null;
      return;
    }
    const delayMs = Math.max(0, Math.min(2_000, scenario.delayMs ?? 0));
    const failureConversationId =
      scenario.failureConversationId?.trim() || undefined;
    const scopeChangeConversationId =
      scenario.scopeChangeConversationId?.trim() || undefined;
    if (failureConversationId && scopeChangeConversationId) {
      throw new Error(this.ports.messages.acceptanceAmbiguous);
    }
    this.batchAcceptanceScenario = {
      delayMs,
      failureConversationId,
      scopeChangeConversationId,
    };
  }

  getSnapshot = (): ChatStorageProjection<Snapshot, Result> =>
    this.projection;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private accepts(scope: Scope, snapshot: Snapshot): boolean {
    return this.ports.isCurrentScope(scope)
      && chatStorageSnapshotMatches(
        this.ports.scopeIdentity(scope),
        snapshot,
      );
  }

  private resultMatches(scope: Scope, result: Result): boolean {
    return chatStorageResultMatches(
      this.ports.scopeIdentity(scope),
      result,
    );
  }

  private publish(projection: ChatStorageProjection<Snapshot, Result>): void {
    this.projection = Object.freeze(projection);
    this.listeners.forEach((listener) => listener());
  }
}

export function chatStorageScopeRevision(
  scope: ChatStorageScopeIdentity,
): string {
  return [
    scope.stationPeerId,
    scope.actorPtid,
    scope.deviceId,
    scope.activationGeneration,
  ].join('\u001f');
}

export function chatStorageSnapshotMatches(
  scope: ChatStorageScopeIdentity,
  snapshot: ChatStorageSnapshotLike,
): boolean {
  return Boolean(
    snapshot.revision === chatStorageScopeRevision(scope)
    && snapshot.scope?.stationPeerId === scope.stationPeerId
    && snapshot.scope.actorPtid === scope.actorPtid
    && snapshot.scope.deviceId === scope.deviceId,
  );
}

export function chatStorageResultMatches<
  Snapshot extends ChatStorageSnapshotLike,
  Operation extends ChatStorageOperationLike,
>(
  scope: ChatStorageScopeIdentity,
  result: ChatStorageResultLike<Snapshot, Operation>,
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
    && chatStorageSnapshotMatches(scope, snapshot)
    && operationMatches,
  );
}

export function chatStorageReleasedBytes<
  Snapshot extends ChatStorageSnapshotLike,
  Operation extends ChatStorageOperationLike,
>(
  result: ChatStorageResultLike<Snapshot, Operation> | null,
): bigint | null {
  const operation = result?.operation;
  if (
    !operation
    || operation.physicalBytesBefore === undefined
    || operation.physicalBytesAfter === undefined
  ) {
    return null;
  }
  return operation.physicalBytesBefore > operation.physicalBytesAfter
    ? operation.physicalBytesBefore - operation.physicalBytesAfter
    : 0n;
}

function idleChatStorageProjection<Snapshot, Result>():
ChatStorageProjection<Snapshot, Result> {
  return Object.freeze({
    status: 'idle',
    snapshot: null,
    stale: false,
    error: null,
    cleanup: Object.freeze({
      status: 'idle',
      result: null,
      error: null,
    }),
    retention: Object.freeze({
      status: 'idle',
      result: null,
      error: null,
    }),
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resultErrorMessage<
  Snapshot extends ChatStorageSnapshotLike,
  Operation extends ChatStorageOperationLike,
>(
  result: ChatStorageResultLike<Snapshot, Operation>,
  fallback: string,
): string {
  const error = result.error;
  if (
    error
    && typeof error === 'object'
    && 'message' in error
    && typeof error.message === 'string'
    && error.message
  ) {
    return error.message;
  }
  return fallback;
}
