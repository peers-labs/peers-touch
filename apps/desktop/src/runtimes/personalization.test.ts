import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sessionState = vi.hoisted(() => ({
  current: {
    authenticated: false,
    currentUser: null as { actorPtid: string } | null,
    stationPeerId: null as string | null,
    sessionEpoch: 0,
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
  capturePersonalizationScope,
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

function authenticate(actorPtid: string | null, stationPeerId = 'station-one'): void {
  const sessionEpoch = sessionState.current.sessionEpoch + 1;
  sessionState.current = actorPtid
    ? { authenticated: true, currentUser: { actorPtid }, stationPeerId, sessionEpoch }
    : { authenticated: false, currentUser: null, stationPeerId: null, sessionEpoch };
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
    expect(capturePersonalizationScope()).toBeNull();

    await expect(readPersonalization(PERSONALIZATION_LANGUAGE_KEY)).resolves.toBeNull();
    await expect(writePersonalization(PERSONALIZATION_LANGUAGE_KEY, 'zh-CN')).resolves.toBe(false);
  });

  it('isolates personalization between two actors on the same device', async () => {
    authenticate(ACTOR_A);
    const scopeA = capturePersonalizationScope();
    expect(await writePersonalization(PERSONALIZATION_LANGUAGE_KEY, 'zh-CN')).toBe(true);
    expect(await writePersonalization(PERSONALIZATION_CHAT_SHORTCUT_KEY, 'Mod+Shift+S')).toBe(true);

    expect(await readPersonalization(PERSONALIZATION_LANGUAGE_KEY)).toBe('zh-CN');
    expect(await readPersonalization(PERSONALIZATION_LANGUAGE_KEY, scopeA)).toBe('zh-CN');

    authenticate(ACTOR_B);
    const scopeB = capturePersonalizationScope();
    expect(await readPersonalization(PERSONALIZATION_LANGUAGE_KEY)).toBeNull();
    expect(await readPersonalization(PERSONALIZATION_CHAT_SHORTCUT_KEY)).toBeNull();

    await writePersonalization(PERSONALIZATION_LANGUAGE_KEY, 'en', scopeB);
    expect(await readPersonalization(PERSONALIZATION_LANGUAGE_KEY, scopeB)).toBe('en');
    expect(await readPersonalization(PERSONALIZATION_LANGUAGE_KEY, scopeA)).toBe('zh-CN');
    expect(await writePersonalization(PERSONALIZATION_LANGUAGE_KEY, 'en', scopeA)).toBe(false);
  });

  it('never shares the actor namespace with the app-scope (L3) storage', async () => {
    authenticate(ACTOR_A);
    await writePersonalization(PERSONALIZATION_LANGUAGE_KEY, 'zh-CN');

    const appRuntime = createDesktopAppStorageRuntime();
    await expect(
      appRuntime.repositories.chatPreferences.readValue(PERSONALIZATION_LANGUAGE_KEY),
    ).resolves.toBeNull();
  });

  it('hard-deletes the actor namespace on logout while preserving L3 device state', async () => {
    authenticate(ACTOR_A);
    const scopeA = capturePersonalizationScope();
    await writePersonalization(PERSONALIZATION_CHAT_SHORTCUT_KEY, 'Mod+Shift+S');
    authenticate(ACTOR_B);
    const scopeB = capturePersonalizationScope();
    await writePersonalization(PERSONALIZATION_LANGUAGE_KEY, 'zh-CN');

    const appRuntime = createDesktopAppStorageRuntime();
    await appRuntime.repositories.stationRegistry.write('active-station', {
      url: 'https://station.example',
    });

    await createDesktopClientStorageRuntime({ ptid: ACTOR_A, stationPeerId: 'station-one' }).kernel.invalidateDomains([
      'config.preference',
    ]);

    await expect(
      readPersonalization(PERSONALIZATION_CHAT_SHORTCUT_KEY, scopeA),
    ).resolves.toBeNull();
    await expect(
      readPersonalization(PERSONALIZATION_LANGUAGE_KEY, scopeB),
    ).resolves.toBe('zh-CN');
    await expect(
      appRuntime.repositories.stationRegistry.readValue('active-station'),
    ).resolves.toEqual({ url: 'https://station.example' });
  });

  it('isolates the same actor at different Stations', async () => {
    authenticate(ACTOR_A, 'station-one');
    const scope = capturePersonalizationScope();
    await writePersonalization(PERSONALIZATION_LANGUAGE_KEY, 'zh-CN');
    authenticate(ACTOR_A, 'station-two');
    expect(await readPersonalization(PERSONALIZATION_LANGUAGE_KEY)).toBeNull();
    expect(await writePersonalization(PERSONALIZATION_LANGUAGE_KEY, 'en', scope)).toBe(false);
    expect(await readPersonalization(PERSONALIZATION_LANGUAGE_KEY, scope)).toBe('zh-CN');
  });
});
