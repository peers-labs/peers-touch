import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  session: null as null | { stationPeerId: string; actorPtid: string; sessionId: string; lifecycleGeneration: number },
  listeners: new Set<() => void>(),
  rows: new Map<string, Record<string, unknown>>(),
  read: null as null | (() => Promise<Record<string, unknown> | null>),
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
      write: async (_key: string, value: Record<string, unknown>) => {
        fixture.writes.push(`${station}/${actor}`);
        fixture.rows.set(`${station}/${actor}`, structuredClone(value));
        await fixture.write?.();
      },
    } },
  }),
}));
import { createContactPreferencesRuntime } from './contactPreferencesRuntime';

let runtime: ReturnType<typeof createContactPreferencesRuntime>;
let release: () => void;
function activate(actor: string | null, station = 'station-a') {
  fixture.session = actor ? { stationPeerId: station, actorPtid: actor, sessionId: actor, lifecycleGeneration: 1 } : null;
  fixture.listeners.forEach(listener => listener());
}
beforeEach(async () => {
  fixture.rows.clear(); fixture.writes.length = 0; fixture.read = null; fixture.write = null;
  activate('alice');
  runtime = createContactPreferencesRuntime();
  release = runtime.install();
  await runtime.load();
});
afterEach(() => release());

describe('contact names and notes use the personalization lifetime', () => {
  it('reads back concurrent contact edits without losing the other contact', async () => {
    await Promise.all([
      runtime.save('bob', { nickname: ' Bob ', note: 'Launch contact' }),
      runtime.save('carol', { nickname: 'Carol', note: '' }),
    ]);
    expect(runtime.read().contacts).toEqual({
      bob: { nickname: 'Bob', note: 'Launch contact' }, carol: { nickname: 'Carol', note: '' },
    });
    release();
    runtime = createContactPreferencesRuntime(); release = runtime.install();
    await runtime.load();
    expect(runtime.read().contacts.bob.nickname).toBe('Bob');
    await runtime.save('bob', { nickname: '', note: '' });
    expect(runtime.read().contacts.bob).toBeUndefined();
    expect(runtime.read().contacts.carol.nickname).toBe('Carol');
  });

  it('ignores delayed reads on identity replacement and latest successful edits', async () => {
    let finish!: (value: Record<string, unknown>) => void;
    fixture.read = () => new Promise(done => { finish = done; });
    const old = runtime.load();
    fixture.read = null;
    activate('bob');
    await runtime.load();
    finish({ contacts: { carol: { nickname: 'Alice private note', note: '' } } });
    await old;
    expect(runtime.read().contacts).toEqual({});
    fixture.read = () => new Promise(done => { finish = done; });
    const stale = runtime.load();
    fixture.read = null;
    await runtime.save('carol', { nickname: 'Updated', note: '' });
    finish({ contacts: {} });
    await stale;
    expect(runtime.read().contacts.carol.nickname).toBe('Updated');
  });

  it('does not write a queued outgoing-actor edit into the next identity', async () => {
    let finish!: () => void;
    fixture.write = () => new Promise<void>(done => { finish = done; });
    const first = runtime.save('bob', { nickname: 'A', note: '' });
    await vi.waitFor(() => expect(fixture.writes).toEqual(['station-a/alice']));
    const queued = runtime.save('carol', { nickname: 'Private A', note: '' });
    fixture.write = null;
    activate('bob', 'station-b');
    await runtime.save('carol', { nickname: 'B', note: '' });
    finish();
    await Promise.allSettled([first, queued]);
    expect(fixture.writes).toEqual(['station-a/alice', 'station-b/bob']);
    expect(runtime.read().contacts.carol.nickname).toBe('B');
  });

  it('preserves malformed storage rather than replacing it during a save', async () => {
    fixture.rows.set('station-a/alice', { contacts: 'invalid' });
    await runtime.load();
    expect(runtime.read().status).toBe('failed');
    await expect(runtime.save('bob', { nickname: 'Bob', note: '' })).rejects.toThrow();
    expect(fixture.rows.get('station-a/alice')).toEqual({ contacts: 'invalid' });
    expect(fixture.writes).toEqual([]);
  });
});
