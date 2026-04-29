import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  accountGetDeviceId: vi.fn(),
  keyExchangeFetchBundle: vi.fn(),
  cryptoGroupSkEmitSkdm: vi.fn(),
  signalingEnvelopeSeal: vi.fn(),
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
      cryptoGroupSkEmitSkdm: mocks.cryptoGroupSkEmitSkdm,
      signalingEnvelopeSeal: mocks.signalingEnvelopeSeal,
      friendChatCreateSession: mocks.friendChatCreateSession,
      friendChatSendMessage: mocks.friendChatSendMessage,
    },
  };
});

import { ensureSkdmDistributed } from './groupSenderKeys';

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
    mocks.cryptoGroupSkEmitSkdm.mockResolvedValue({ skdm_b64: 'dummy-skdm' });
    mocks.signalingEnvelopeSeal.mockResolvedValue({ payload_b64: 'sealed' });
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
});
