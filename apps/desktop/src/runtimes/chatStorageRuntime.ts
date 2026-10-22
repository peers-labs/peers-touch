import { useSyncExternalStore } from 'react';
import {
  ChatStorageProjectionRuntime,
  chatStorageReleasedBytes as sharedChatStorageReleasedBytes,
  chatStorageResultMatches,
  chatStorageScopeRevision as sharedChatStorageScopeRevision,
  chatStorageSnapshotMatches,
  type ChatStorageBatchAcceptanceScenario as SharedBatchScenario,
  type ChatStorageProjection as SharedChatStorageProjection,
  type ChatStorageScopeIdentity,
} from '@peers-touch/client-chat-core';

import {
  ChatRetentionPreset,
  ChatStorageOperationKind,
  ChatStorageOperationState,
} from '../gen/proto/domain/chat/storage_pb';
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

export type ChatStorageProjection = SharedChatStorageProjection<
  ChatStorageSnapshot,
  ChatStorageResult
>;
export type ChatStorageCleanupProjection =
  ChatStorageProjection['cleanup'];
export type ChatStorageRetentionProjection =
  ChatStorageProjection['retention'];
export type ChatStorageBatchAcceptanceScenario = SharedBatchScenario;

function scopeIdentity(scope: MessagingRuntimeScope): ChatStorageScopeIdentity {
  return {
    stationPeerId: scope.stationPeerId,
    actorPtid: scope.actorPtid,
    deviceId: scope.endpointId,
    activationGeneration: scope.activationGeneration,
  };
}

export const chatStorageProjectionRuntime =
  new ChatStorageProjectionRuntime<
    MessagingRuntimeScope,
    ChatStorageSnapshot,
    NonNullable<ChatStorageResult['operation']>,
    ChatStorageResult,
    ChatRetentionPreset
  >({
    captureScope: () => messagingDomainRuntime.captureScope(),
    subscribeScope: (listener) =>
      messagingDomainRuntime.subscribeScope(listener),
    isCurrentScope: (scope) => messagingDomainRuntime.isCurrent(scope),
    scopeIdentity,
    loadSnapshot: (scope, scopeRevision) => api.chatStorageSnapshot({
      stationPeerId: scope.stationPeerId,
      actorPtid: scope.actorPtid,
      deviceId: scope.endpointId,
      scopeRevision,
    }),
    clearCache: (scope, scopeRevision) => api.chatStorageClearCache({
      stationPeerId: scope.stationPeerId,
      actorPtid: scope.actorPtid,
      deviceId: scope.endpointId,
      scopeRevision,
    }),
    setRetention: (scope, scopeRevision, retentionPreset) =>
      api.chatStorageSetRetention({
        stationPeerId: scope.stationPeerId,
        actorPtid: scope.actorPtid,
        deviceId: scope.endpointId,
        scopeRevision,
        retentionPreset,
      }),
    clearConversation: (scope, scopeRevision, conversationId) =>
      api.chatStorageClearConversation({
        stationPeerId: scope.stationPeerId,
        actorPtid: scope.actorPtid,
        deviceId: scope.endpointId,
        scopeRevision,
        conversationId,
      }),
    retentionPreset: (snapshot) => {
      const preset = snapshot.retentionPolicy?.retentionPreset;
      return preset ? preset as ChatRetentionPreset : null;
    },
    retentionIsForever: (preset) =>
      preset === ChatRetentionPreset.CHAT_RETENTION_PRESET_FOREVER,
    operationSucceeded: (result) => (
      !result.error
      && result.operation?.state === ChatStorageOperationState.SUCCEEDED
    ),
    acceptanceEnabled: () =>
      import.meta.env.VITE_ACCEPTANCE_HARNESS === '1',
    invalidateScopeForAcceptance: () => messagingDomainRuntime.teardown(),
    messages: {
      staleCleanup: 'chat cache cleanup returned a stale scope',
      cleanupIncomplete: 'chat cache cleanup did not complete',
      staleRetention: 'chat retention returned a stale scope',
      retentionIncomplete: 'chat retention did not complete',
      staleConversationCleanup:
        'chat conversation cleanup returned a stale scope',
      acceptanceUnavailable:
        'chat_storage_acceptance_scenario_unavailable',
      acceptanceAmbiguous: 'chat_storage_acceptance_scenario_ambiguous',
    },
  });

export function chatStorageScopeRevision(
  scope: MessagingRuntimeScope,
): string {
  return sharedChatStorageScopeRevision(scopeIdentity(scope));
}

export function isChatStorageSnapshotForScope(
  scope: MessagingRuntimeScope,
  snapshot: ChatStorageSnapshot,
): boolean {
  return chatStorageSnapshotMatches(scopeIdentity(scope), snapshot);
}

export function isChatStorageResultForScope(
  scope: MessagingRuntimeScope,
  result: ChatStorageResult,
): boolean {
  return chatStorageResultMatches(scopeIdentity(scope), result);
}

export function chatStorageReleasedBytes(
  result: ChatStorageResult | null,
): bigint | null {
  return sharedChatStorageReleasedBytes(result);
}

export function isConversationClearProjectionCommitted(
  result: ChatStorageResult | null,
): boolean {
  const operation = result?.operation;
  if (operation?.kind !== ChatStorageOperationKind.CLEAR_CONVERSATION) return false;
  return operation.state === ChatStorageOperationState.DELETING_FILES
    || operation.state === ChatStorageOperationState.COMPACTING
    || operation.state === ChatStorageOperationState.COMPACTION_PENDING
    || operation.state === ChatStorageOperationState.PAUSED_SCOPE_INACTIVE
    || operation.state === ChatStorageOperationState.SUCCEEDED
    || operation.state === ChatStorageOperationState.FAILED_RETRYABLE
    || operation.state === ChatStorageOperationState.FAILED_TERMINAL;
}

export function shouldRefreshChatStorageForPage(
  pageId: string,
  reason: RuntimePageAcquireReason,
): boolean {
  return pageId === 'settings' && reason === 'activate';
}

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
    return chatStorageProjectionRuntime.bootstrap(Boolean(actorPtid));
  },
  reconcile(): Promise<void> {
    return chatStorageProjectionRuntime.reconcile();
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
