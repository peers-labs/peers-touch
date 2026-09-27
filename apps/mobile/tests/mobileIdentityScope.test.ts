import { describe, expect, it } from 'vitest';

import {
  mobileAuthScopeKey,
  parseMobileAuthSession,
  type MobileAuthSession,
} from '../src/features/auth/mobileAuthIdentity';
import {
  activateStationEntry,
  addStationEntry,
  emptyStationRegistry,
  parseStoredStationRegistry,
  requireMatchingStationIdentity,
} from '../src/features/station/stationRegistry';
import {
  mobileStorageScope,
  purgeLegacyMobileIdentityStorage,
} from '../src/storage/mobileClientStorage';

const session: MobileAuthSession = {
  stationPeerId: '12D3KooWStation',
  stationUrl: 'https://station.example',
  sessionId: 'session-1',
  deviceId: 'device-1',
  lifecycleGeneration: 7,
  actorRef: {
    ptid: 'ptid:alice',
    acct: '@alice@station.example',
  },
  authenticatedAt: 1,
};

describe('Mobile identity scope hard cut', () => {
  it('keys authenticated state by Station, actor, device, and lifecycle generation', () => {
    expect(mobileAuthScopeKey(session)).toBe('12D3KooWStation|ptid:alice|device-1|7');
    expect(mobileStorageScope(session)).toMatchObject({
      station: '12D3KooWStation',
      actor: 'ptid:alice',
      device: 'device-1',
      session: '12D3KooWStation|ptid:alice|device-1|7',
    });
  });

  it('rejects legacy URL/session-id identity records', () => {
    expect(parseMobileAuthSession({
      stationUrl: session.stationUrl,
      sessionId: 'legacy-session',
      actor: { actor_id: 42 },
      authenticatedAt: 1,
    })).toBeNull();
  });

  it('rejects URL-only station registries', () => {
    expect(parseStoredStationRegistry({
      activeUrl: session.stationUrl,
      entries: [{
        url: session.stationUrl,
        label: 'Station',
        createdAt: 1,
        lastUsedAt: 1,
      }],
    })).toBeNull();
  });

  it('updates a URL hint without changing the pinned Station identity', () => {
    const first = addStationEntry(
      emptyStationRegistry(),
      { stationPeerId: session.stationPeerId, url: session.stationUrl },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const moved = addStationEntry(
      first.registry,
      { stationPeerId: session.stationPeerId, url: 'https://new.example' },
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.registry.entries).toHaveLength(1);
    expect(moved.registry.entries[0]?.url).toBe('https://new.example');
    expect(moved.registry.activeStationPeerId).toBe(session.stationPeerId);
  });

  it('fails closed when a URL or pinned Station identity changes owner', () => {
    const first = addStationEntry(
      emptyStationRegistry(),
      { stationPeerId: session.stationPeerId, url: session.stationUrl },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(addStationEntry(
      first.registry,
      { stationPeerId: '12D3KooWOther', url: session.stationUrl },
    )).toEqual({ ok: false, error: 'mobile.launch.stationIdentityMismatch' });
    expect(() => requireMatchingStationIdentity(
      first.registry.entries[0]!,
      '12D3KooWOther',
    )).toThrow('mobile.launch.stationIdentityMismatch');
    expect(activateStationEntry(first.registry, '12D3KooWOther')).toBe(first.registry);
  });

  it('deletes pre-cutover Mobile cache state once', () => {
    const storage = new MemoryStorage();
    storage.setItem('peers-touch.client-storage.v1:mobile:https_station:actor:device:session:process:chat.message:x', 'legacy');
    storage.setItem('unrelated', 'keep');

    purgeLegacyMobileIdentityStorage(storage);
    expect(storage.getItem('peers-touch.client-storage.v1:mobile:https_station:actor:device:session:process:chat.message:x')).toBeNull();
    expect(storage.getItem('unrelated')).toBe('keep');

    storage.setItem('peers-touch.client-storage.v1:mobile:12D3KooWStation:ptid_alice:device:scope:process:chat.message:x', 'current');
    purgeLegacyMobileIdentityStorage(storage);
    expect(storage.getItem('peers-touch.client-storage.v1:mobile:12D3KooWStation:ptid_alice:device:scope:process:chat.message:x')).toBe('current');
  });
});

class MemoryStorage implements Storage {
  readonly #items = new Map<string, string>();

  get length(): number {
    return this.#items.size;
  }

  clear(): void {
    this.#items.clear();
  }

  getItem(key: string): string | null {
    return this.#items.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.#items.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.#items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#items.set(key, value);
  }
}
