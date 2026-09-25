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
} from './chatStorageRuntime';

const scope = {
  actorPtid: 'ptid:v1:actor:peers:p:alice:fingerprint',
  stationPeerId: 'station-one',
  profileId: 'profile-one',
  deviceId: 'device-one',
  activationGeneration: 7,
};

describe('mobile chat storage runtime scope fencing', () => {
  it('rejects old device and activation results', () => {
    const snapshot = create(ChatStorageSnapshotSchema, {
      scope: {
        stationPeerId: scope.stationPeerId,
        actorPtid: scope.actorPtid,
        deviceId: scope.deviceId,
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
      { ...scope, deviceId: 'device-two' },
      snapshot,
    )).toBe(false);
  });

  it('accepts cleanup results only for the exact scope and reports released bytes', () => {
    const result = create(ChatStorageResultSchema, {
      snapshot: {
        scope: {
          stationPeerId: scope.stationPeerId,
          actorPtid: scope.actorPtid,
          deviceId: scope.deviceId,
        },
        revision: chatStorageScopeRevision(scope),
      },
      operation: {
        scope: {
          stationPeerId: scope.stationPeerId,
          actorPtid: scope.actorPtid,
          deviceId: scope.deviceId,
        },
        scopeRevision: chatStorageScopeRevision(scope),
        state: ChatStorageOperationState.SUCCEEDED,
        physicalBytesBefore: 16_000n,
        physicalBytesAfter: 6_000n,
      },
    });

    expect(isChatStorageResultForScope(scope, result)).toBe(true);
    expect(isChatStorageResultForScope(
      { ...scope, deviceId: 'device-two' },
      result,
    )).toBe(false);
    expect(chatStorageReleasedBytes(result)).toBe(10_000n);
  });
});
