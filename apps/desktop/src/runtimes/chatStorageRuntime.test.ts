import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';

import {
  ChatStorageOperationState,
  ChatStorageResultSchema,
  ChatStorageSnapshotSchema,
} from '../gen/proto/domain/chat/storage_pb';
import {
  chatStorageReleasedBytes,
  chatStorageScopeRevision,
  isChatStorageResultForScope,
  isChatStorageSnapshotForScope,
  shouldRefreshChatStorageForPage,
} from './chatStorageRuntime';

const scope = {
  actorPtid: 'ptid:v1:actor:peers:p:alice:fingerprint',
  stationPeerId: 'station-one',
  profileId: 'profile-one',
  endpointId: 'device-one',
  activationGeneration: 7,
};

describe('chat storage runtime scope fencing', () => {
  it('accepts only the exact Station, actor, device, and generation revision', () => {
    const snapshot = create(ChatStorageSnapshotSchema, {
      scope: {
        stationPeerId: scope.stationPeerId,
        actorPtid: scope.actorPtid,
        deviceId: scope.endpointId,
      },
      revision: chatStorageScopeRevision(scope),
      measuredAtUnixMs: 1n,
    });

    expect(isChatStorageSnapshotForScope(scope, snapshot)).toBe(true);
    expect(isChatStorageSnapshotForScope(
      { ...scope, activationGeneration: 8 },
      snapshot,
    )).toBe(false);
    expect(isChatStorageSnapshotForScope(
      { ...scope, stationPeerId: 'station-two' },
      snapshot,
    )).toBe(false);
  });

  it('refreshes on active Settings visits but not idle prewarm', () => {
    expect(shouldRefreshChatStorageForPage('settings', 'activate')).toBe(true);
    expect(shouldRefreshChatStorageForPage('settings', 'prewarm')).toBe(false);
    expect(shouldRefreshChatStorageForPage('chat', 'activate')).toBe(false);
  });

  it('accepts cleanup results only for the exact scope and reports released bytes', () => {
    const result = create(ChatStorageResultSchema, {
      snapshot: {
        scope: {
          stationPeerId: scope.stationPeerId,
          actorPtid: scope.actorPtid,
          deviceId: scope.endpointId,
        },
        revision: chatStorageScopeRevision(scope),
      },
      operation: {
        scope: {
          stationPeerId: scope.stationPeerId,
          actorPtid: scope.actorPtid,
          deviceId: scope.endpointId,
        },
        scopeRevision: chatStorageScopeRevision(scope),
        state: ChatStorageOperationState.SUCCEEDED,
        physicalBytesBefore: 12_000n,
        physicalBytesAfter: 4_500n,
      },
    });

    expect(isChatStorageResultForScope(scope, result)).toBe(true);
    expect(isChatStorageResultForScope(
      { ...scope, activationGeneration: 8 },
      result,
    )).toBe(false);
    expect(chatStorageReleasedBytes(result)).toBe(7_500n);
  });
});
