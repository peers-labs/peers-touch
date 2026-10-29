import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  session: null as null | { stationPeerId: string; actorPtid: string; sessionId: string; lifecycleGeneration: number },
  listeners: new Set<() => void>(),
  rows: new Map<string, unknown>(),
  read: null as null | (() => Promise<unknown>),
  write: null as null | (() => Promise<void>),
  writes: [] as string[],
}));
vi.mock('./sessionRuntime', () => ({
  readActiveSessionProjection: () => fixture.session,
  assertSessionWriteAdmission: () => fixture.session,
  subscribeSessionRuntime: (listener: () => void) => {
    fixture.listeners.add(listener);
    return () => { fixture.listeners.delete(listener); };
  },
}));
vi.mock('../storage/mobileClientStorage', () => ({
  createMobileActorStorageRuntime: (station: string, actor: string) => ({
    repositories: { chatPreferences: {
      readValue: () => fixture.read ? fixture.read() : Promise.resolve(fixture.rows.get(`${station}/${actor}`) ?? null),
      write: async (_key: string, value: unknown) => {
        fixture.writes.push(`${station}/${actor}`);
        fixture.rows.set(`${station}/${actor}`, value);
        await fixture.write?.();
      },
    } },
  }),
}));
import {
  installMobileLanguageRuntime, readMobileLanguageSnapshot,
  retryMobileLanguage, setMobileLanguage,
} from './languageRuntime';

let release: () => void;
function activate(actor: string | null, station = 'station-a') {
  fixture.session = actor ? { stationPeerId: station, actorPtid: actor, sessionId: actor, lifecycleGeneration: 1 } : null;
  fixture.listeners.forEach((listener) => listener());
}
beforeEach(async () => {
  fixture.rows.clear();
  fixture.read = null;
  fixture.write = null;
  fixture.writes.length = 0;
  vi.stubGlobal('navigator', { language: 'en' });
  activate('actor-a');
  release = installMobileLanguageRuntime();
  await vi.waitFor(() => expect(readMobileLanguageSnapshot().status).toBe('idle'));
});
afterEach(() => { release(); vi.unstubAllGlobals(); });

describe('Mobile language identity lifecycle', () => {
  it('does not apply a delayed actor read after logout', async () => {
    let resolve!: (value: unknown) => void;
    fixture.read = () => new Promise((done) => { resolve = done; });
    const old = retryMobileLanguage();
    fixture.read = null;
    activate(null);
    resolve({ language: 'zh-CN' });
    await old;
    expect(readMobileLanguageSnapshot()).toEqual({ language: 'en', status: 'idle', error: null });
  });

  it('does not write queued choices into the next actor or block the new actor', async () => {
    let finish!: () => void;
    fixture.write = () => new Promise<void>((done) => { finish = done; });
    const first = setMobileLanguage('en');
    await Promise.resolve();
    const queued = setMobileLanguage('zh-CN');
    fixture.write = null;
    activate('actor-b');
    await setMobileLanguage('en');
    finish();
    await Promise.all([first, queued]);
    expect(fixture.writes).toEqual(['station-a/actor-a', 'station-a/actor-b']);
    expect(readMobileLanguageSnapshot().language).toBe('en');
    expect(fixture.rows.get('station-a/actor-b')).toEqual({ language: 'en' });
  });

  it('clears failed retry intent on identity replacement', async () => {
    fixture.write = async () => { throw new Error('quota'); };
    expect(await setMobileLanguage('zh-CN')).toBe(false);
    expect(readMobileLanguageSnapshot().status).toBe('failed');
    fixture.write = null;
    activate('actor-b');
    await retryMobileLanguage();
    expect(readMobileLanguageSnapshot()).toEqual({ language: 'en', status: 'idle', error: null });
    expect(fixture.rows.has('station-a/actor-b')).toBe(false);
  });

  it('rejects scalar language records and commits only successful readback', async () => {
    fixture.rows.set('station-a/actor-a', 'zh-CN');
    expect(await retryMobileLanguage()).toBe(false);
    expect(readMobileLanguageSnapshot().error).toBe('mobile.settings.language.loadFailed');
    expect(await setMobileLanguage('zh-CN')).toBe(true);
    expect(readMobileLanguageSnapshot()).toEqual({ language: 'zh-CN', status: 'idle', error: null });
  });

  it('keeps pre-login language changes in memory only', async () => {
    activate(null);
    expect(await setMobileLanguage('zh-CN')).toBe(true);
    expect(fixture.writes).toEqual([]);
    activate('actor-b');
    await retryMobileLanguage();
    expect(readMobileLanguageSnapshot().language).toBe('en');
  });
});
