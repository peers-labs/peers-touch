import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create, toBinary } from '@bufbuild/protobuf';
import { SenderKeyDistributionMessageSchema } from '../../gen/proto/domain/chat/group_chat_pb';
import { ensureSkdmDistributed, handleInboundSkdm } from './groupSenderKeys';

const mocks = vi.hoisted(() => ({
  accountGetDeviceId: vi.fn(),
  keyExchangeFetchBundle: vi.fn(),
  signalingEnvelopeOpen: vi.fn(),
  cryptoGroupSkEmitSkdm: vi.fn(),
  cryptoGroupSkConsumeSkdm: vi.fn(),
  signalingEnvelopeSeal: vi.fn(),
  groupChatSubmitSkdmEnvelope: vi.fn(),
  friendChatCreateSession: vi.fn(),
  friendChatSendMessage: vi.fn(),
}));

vi.mock('../../services/desktop_api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/desktop_api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      accountGetDeviceId: mocks.accountGetDeviceId,
      keyExchangeFetchBundle: mocks.keyExchangeFetchBundle,
        signalingEnvelopeOpen: mocks.signalingEnvelopeOpen,
      cryptoGroupSkEmitSkdm: mocks.cryptoGroupSkEmitSkdm,
        cryptoGroupSkConsumeSkdm: mocks.cryptoGroupSkConsumeSkdm,
      signalingEnvelopeSeal: mocks.signalingEnvelopeSeal,
      groupChatSubmitSkdmEnvelope: mocks.groupChatSubmitSkdmEnvelope,
      friendChatCreateSession: mocks.friendChatCreateSession,
      friendChatSendMessage: mocks.friendChatSendMessage,
    },
  };
});

describe('ensureSkdmDistributed (multi-device bundles)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
      clear: () => mem.clear(),
      key: () => null,
      get length() {
        return mem.size;
      },
    } as Storage);
    mocks.accountGetDeviceId.mockResolvedValue({ device_id: 'device-self' });
    mocks.cryptoGroupSkEmitSkdm.mockResolvedValue({ skdm_b64: 'dummy-skdm', sender_key_id: 7 });
    mocks.cryptoGroupSkConsumeSkdm.mockResolvedValue({
      group_ulid: 'group-1',
      sender_did: 'did:peer:alice',
      sender_key_id: 7,
    });
    mocks.signalingEnvelopeSeal.mockResolvedValue({ payload_b64: 'sealed' });
    mocks.signalingEnvelopeOpen.mockResolvedValue({ plaintext: skdmB64('group-1', 'did:peer:alice', 7) });
    mocks.groupChatSubmitSkdmEnvelope.mockResolvedValue({ outboxUlid: 'gcskdm-1', status: 'pending' });
    mocks.friendChatCreateSession.mockResolvedValue({ session: { ulid: 'sess' } });
    mocks.friendChatSendMessage.mockResolvedValue({});
  });

  it('fans out one SKDM per recipient bundle, skipping only the local device_id', async () => {
    const actor = 'did:peer:alice';
    mocks.keyExchangeFetchBundle.mockImplementation(async (did: string) => {
      if (did === actor) {
        return {
          bundles: [
            {
              did: actor,
              device_id: 'device-self',
              ik_pub: 'ik-self',
              spk_pub: 'spk',
              spk_sig: 'sig',
              opks: [],
              published_at_unix_ms: 2,
            },
            {
              did: actor,
              device_id: 'device-other',
              ik_pub: 'ik-other',
              spk_pub: 'spk',
              spk_sig: 'sig',
              opks: [],
              published_at_unix_ms: 1,
            },
          ],
        };
      }
      return { bundles: [] };
    });

    await ensureSkdmDistributed(actor, 'group-1', [actor]);

    expect(mocks.keyExchangeFetchBundle).toHaveBeenCalledWith(actor);
    expect(mocks.signalingEnvelopeSeal).toHaveBeenCalledTimes(1);
    expect(mocks.signalingEnvelopeSeal).toHaveBeenCalledWith(
      'ik-other',
      expect.any(String),
      expect.anything(),
      'dummy-skdm',
    );
    expect(mocks.friendChatSendMessage).toHaveBeenCalledTimes(1);
  });

  it('submits sealed SKDM envelope to Station when member home station metadata is available', async () => {
    const actor = 'did:peer:alice';
    const peer = 'did:peer:bob';
    mocks.keyExchangeFetchBundle.mockResolvedValue({
      bundles: [
        {
          did: peer,
          device_id: 'bob-device-1',
          ik_pub: 'ik-bob',
          spk_pub: 'spk',
          spk_sig: 'sig',
          opks: [],
          published_at_unix_ms: 1,
        },
      ],
    });

    await ensureSkdmDistributed(actor, 'group-1', [peer], {
      membershipEpoch: 3,
      members: [{ actorDid: peer, actorHomeStationPeerId: 'station-b' }],
    });

    expect(mocks.groupChatSubmitSkdmEnvelope).toHaveBeenCalledWith({
      groupUlid: 'group-1',
      membershipEpoch: 3,
      senderDid: actor,
      senderKeyId: 7,
      recipientDid: peer,
      recipientDeviceId: 'bob-device-1',
      recipientHomeStationPeerId: 'station-b',
      encryptedPayload: 'sealed',
      idempotencyKey: `group-1:${actor}:7:${peer}:bob-device-1`,
    });
    expect(mocks.friendChatSendMessage).toHaveBeenCalledTimes(1);
  });
});

  describe('handleInboundSkdm', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mocks.keyExchangeFetchBundle.mockResolvedValue({
        bundles: [{ did: 'did:peer:alice', device_id: 'alice-device-1', ik_pub: 'ik-alice' }],
      });
      mocks.signalingEnvelopeOpen.mockResolvedValue({ plaintext: skdmB64('group-1', 'did:peer:alice', 7) });
      mocks.cryptoGroupSkConsumeSkdm.mockResolvedValue({
        group_ulid: 'group-1',
        sender_did: 'did:peer:alice',
        sender_key_id: 7,
      });
    });

    it('installs only after opened SKDM metadata matches the delivery envelope', async () => {
      await handleInboundSkdm('did:peer:alice', 'sealed', { groupUlid: 'group-1', senderKeyId: 7 });

      expect(mocks.cryptoGroupSkConsumeSkdm).toHaveBeenCalledWith(
        'did:peer:alice',
        skdmB64('group-1', 'did:peer:alice', 7),
      );
    });

    it('rejects opened SKDM when group metadata does not match the delivery envelope', async () => {
      await handleInboundSkdm('did:peer:alice', 'sealed', { groupUlid: 'group-2', senderKeyId: 7 });

      expect(mocks.cryptoGroupSkConsumeSkdm).not.toHaveBeenCalled();
    });
  });

  function skdmB64(groupUlid: string, senderDid: string, senderKeyId: number): string {
    const skdm = create(SenderKeyDistributionMessageSchema, {
      groupUlid,
      senderDid,
      senderKeyId,
      chainKey: new Uint8Array([1, 2, 3]),
      counter: 0,
      senderSigPub: new Uint8Array([4, 5, 6]),
    });
    return Buffer.from(toBinary(SenderKeyDistributionMessageSchema, skdm)).toString('base64');
  }
