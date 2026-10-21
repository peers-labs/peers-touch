import assert from 'node:assert/strict';

import {
  ChatStorageProjectionRuntime,
  chatStorageReleasedBytes,
  chatStorageResultMatches,
  chatStorageScopeRevision,
  chatStorageSnapshotMatches,
  clientWireBytes,
  clientWireEnumNumber,
  clientWireTimestampIso,
  resolveChatComposerCapabilities,
} from '../dist/index.js';

const scope = {
  stationPeerId: 'station-one',
  actorPtid: 'ptid:alice',
  deviceId: 'device-one',
  activationGeneration: 3,
};
const revision = chatStorageScopeRevision(scope);
const snapshot = {
  revision,
  scope: {
    stationPeerId: scope.stationPeerId,
    actorPtid: scope.actorPtid,
    deviceId: scope.deviceId,
  },
  retentionPolicy: { retentionPreset: 1 },
};
const result = {
  snapshot,
  operation: {
    scopeRevision: revision,
    scope: snapshot.scope,
    state: 'succeeded',
    physicalBytesBefore: 8_000n,
    physicalBytesAfter: 2_500n,
  },
};

assert.equal(chatStorageSnapshotMatches(scope, snapshot), true);
assert.equal(chatStorageResultMatches(scope, result), true);
assert.equal(chatStorageReleasedBytes(result), 5_500n);
assert.equal(
  chatStorageSnapshotMatches(
    { ...scope, activationGeneration: 4 },
    snapshot,
  ),
  false,
);

let activeScope = scope;
const runtime = new ChatStorageProjectionRuntime({
  captureScope: () => activeScope,
  subscribeScope: () => () => {},
  isCurrentScope: (candidate) => candidate === activeScope,
  scopeIdentity: (candidate) => candidate,
  loadSnapshot: async () => snapshot,
  clearCache: async () => result,
  setRetention: async () => result,
  clearConversation: async () => result,
  retentionPreset: (value) => value.retentionPolicy.retentionPreset,
  retentionIsForever: (preset) => preset === 1,
  operationSucceeded: (value) => value.operation?.state === 'succeeded',
  acceptanceEnabled: () => false,
  invalidateScopeForAcceptance: () => {
    activeScope = null;
  },
  messages: {
    staleCleanup: 'stale cleanup',
    cleanupIncomplete: 'cleanup incomplete',
    staleRetention: 'stale retention',
    retentionIncomplete: 'retention incomplete',
    staleConversationCleanup: 'stale conversation cleanup',
    acceptanceUnavailable: 'acceptance unavailable',
    acceptanceAmbiguous: 'acceptance ambiguous',
  },
});

await runtime.refresh();
assert.equal(runtime.getSnapshot().status, 'ready');
assert.equal(runtime.getSnapshot().snapshot?.revision, revision);
await runtime.clearCache();
assert.equal(runtime.getSnapshot().cleanup.status, 'succeeded');

assert.deepEqual(
  resolveChatComposerCapabilities(
    { emoji: true, file: true },
    { file: false, voice: true },
  ),
  {
    emoji: true,
    file: false,
    screenshot: false,
    voice: true,
  },
);
assert.equal(
  clientWireEnumNumber('STATUS_READY', { STATUS_READY: 2 }),
  2,
);
assert.equal(
  clientWireTimestampIso({ seconds: 1_700_000_000n, nanos: 0 }),
  '2023-11-14T22:13:20.000Z',
);
assert.deepEqual(
  [...clientWireBytes('AQID')],
  [1, 2, 3],
);
