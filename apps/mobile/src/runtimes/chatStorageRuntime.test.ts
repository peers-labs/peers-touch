import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';

import { ChatStorageSnapshotSchema } from '../gen/proto/domain/chat/storage_pb';
import {
  chatStorageScopeRevision,
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
});
