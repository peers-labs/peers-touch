// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
const notifyReliabilityCommandChangedMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));
vi.mock('../runtimes/commandRuntime', () => ({
  notifyReliabilityCommandChanged: notifyReliabilityCommandChangedMock,
}));

import {
  bindMobileMutationAdmission,
  bindMobileSessionMutationAdmission,
  mobileMutationScopeKey,
} from '../runtimes/mutationAdmission';
import {
  socialFriendRequestAccept,
  socialFriendRequestReject,
  socialFriendRequestSend,
} from '../services/mobileCommands';

const account = {
  stationPeerId: 'station-a',
  actorPtid: 'ptid:alice',
  deviceId: 'device-a',
  lifecycleGeneration: 1,
};
const scopeKey = mobileMutationScopeKey(
  account.stationPeerId,
  account.actorPtid,
  account.deviceId,
  account.lifecycleGeneration,
);
const decision = {
  ...account,
  requestId: 'request-1',
  senderPtid: 'ptid:bob',
  receiverPtid: 'ptid:alice',
  senderHomeStationPeerId: 'station-b',
  receiverHomeStationPeerId: 'station-a',
  federationId: 'federation-1',
};

let releaseMutation: (() => void) | null = null;
let releaseSession: (() => void) | null = null;

beforeEach(() => {
  invokeMock.mockReset();
  notifyReliabilityCommandChangedMock.mockReset();
  releaseSession = bindMobileSessionMutationAdmission(() => ({
    scopeKey,
    open: true,
    reason: 'session_active',
  }));
  releaseMutation = bindMobileMutationAdmission(
    scopeKey,
    () => ({
      lifecycle: 'active',
      staleness: {
        social: { stale: false },
        group: { stale: false },
        moments: { stale: false },
        notification: { stale: false },
        profile: { stale: false },
        control: { stale: false },
      },
      writeAdmission: { open: true },
    }),
  );
});

afterEach(() => {
  releaseMutation?.();
  releaseMutation = null;
  releaseSession?.();
  releaseSession = null;
});

describe('Friend Request checkpoint ownership', () => {
  const actions = [
    [
      socialFriendRequestSend,
      {
        ...account,
        receiverPtid: 'ptid:bob',
        receiverHomeStationPeerId: 'station-b',
        federationId: 'federation-1',
        message: 'hello',
      },
    ],
    [socialFriendRequestAccept, decision],
    [socialFriendRequestReject, decision],
  ] as const;

  it.each(actions)(
    'leaves a ready checkpoint to the foreground projection owner',
    async (action, input) => {
      invokeMock.mockResolvedValue({
        commandId: 'command-1',
        requestId: 'request-1',
        payloadSha256: [1, 2, 3],
        state: 'committed',
        checkpointReady: true,
      });

      await action(input);

      expect(notifyReliabilityCommandChangedMock).not.toHaveBeenCalled();
    },
  );

  it.each(actions)(
    'wakes background recovery when no projection checkpoint is ready',
    async (action, input) => {
      invokeMock.mockResolvedValue({
        commandId: 'command-1',
        requestId: 'request-1',
        payloadSha256: [1, 2, 3],
        state: 'unknown-outcome',
        checkpointReady: false,
      });

      await action(input);

      expect(notifyReliabilityCommandChangedMock).toHaveBeenCalledOnce();
    },
  );
});
