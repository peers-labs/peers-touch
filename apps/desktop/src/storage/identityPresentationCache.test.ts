import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cachePeerProfileLastGood,
  readCachedPeerProfiles,
} from '../services/peerProfileCache';
import {
  persistAvatarLastGood,
  readPersistedAvatarLastGood,
} from '../services/avatarLastGoodPersistence';
import type { AccountProfile } from '../services/desktop_api';

class MemoryStorage {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  clear(): void {
    this.map.clear();
  }
}

const owner = 'ptid:actor:alice';
const bob = 'ptid:peer:bob';

function profile(avatar: string): AccountProfile {
  return {
    id: bob,
    profile_revision: 1,
    username: 'bob',
    acct: 'bob',
    display_name: 'Bob',
    note: '',
    url: '',
    avatar,
    header: '',
    locked: false,
    created_at: '',
    statuses_count: 0,
    following_count: 0,
    followers_count: 0,
    region: '',
    timezone: '',
    tags: [],
    links: [],
    default_visibility: '',
    manually_approves_followers: false,
    message_permission: '',
    auto_expire_days: 0,
    federated_handle: '',
    home_station_peer_id: '',
    home_station_domain: '',
    discoverability: 'indexed',
    kind: 1,
    peers_touch: { network_id: bob },
  };
}

describe('peer profile presentation cache', () => {
  beforeEach(() => {
    viStubs();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips and restores the canonical PTID despite storage-key normalization', () => {
    cachePeerProfileLastGood(owner, bob, profile('/sub-oss/bob.png'));

    const cached = readCachedPeerProfiles(owner);
    // ':' in the PTID is replaced by '_' in the storage key, so the value's
    // network_id must restore the canonical key used by the social store.
    expect(Object.keys(cached)).toEqual([bob]);
    expect(cached[bob]?.avatar).toBe('/sub-oss/bob.png');
    expect(cached[bob]?.display_name).toBe('Bob');
  });

  it('is actor-scoped: another actor never reads the cache', () => {
    cachePeerProfileLastGood(owner, bob, profile('/sub-oss/bob.png'));
    expect(readCachedPeerProfiles('ptid:actor:carol')).toEqual({});
  });

  it('returns an empty map without storage or cached entries', () => {
    expect(readCachedPeerProfiles('')).toEqual({});
    expect(readCachedPeerProfiles(owner)).toEqual({});
  });
});

describe('avatar last-good persistence', () => {
  beforeEach(() => {
    viStubs();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists self and peer avatars under the local actor scope and reads them back', () => {
    persistAvatarLastGood(owner, {
      actorPtid: owner,
      identity: '/sub-oss/self.png',
      src: 'asset:///cache/self.png',
      localPath: '/cache/self.png',
      revision: 2,
    });
    persistAvatarLastGood(owner, {
      actorPtid: bob,
      identity: '/sub-oss/bob.png',
      src: 'asset:///cache/bob.png',
      localPath: '/cache/bob.png',
      revision: null,
    });

    const primed = readPersistedAvatarLastGood(owner);
    expect(primed.map((entry) => entry.actorPtid).sort()).toEqual([owner, bob]);
    expect(primed.find((entry) => entry.actorPtid === bob)?.src)
      .toBe('asset:///cache/bob.png');
  });

  it('ignores entries without a paint-ready src', () => {
    persistAvatarLastGood(owner, {
      actorPtid: bob,
      identity: '',
      src: '  ',
      localPath: null,
      revision: null,
    });
    expect(readPersistedAvatarLastGood(owner)).toEqual([]);
  });
});

function viStubs(): void {
  vi.stubGlobal('window', { localStorage: new MemoryStorage() });
}
