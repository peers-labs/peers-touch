import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MobileAuthSession } from '../auth/authSession';

const mocks = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  let scope = '';
  return {
    values,
    setScope(nextScope: string) {
      scope = nextScope;
    },
    readValue: vi.fn(async (key: string) => values.get(`${scope}|${key}`) ?? null),
    write: vi.fn(async (key: string, value: unknown) => {
      values.set(`${scope}|${key}`, value);
    }),
    remove: vi.fn(async (key: string) => {
      values.delete(`${scope}|${key}`);
    }),
  };
});

vi.mock('../../storage/mobileClientStorage', () => ({
  createMobileActorStorageRuntime: (stationPeerId: string, ptid: string) => {
    mocks.setScope(`${stationPeerId}|${ptid}`);
    return {
      repositories: {
        messageFlags: {
          readValue: mocks.readValue,
          write: mocks.write,
          remove: mocks.remove,
        },
      },
    };
  },
}));

import {
  loadDeviceLocalMessageFlags,
  messageFlagStateTestContract,
  setDeviceLocalMessageFlag,
} from './messageFlagState';

const session = (
  stationPeerId: string,
  ptid: string,
): MobileAuthSession => ({
  stationPeerId,
  stationUrl: 'https://station.example',
  sessionId: 'session',
  deviceId: 'device-a',
  lifecycleGeneration: 1,
  actorRef: { ptid },
  authenticatedAt: 1,
});

describe('device-local message flag state', () => {
  beforeEach(() => {
    mocks.values.clear();
    vi.clearAllMocks();
  });

  it('persists and removes a message flag in the actor and Station scope', async () => {
    const active = session('station-a', 'ptid:alice');

    await expect(setDeviceLocalMessageFlag(
      active,
      'friend',
      'conversation-1',
      'message-1',
      true,
    )).resolves.toEqual(new Set(['message-1']));
    await expect(loadDeviceLocalMessageFlags(
      active,
      'friend',
      'conversation-1',
    )).resolves.toEqual(new Set(['message-1']));

    await expect(setDeviceLocalMessageFlag(
      active,
      'friend',
      'conversation-1',
      'message-1',
      false,
    )).resolves.toEqual(new Set());
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it('does not expose flags across Station or actor scopes', async () => {
    await setDeviceLocalMessageFlag(
      session('station-a', 'ptid:alice'),
      'group',
      'group-1',
      'message-1',
      true,
    );

    await expect(loadDeviceLocalMessageFlags(
      session('station-b', 'ptid:alice'),
      'group',
      'group-1',
    )).resolves.toEqual(new Set());
    await expect(loadDeviceLocalMessageFlags(
      session('station-a', 'ptid:bob'),
      'group',
      'group-1',
    )).resolves.toEqual(new Set());
  });

  it('rejects corrupt or mismatched snapshots instead of leaking flags', () => {
    const normalize = messageFlagStateTestContract.normalizeSnapshot;
    expect(normalize({
      version: 1,
      kind: 'friend',
      conversationId: 'other',
      flags: { 'message-1': { flaggedAtMs: 10 } },
    }, 'friend', 'conversation-1').flags).toEqual({});
    expect(normalize({
      version: 1,
      kind: 'friend',
      conversationId: 'conversation-1',
      flags: {
        good: { flaggedAtMs: 10 },
        empty: { flaggedAtMs: 0 },
        invalid: 'bad',
      },
    }, 'friend', 'conversation-1').flags).toEqual({
      good: { flaggedAtMs: 10 },
    });
  });

  it('uses a versioned conversation key', () => {
    expect(messageFlagStateTestContract.storageKey(
      'group',
      'group-1',
    )).toBe('device-local-message-flags.v1.group.group-1');
  });
});
