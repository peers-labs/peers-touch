import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sessionState = vi.hoisted(() => ({
  current: {
    authenticated: false,
    currentUser: null as { actorPtid: string } | null,
  },
}));

vi.mock('../store/session', () => ({
  useSessionStore: {
    getState: () => sessionState.current,
  },
}));

import {
  PERSONALIZATION_CHAT_SHORTCUT_KEY,
  PERSONALIZATION_LANGUAGE_KEY,
  activeActorPtid,
  readPersonalization,
  writePersonalization,
} from './personalization';
import {
  createDesktopAppStorageRuntime,
  createDesktopClientStorageRuntime,
} from '../storage/desktopClientStorage';

const ACTOR_A = 'ptid:actor-a';
const ACTOR_B = 'ptid:actor-b';

class MemoryStorage {
  private readonly entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  key(index: number): string | null {
    return Array.from(this.entries.keys())[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

function authenticate(actorPtid: string | null): void {
  sessionState.current = actorPtid
    ? { authenticated: true, currentUser: { actorPtid } }
    : { authenticated: false, currentUser: null };
}

describe('identity-scoped personalization (L2)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { localStorage: new MemoryStorage() });
    authenticate(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses reads and writes when no actor is authenticated', async () => {
    expect(activeActorPtid()).toBeNull();

    await expect(readPersonalization(PERSONALIZATION_LANGUAGE_KEY)).resolves.toBeNull();
    await expect(writePersonalization(PERSONALIZATION_LANGUAGE_KEY, 'zh-CN')).resolves.toBe(false);
    await expect(readPersonalization(PERSONALIZATION_LANGUAGE_KEY, ACTOR_A)).resolves.toBeNull();
  });

  it('isolates personalization between two actors on the same device', async () => {
    authenticate(ACTOR_A);
    expect(await writePersonalization(PERSONALIZATION_LANGUAGE_KEY, 'zh-CN')).toBe(true);
    expect(await writePersonalization(PERSONALIZATION_CHAT_SHORTCUT_KEY, 'Mod+Shift+S')).toBe(true);

    expect(await readPersonalization(PERSONALIZATION_LANGUAGE_KEY)).toBe('zh-CN');
    expect(await readPersonalization(PERSONALIZATION_LANGUAGE_KEY, ACTOR_A)).toBe('zh-CN');

    expect(await readPersonalization(PERSONALIZATION_LANGUAGE_KEY, ACTOR_B)).toBeNull();
    expect(await readPersonalization(PERSONALIZATION_CHAT_SHORTCUT_KEY, ACTOR_B)).toBeNull();

    await writePersonalization(PERSONALIZATION_LANGUAGE_KEY, 'en', ACTOR_B);
    expect(await readPersonalization(PERSONALIZATION_LANGUAGE_KEY, ACTOR_B)).toBe('en');
    expect(await readPersonalization(PERSONALIZATION_LANGUAGE_KEY, ACTOR_A)).toBe('zh-CN');
  });

  it('never shares the actor namespace with the app-scope (L3) storage', async () => {
    await writePersonalization(PERSONALIZATION_LANGUAGE_KEY, 'zh-CN', ACTOR_A);

    const appRuntime = createDesktopAppStorageRuntime();
    await expect(
      appRuntime.repositories.chatPreferences.readValue(PERSONALIZATION_LANGUAGE_KEY),
    ).resolves.toBeNull();
  });

  it('hard-deletes the actor namespace on logout while preserving L3 device state', async () => {
    await writePersonalization(PERSONALIZATION_CHAT_SHORTCUT_KEY, 'Mod+Shift+S', ACTOR_A);
    await writePersonalization(PERSONALIZATION_LANGUAGE_KEY, 'zh-CN', ACTOR_B);

    const appRuntime = createDesktopAppStorageRuntime();
    await appRuntime.repositories.stationRegistry.write('active-station', {
      url: 'https://station.example',
    });

    await createDesktopClientStorageRuntime({ ptid: ACTOR_A }).kernel.invalidateDomains([
      'config.preference',
    ]);

    await expect(
      readPersonalization(PERSONALIZATION_CHAT_SHORTCUT_KEY, ACTOR_A),
    ).resolves.toBeNull();
    await expect(
      readPersonalization(PERSONALIZATION_LANGUAGE_KEY, ACTOR_B),
    ).resolves.toBe('zh-CN');
    await expect(
      appRuntime.repositories.stationRegistry.readValue('active-station'),
    ).resolves.toEqual({ url: 'https://station.example' });
  });
});
