// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create, toBinary } from '@bufbuild/protobuf';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));
vi.mock('../runtimes/commandRuntime', () => ({
  notifyReliabilityCommandChanged: vi.fn(),
}));

import {
  bindMobileMutationAdmission,
  bindMobileSessionMutationAdmission,
} from '../runtimes/mutationAdmission';
import type {
  IngressState,
  ProjectionStaleness,
  SocialIngressDomain,
  WriteAdmission,
} from '../runtimes/socialEventIngress';
import {
  ImageAttachmentSchema,
} from '../gen/proto/domain/social/post_pb';
import {
  discardNativeMomentMedia,
  messagingCreateDirect,
  messagingCreateGroup,
  messagingSendMessage,
  messagingTransferOwnership,
  messagingUpdateMemberAuthority,
  uploadNativeMomentMedia,
} from './mobileCommands';

interface MutableAdmissionState {
  lifecycle: IngressState['lifecycle'];
  staleness: Record<SocialIngressDomain, ProjectionStaleness>;
  writeAdmission: WriteAdmission;
}

const account = {
  stationPeerId: 'station-a',
  actorPtid: 'ptid:alice',
  deviceId: 'device-a',
  lifecycleGeneration: 1,
};

let admission: MutableAdmissionState;
let release: (() => void) | null = null;
let releaseSession: (() => void) | null = null;

beforeEach(() => {
  admission = activeAdmission();
  releaseSession = bindMobileSessionMutationAdmission(() => ({
    scopeKey: 'station-a|ptid:alice|device-a|1',
    open: true,
    reason: 'session_active',
  }));
  release = bindMobileMutationAdmission(
    'station-a|ptid:alice|device-a|1',
    () => admission,
  );
  invokeMock.mockReset().mockResolvedValue({});
});

afterEach(() => {
  release?.();
  release = null;
  releaseSession?.();
  releaseSession = null;
});

describe('Mobile command mutation admission', () => {
  it('blocks a stale fixed domain before invoking the Device Messaging Engine', async () => {
    admission.staleness.group = {
      stale: true,
      reason: 'data_capacity_overflow',
      since: 10,
    };

    await expect(messagingCreateGroup({
      ...account,
      conversationId: 'conversation-1',
      name: 'Group',
      memberPtids: ['ptid:bob'],
      federationId: 'federation-1',
    })).rejects.toMatchObject({
      code: 'MOBILE_WRITE_ADMISSION_CLOSED',
      reason: 'group:data_capacity_overflow',
    });
    await expect(messagingCreateDirect({
      ...account,
      peerPtid: 'ptid:bob',
      federationId: 'federation-1',
    })).resolves.toEqual({});
    expect(invokeMock).toHaveBeenCalledOnce();
  });

  it('blocks generic Messaging writes while global admission is closed', async () => {
    admission.writeAdmission = {
      open: false,
      reason: 'runtime_suspended',
      closedAt: 10,
    };

    await expect(messagingSendMessage({
      ...account,
      conversationId: 'conversation-1',
      plaintext: 'hello',
    })).rejects.toMatchObject({
      code: 'MOBILE_WRITE_ADMISSION_CLOSED',
      reason: 'runtime_suspended',
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('invokes only the native member-authority commands with typed input', async () => {
    invokeMock.mockResolvedValue({ state: 'projected' });

    await messagingUpdateMemberAuthority({
      ...account,
      conversationId: 'conversation-1',
      targetPtid: 'ptid:bob',
      role: 'admin',
      muted: true,
      mutedUntilUnixMs: 84,
    });
    await messagingTransferOwnership({
      ...account,
      conversationId: 'conversation-1',
      nextOwnerPtid: 'ptid:bob',
    });

    expect(invokeMock.mock.calls).toEqual([
      [
        'messaging_update_member_authority',
        {
          input: {
            ...account,
            conversationId: 'conversation-1',
            targetPtid: 'ptid:bob',
            role: 'admin',
            muted: true,
            mutedUntilUnixMs: 84,
          },
        },
      ],
      [
        'messaging_transfer_ownership',
        {
          input: {
            ...account,
            conversationId: 'conversation-1',
            nextOwnerPtid: 'ptid:bob',
          },
        },
      ],
    ]);
  });

  it('uploads and discards Moments media using only an opaque native handle', async () => {
    const attachment = create(ImageAttachmentSchema, {
      id: 'oss://self/cas/image',
      url: 'oss://self/cas/image',
      sizeBytes: 14n,
    });
    invokeMock
      .mockResolvedValueOnce(Array.from(toBinary(ImageAttachmentSchema, attachment)))
      .mockResolvedValueOnce(undefined);
    const input = {
      ...account,
      sessionId: 'session-a',
      handle: '01K5K8F4T7Q7SYN5TGDRZ1Q9XH',
    };

    await expect(uploadNativeMomentMedia(input)).resolves.toEqual(attachment);
    await expect(discardNativeMomentMedia(input)).resolves.toBeUndefined();

    expect(invokeMock.mock.calls).toEqual([
      ['moment_media_upload', { input }],
      ['moment_media_discard', { input }],
    ]);
    expect(JSON.stringify(invokeMock.mock.calls)).not.toMatch(
      /body_bytes|local_path|access_token|ciphertext|plaintext/i,
    );
  });
});

function activeAdmission(): MutableAdmissionState {
  return {
    lifecycle: 'active',
    writeAdmission: { open: true },
    staleness: {
      social: { stale: false },
      group: { stale: false },
      moments: { stale: false },
      notification: { stale: false },
      profile: { stale: false },
      control: { stale: false },
    },
  };
}
