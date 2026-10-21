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
  chatStorageClearConversation,
  chatStorageSetRetention,
  chatStorageSnapshot,
} from '../services/mobileCommands';
import {
  currentMessagingProjectionScope,
  invalidateMessagingProjectionScopeForAcceptance,
  subscribeMessagingProjectionScope,
  type MessagingProjectionScope,
} from './messagingRuntime';

export type MobileChatStorageProjection = SharedChatStorageProjection<
  ChatStorageSnapshot,
  ChatStorageResult
>;
export type MobileChatStorageCleanupProjection =
  MobileChatStorageProjection['cleanup'];
export type MobileChatStorageRetentionProjection =
  MobileChatStorageProjection['retention'];
export type MobileChatStorageBatchAcceptanceScenario = SharedBatchScenario;

function scopeIdentity(
  scope: MessagingProjectionScope,
): ChatStorageScopeIdentity {
  return {
    stationPeerId: scope.stationPeerId,
    actorPtid: scope.actorPtid,
    deviceId: scope.deviceId,
    activationGeneration: scope.activationGeneration,
  };
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

export const mobileChatStorageProjectionRuntime =
  new ChatStorageProjectionRuntime<
    MessagingProjectionScope,
    ChatStorageSnapshot,
    NonNullable<ChatStorageResult['operation']>,
    ChatStorageResult,
    ChatRetentionPreset
  >({
    captureScope: currentMessagingProjectionScope,
    subscribeScope: subscribeMessagingProjectionScope,
    isCurrentScope: (scope) =>
      sameScope(scope, currentMessagingProjectionScope()),
    scopeIdentity,
    loadSnapshot: (scope, scopeRevision) => chatStorageSnapshot({
      stationPeerId: scope.stationPeerId,
      actorPtid: scope.actorPtid,
      deviceId: scope.deviceId,
      scopeRevision,
    }),
    clearCache: (scope, scopeRevision) => chatStorageClearCache({
      stationPeerId: scope.stationPeerId,
      actorPtid: scope.actorPtid,
      deviceId: scope.deviceId,
      scopeRevision,
    }),
    setRetention: (scope, scopeRevision, retentionPreset) =>
      chatStorageSetRetention({
        stationPeerId: scope.stationPeerId,
        actorPtid: scope.actorPtid,
        deviceId: scope.deviceId,
        scopeRevision,
        retentionPreset,
      }),
    clearConversation: (scope, scopeRevision, conversationId) =>
      chatStorageClearConversation({
        stationPeerId: scope.stationPeerId,
        actorPtid: scope.actorPtid,
        deviceId: scope.deviceId,
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
    invalidateScopeForAcceptance:
      invalidateMessagingProjectionScopeForAcceptance,
    messages: {
      staleCleanup: 'chat cache cleanup returned a stale scope',
      cleanupIncomplete: 'chat cache cleanup did not complete',
      staleRetention: 'chat retention returned a stale scope',
      retentionIncomplete: 'chat retention did not complete',
      staleConversationCleanup:
        'chat conversation cleanup returned a stale scope',
      acceptanceUnavailable:
        'mobile.chatStorage.acceptanceScenarioUnavailable',
      acceptanceAmbiguous:
        'mobile.chatStorage.acceptanceScenarioAmbiguous',
    },
  });

export function chatStorageScopeRevision(
  scope: MessagingProjectionScope,
): string {
  return sharedChatStorageScopeRevision(scopeIdentity(scope));
}

export function isChatStorageSnapshotForScope(
  scope: MessagingProjectionScope,
  snapshot: ChatStorageSnapshot,
): boolean {
  return chatStorageSnapshotMatches(scopeIdentity(scope), snapshot);
}

export function isChatStorageResultForScope(
  scope: MessagingProjectionScope,
  result: ChatStorageResult,
): boolean {
  return chatStorageResultMatches(scopeIdentity(scope), result);
}

export function chatStorageReleasedBytes(
  result: ChatStorageResult | null,
): bigint | null {
  return sharedChatStorageReleasedBytes(result);
}

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
      // Measurement is bounded and read-only; resume reconciles it.
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

export function useMobileChatStorageProjection():
MobileChatStorageProjection {
  return useSyncExternalStore(
    mobileChatStorageProjectionRuntime.subscribe,
    mobileChatStorageProjectionRuntime.getSnapshot,
    mobileChatStorageProjectionRuntime.getSnapshot,
  );
}
