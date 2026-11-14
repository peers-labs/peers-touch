import { describe, expect, it, vi } from 'vitest';

import {
  AvatarAssetsStore,
  MAX_DECODED_IMAGES,
  avatarAssetKey,
  downloadableAvatarSource,
  inlineAvatarSource,
  type AvatarAssetQuery,
} from './avatarAssets';

class FakeImage {
  naturalWidth = 1;
  naturalHeight = 1;
  complete = false;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private srcValue = '';

  constructor(private readonly manual: boolean = false) {}

  set src(value: string) {
    this.srcValue = value;
    if (!this.manual) {
      queueMicrotask(() => {
        this.complete = true;
        this.onload?.();
      });
    }
  }

  get src(): string {
    return this.srcValue;
  }

  resolve(): void {
    this.complete = true;
    this.onload?.();
  }
}

type LocalResolver = (identity: string) => Promise<{
  state?: string;
  identity?: string;
  local_path?: string | null;
}>;

function makeStore(resolveLocal: LocalResolver, manual = false) {
  return new AvatarAssetsStore({
    resolveLocal,
    fileSrc: (path) => `asset://${path}`,
    imageFactory: () => new FakeImage(manual) as unknown as HTMLImageElement,
  });
}

const baseQuery = (identity: string, extra: Partial<AvatarAssetQuery> = {}): AvatarAssetQuery => ({
  identity,
  actorPtid: 'ptid:actor',
  epoch: 1,
  ...extra,
});

describe('avatarAssets classifiers', () => {
  it('keeps data: URIs inline and rejects the retired generator', () => {
    expect(inlineAvatarSource('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(downloadableAvatarSource('data:image/png;base64,AAAA')).toBeNull();
    expect(downloadableAvatarSource('')).toBeNull();
    expect(downloadableAvatarSource(
      'https://internal.example.invalid/api/ide/v1/text_to_image?prompt=x',
    )).toBeNull();
    expect(downloadableAvatarSource('/sub-oss/avatar.png')).toBe('/sub-oss/avatar.png');
  });

  it('keys include epoch, actor, scope, revision and canonical identity', () => {
    const a = avatarAssetKey({ identity: '/a.png', actorPtid: 'p1', epoch: 1, profileRevision: 3 });
    const b = avatarAssetKey({ identity: '/a.png', actorPtid: 'p1', epoch: 2, profileRevision: 3 });
    const c = avatarAssetKey({ identity: '/a.png', actorPtid: 'p1', epoch: 1, profileRevision: 4 });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(avatarAssetKey({ identity: '/a.png', epoch: 0 })).toBe('0|||0|/a.png');
  });
});

describe('avatarAssets resolution', () => {
  it('renders bundled data URIs without a native resolve flight', async () => {
    const resolveLocal = vi.fn(async (_identity: string) => ({ state: 'failed' as const }));
    const store = makeStore(resolveLocal);
    const result = await store.prepare(baseQuery('data:image/png;base64,AAAA'), { budgetMs: 500 });

    expect(result.status).toBe('ready');
    expect(result.snapshot.src).toBe('data:image/png;base64,AAAA');
    expect(resolveLocal).not.toHaveBeenCalled();
  });

  it('resolves canonical identities through one shared native flight', async () => {
    const resolveLocal = vi.fn(async () => ({
      state: 'ready' as const,
      identity: '/sub-oss/a.png',
      local_path: '/cache/a.png',
    }));
    const store = makeStore(resolveLocal);
    const query = baseQuery('/sub-oss/a.png');

    const [a, b] = await Promise.all([
      store.prepare(query, { budgetMs: 500 }),
      store.prepare(query, { budgetMs: 500 }),
    ]);

    expect(a.status).toBe('ready');
    expect(b.status).toBe('ready');
    expect(a.snapshot.src).toBe('asset:///cache/a.png');
    expect(resolveLocal).toHaveBeenCalledTimes(1);
  });

  it('treats an empty identity as authoritative absent', async () => {
    const resolveLocal = vi.fn(async (_identity: string) => ({ state: 'failed' as const }));
    const store = makeStore(resolveLocal);

    const result = await store.prepare(baseQuery(''), { budgetMs: 100 });
    expect(result.status).toBe('absent');
    expect(result.snapshot.src).toBeNull();
    expect(resolveLocal).not.toHaveBeenCalled();
  });

  it('does not permanently null-cache failures; an explicit refresh bypasses backoff and retries', async () => {
    const resolveLocal = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        state: 'ready' as const,
        identity: '/sub-oss/a.png',
        local_path: '/cache/a.png',
      });
    const store = makeStore(resolveLocal);
    const query = baseQuery('/sub-oss/a.png');

    const failed = await store.prepare(query, { budgetMs: 100 });
    expect(failed.status).toBe('failed');

    // Within the bounded backoff window an automatic prepare does not retry.
    const parked = await store.prepare(query, { budgetMs: 100 });
    expect(parked.status).toBe('failed');
    expect(resolveLocal).toHaveBeenCalledTimes(1);

    // Explicit refresh bypasses the backoff and succeeds.
    const retried = await store.prepare(query, { budgetMs: 500, force: true });
    expect(retried.status).toBe('ready');
    expect(resolveLocal).toHaveBeenCalledTimes(2);
  });

  it('keeps the previous image painted while a rotated same-actor identity is resolving', async () => {
    type ResolveResult = { state: 'ready'; identity: string; local_path: string };
    // A controllable pending resolution. Property access avoids the CFA rule
    // that narrows an outer `let` to null when assigned only inside a
    // callback.
    const rotatedFlight = (() => {
      let resolve!: (value: ResolveResult) => void;
      const promise = new Promise<ResolveResult>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    })();
    const resolveLocal = vi.fn<LocalResolver>(async (identity) => {
      if (identity === 'station-resource://local/01NEWTOKEN') {
        return rotatedFlight.promise;
      }
      return { state: 'ready', identity, local_path: '/cache/old.png' };
    });
    const store = makeStore(resolveLocal);

    // Materialize the actor's current avatar so same-actor last-good exists.
    const first = await store.prepare(baseQuery('/sub-oss/old.png'), { budgetMs: 500 });
    expect(first.status).toBe('ready');

    // A rotated identity (e.g. a new ephemeral station-resource projection
    // token after a profile refresh) starts resolving and stays pending.
    const rotatedQuery = baseQuery('station-resource://local/01NEWTOKEN');
    // request() returns the paint-ready last-good snapshot immediately...
    const seeded = store.request(rotatedQuery);
    expect(seeded?.src).toBe('asset:///cache/old.png');
    expect(seeded?.degraded).toBe(true);
    // ...while the entry itself moves into resolving without blanking.
    const liveSnapshot = store.getSnapshot(avatarAssetKey(rotatedQuery));
    expect(liveSnapshot?.phase).toBe('resolving');
    expect(liveSnapshot?.src).toBe('asset:///cache/old.png');

    // Once the new identity materializes, the entry swaps to the fresh image.
    rotatedFlight.resolve({
      state: 'ready',
      identity: 'station-resource://local/01NEWTOKEN',
      local_path: '/cache/new.png',
    });
    await vi.waitFor(() => {
      expect(store.getSnapshot(avatarAssetKey(rotatedQuery))).toMatchObject({
        phase: 'ready',
        src: 'asset:///cache/new.png',
        degraded: false,
      });
    });
  });

  it('does not seed last-good for an unattributed identity while resolving', () => {
    // Never resolves: the point is the synchronous request() return value.
    const resolveLocal = vi.fn<LocalResolver>(() => new Promise(() => {}));
    const store = makeStore(resolveLocal);
    // No prior attributed image and no actorPtid: request starts empty.
    const snapshot = store.request({ identity: '/sub-oss/mystery.png', epoch: 0 });
    expect(snapshot).toBeNull();
  });

  it('shows same-actor last-good as degraded when a newer identity fails', async () => {
    const resolveLocal = vi.fn(async (identity: string): Promise<{
      state: 'ready' | 'failed';
      identity: string;
      local_path?: string;
    }> => ({
      state: 'ready',
      identity,
      local_path: identity === '/old.png' ? '/cache/old.png' : undefined,
    }));
    const store = makeStore(resolveLocal);

    await store.prepare(baseQuery('/old.png'), { budgetMs: 500 });
    resolveLocal.mockResolvedValueOnce({ state: 'failed' as const, identity: '/new.png' });
    const degraded = await store.prepare(baseQuery('/new.png'), { budgetMs: 500 });

    expect(degraded.status).toBe('degraded');
    expect(degraded.snapshot.src).toBe('asset:///cache/old.png');
    expect(degraded.snapshot.degraded).toBe(true);
  });

  it('never falls back to last-good for an unattributed peer identity', async () => {
    const resolveLocal = vi.fn(async (identity: string): Promise<{
      state: 'ready' | 'failed';
      identity: string;
      local_path?: string;
    }> => ({
      state: 'ready',
      identity,
      local_path: identity === '/alice.png' ? '/cache/alice.png' : undefined,
    }));
    const store = makeStore(resolveLocal);

    // Attributed actor A gets a materialized avatar.
    await store.prepare({ identity: '/alice.png', actorPtid: 'ptid:a', epoch: 0 }, { budgetMs: 500 });

    // An unattributed identity (no actorPtid) fails: it must not inherit A's image.
    const leaked = await store.prepare({ identity: '/mystery.png', epoch: 0 }, { budgetMs: 500 });
    expect(leaked.status).toBe('failed');
    expect(leaked.snapshot.src).toBeNull();
    expect(leaked.snapshot.degraded).toBe(false);
  });

  it('holds a group avatar locally across empty-identity churn and failed refreshes', async () => {
    // A group conversation avatar is owned by a non-actor stable key. It
    // follows the same local → online rule as actor avatars: once resolved,
    // a reconcile that transiently drops the avatar field, or a failed
    // refresh of a rotated identity, must keep the local pixels (degraded)
    // instead of swapping to the member-composite fallback.
    const resolveLocal = vi.fn(async (identity: string): Promise<{
      state: 'ready' | 'failed';
      identity: string;
      local_path?: string | null;
    }> => {
      if (identity === 'https://station.test/sub-oss/file?key=group') {
        return { state: 'ready', identity, local_path: '/cache/group.png' };
      }
      return { state: 'failed', identity };
    });
    const store = makeStore(resolveLocal);
    const ownerKey = 'group-avatar:01JGROUP';
    const ownerQuery = (identity: string): AvatarAssetQuery => ({
      identity,
      actorPtid: ownerKey,
      epoch: 0,
    });

    const first = await store.prepare(
      ownerQuery('https://station.test/sub-oss/file?key=group'),
      { budgetMs: 500 },
    );
    expect(first.status).toBe('ready');
    expect(first.snapshot.src).toBe('asset:///cache/group.png');

    // The owner last-good is exposed with a stable reference (required by
    // useSyncExternalStore) while the identity is momentarily unknown.
    const ownerFallback = store.getOwnerLastGood(ownerKey);
    expect(ownerFallback).toMatchObject({
      src: 'asset:///cache/group.png',
      degraded: true,
    });
    expect(store.getOwnerLastGood(ownerKey)).toBe(ownerFallback);

    // A reconcile that drops the avatar field: even with an empty identity
    // the owned request seeds the local pixels (degraded) instead of a null
    // placeholder, and the owner fallback stays available.
    expect(store.request(ownerQuery(''))).toMatchObject({
      phase: 'ready',
      degraded: true,
      src: 'asset:///cache/group.png',
    });
    expect(store.getOwnerLastGood(ownerKey)?.src).toBe('asset:///cache/group.png');

    // A rotated identity whose refresh fails keeps the previous pixels.
    resolveLocal.mockResolvedValueOnce({
      state: 'failed',
      identity: 'https://station.test/sub-oss/file?key=group-v2',
    });
    const degraded = await store.prepare(
      ownerQuery('https://station.test/sub-oss/file?key=group-v2'),
      { budgetMs: 500, force: true },
    );
    expect(degraded.status).toBe('degraded');
    expect(degraded.snapshot.src).toBe('asset:///cache/group.png');

    // The group bucket must never leak into an actor PTID bucket.
    expect(store.getOwnerLastGood('ptid:peer')).toBeNull();
  });

  it('local-only prepare never calls native resolve', async () => {
    const resolveLocal = vi.fn(async (_identity: string) => ({ state: 'failed' as const }));
    const store = makeStore(resolveLocal);
    const query = baseQuery('/sub-oss/a.png', { localPath: '/cache/a.png' });

    const result = await store.prepare(query, { budgetMs: 500, localOnly: true });

    expect(result.status).toBe('ready');
    expect(result.snapshot.src).toBe('asset:///cache/a.png');
    expect(resolveLocal).not.toHaveBeenCalled();
  });

  it('rejects the retired generator prefix as absent without native resolve', async () => {
    const resolveLocal = vi.fn(async (_identity: string) => ({ state: 'failed' as const }));
    const store = makeStore(resolveLocal);
    const query = baseQuery(
      'https://internal.example.invalid/api/ide/v1/text_to_image?prompt=x',
    );

    const result = await store.prepare(query, { budgetMs: 100 });

    expect(result.status).toBe('absent');
    expect(resolveLocal).not.toHaveBeenCalled();
  });
});

describe('avatarAssets epoch fencing', () => {
  it('cleans session-scoped entries when the epoch advances and discards late responses', async () => {
    const controllers: Array<{
      resolve: (value: { state: 'ready'; identity: string; local_path: string }) => void;
    }> = [];
    const resolveLocal = vi.fn(
      (): Promise<{ state: 'ready'; identity: string; local_path: string }> =>
        new Promise((resolve) => {
          controllers.push({ resolve });
        }),
    );
    const store = makeStore(resolveLocal, true);

    const stale = store.prepare(baseQuery('/old-actor.png', { epoch: 1 }), { budgetMs: 30 });
    expect(await stale).toMatchObject({ status: 'failed' }); // 30ms budget lapsed

    store.bindSession({ epoch: 2, actorPtid: 'ptid:new', identity: '/new.png', localPath: null });
    // The epoch-1 flight completes late; its entry must not be recorded.
    controllers[0].resolve({
      state: 'ready',
      identity: '/old-actor.png',
      local_path: '/cache/old.png',
    });
    await Promise.resolve();
    await Promise.resolve();

    const oldKey = avatarAssetKey(baseQuery('/old-actor.png', { epoch: 1 }));
    expect(store.getSnapshot(oldKey)).toBeNull();
  });

  it('keeps epoch-0 peer/account entries across session cleanup', async () => {
    const resolveLocal = vi.fn(async (identity: string) => ({
      state: 'ready' as const,
      identity,
      local_path: `/cache/${identity.replace(/\W/g, '')}`,
    }));
    const store = makeStore(resolveLocal);

    await store.prepare({ identity: '/peer.png', epoch: 0 }, { budgetMs: 500 });
    store.bindSession({ epoch: 1, actorPtid: 'ptid:a', identity: '', state: 'absent' });
    store.cleanupSessionEpoch(2);

    const peer = store.getSnapshot(avatarAssetKey({ identity: '/peer.png', epoch: 0 }));
    expect(peer?.phase).toBe('ready');
    expect(peer?.src).toBe('asset:///cache/peerpng');
  });
});

describe('avatarAssets decoded image LRU', () => {
  it('bounds decoded Images while keeping paint-ready metadata', async () => {
    const resolveLocal = vi.fn(async (identity: string) => ({
      state: 'ready' as const,
      identity,
      local_path: `/cache/${identity.replace(/\W/g, '')}`,
    }));
    const store = makeStore(resolveLocal);

    for (let i = 0; i < MAX_DECODED_IMAGES + 10; i += 1) {
      await store.prepare({ identity: `/a${i}.png`, epoch: 0 }, { budgetMs: 500 });
    }

    // Oldest entry remains paint-ready (src kept) even after image eviction.
    const oldest = store.getSnapshot(avatarAssetKey({ identity: '/a0.png', epoch: 0 }));
    expect(oldest?.phase).toBe('ready');
    expect(oldest?.src).toContain('/cache/a0png');
  });
});
describe('avatarAssets persistent last-good', () => {
  it('paints primed cross-process last-good for a new identity without blanking', () => {
    const resolveLocal = vi.fn<LocalResolver>(() => new Promise(() => {}));
    const store = makeStore(resolveLocal);
    // Simulate a cold-start prime from actor-scoped storage, at any epoch.
    store.primePersistentLastGood([{
      actorPtid: 'ptid:peer:bob',
      identity: '/sub-oss/bob.png',
      src: 'asset:///cache/bob.png',
      localPath: '/cache/bob.png',
      revision: null,
    }]);

    const query: AvatarAssetQuery = { identity: '/sub-oss/bob.png', actorPtid: 'ptid:peer:bob', epoch: 3 };
    const seeded = store.request(query);
    expect(seeded?.src).toBe('asset:///cache/bob.png');
    expect(seeded?.degraded).toBe(true);
    expect(store.getSnapshot(avatarAssetKey(query))?.phase).toBe('resolving');
  });

  it('does not let an unattributed or invalid prime seed a frame', () => {
    const store = makeStore(vi.fn<LocalResolver>(() => new Promise(() => {})));
    store.primePersistentLastGood([
      { actorPtid: '  ', identity: 'x', src: 'asset://x' },
      { actorPtid: 'ptid:peer:x', identity: 'x', src: '  ' },
    ]);
    expect(store.request({ identity: 'x', epoch: 0 })).toBeNull();
  });

  it('persists a freshly decoded attributed avatar through the sink', async () => {
    const persist = vi.fn();
    const store = new AvatarAssetsStore({
      resolveLocal: vi.fn(async (identity) => ({
        state: 'ready' as const,
        identity,
        local_path: '/cache/self.png',
      })),
      fileSrc: (path) => `asset://${path}`,
      imageFactory: () => new FakeImage() as unknown as HTMLImageElement,
    }, persist);
    // Sink requires a bound session (local owner scope).
    store.bindSession({
      epoch: 1,
      actorPtid: 'ptid:actor:self',
      identity: '/sub-oss/self.png',
      localPath: null,
    });
    await vi.waitFor(() => expect(persist).toHaveBeenCalled());
    const [owner, entry] = persist.mock.calls[0];
    expect(owner).toBe('ptid:actor:self');
    expect(entry).toMatchObject({
      actorPtid: 'ptid:actor:self',
      src: 'asset:///cache/self.png',
      localPath: '/cache/self.png',
    });
  });

  it('backfills owner persistence for a peer avatar that went ready before session bind', async () => {
    const persist = vi.fn();
    const store = new AvatarAssetsStore({
      resolveLocal: vi.fn(async (identity: string) => ({
        state: 'ready' as const,
        identity,
        local_path: `/cache/${identity.replace(/\W/g, '')}`,
      })),
      fileSrc: (path) => `asset://${path}`,
      imageFactory: () => new FakeImage() as unknown as HTMLImageElement,
    }, persist);

    // Initial hydrate resolves the peer avatar before the owner session binds.
    const peerQuery: AvatarAssetQuery = { identity: '/peer.png', actorPtid: 'ptid:peer', epoch: 0 };
    store.request(peerQuery);
    await vi.waitFor(() => {
      expect(store.getSnapshot(avatarAssetKey(peerQuery))?.phase).toBe('ready');
    });
    expect(persist).not.toHaveBeenCalled();

    // Binding the owner session synchronously backfills the ready peer entry.
    store.bindSession({ epoch: 1, actorPtid: 'ptid:owner', identity: '/self.png' });
    expect(persist.mock.calls.some(([owner, entry]) => (
      owner === 'ptid:owner'
      && entry.actorPtid === 'ptid:peer'
      && entry.src === 'asset:///cache/peerpng'
    ))).toBe(true);
  });

  it('adopts an already-ready image when attribution arrives, without a second flight', async () => {
    const resolveLocal = vi.fn(async (identity: string) => ({
      state: 'ready' as const,
      identity,
      local_path: `/cache/${identity.replace(/\W/g, '')}`,
    }));
    const persist = vi.fn();
    const store = new AvatarAssetsStore({
      resolveLocal,
      fileSrc: (path) => `asset://${path}`,
      imageFactory: () => new FakeImage() as unknown as HTMLImageElement,
    }, persist);
    store.bindSession({ epoch: 1, actorPtid: 'ptid:owner', identity: '/self.png' });
    await vi.waitFor(() => expect(persist).toHaveBeenCalled());
    persist.mockClear();

    // The row paints before the friend/profile hydrate supplies peerPtid.
    const unattributed: AvatarAssetQuery = { identity: '/peer.png', epoch: 0 };
    store.request(unattributed);
    await vi.waitFor(() => {
      expect(store.getSnapshot(avatarAssetKey(unattributed))?.phase).toBe('ready');
    });

    // Attribution arrives under a new key: pixels are adopted immediately.
    const attributed: AvatarAssetQuery = { identity: '/peer.png', actorPtid: 'ptid:peer', epoch: 0 };
    const adopted = store.request(attributed);
    expect(adopted?.src).toBe('asset:///cache/peerpng');
    expect(adopted?.degraded).toBe(false);
    expect(resolveLocal.mock.calls.filter(([identity]) => identity === '/peer.png')).toHaveLength(1);
    expect(persist.mock.calls.some(([owner, entry]) => (
      owner === 'ptid:owner'
      && entry.actorPtid === 'ptid:peer'
      && entry.src === 'asset:///cache/peerpng'
    ))).toBe(true);
  });

  it('adopts ready pixels across revision churn without a second native resolve', async () => {
    const resolveLocal = vi.fn(async (identity: string) => ({
      state: 'ready' as const,
      identity,
      local_path: `/cache/${identity.replace(/\W/g, '')}`,
    }));
    const store = new AvatarAssetsStore({
      resolveLocal,
      fileSrc: (path) => `asset://${path}`,
      imageFactory: () => new FakeImage() as unknown as HTMLImageElement,
    }, vi.fn());
    store.bindSession({ epoch: 1, actorPtid: 'ptid:owner', identity: '/self.png' });

    // First wave: friend-request snapshot identity carries no revision.
    const revisionless: AvatarAssetQuery = {
      identity: '/peer.png',
      actorPtid: 'ptid:peer',
      epoch: 0,
      profileRevision: null,
    };
    store.request(revisionless);
    await vi.waitFor(() => {
      expect(store.getSnapshot(avatarAssetKey(revisionless))?.phase).toBe('ready');
    });

    // Second wave: authoritative profile revision arrives under a new key.
    // The native cache is identity-keyed, so identical identity + revision
    // drift must never trigger another resolve.
    const revisioned: AvatarAssetQuery = {
      identity: '/peer.png',
      actorPtid: 'ptid:peer',
      epoch: 0,
      profileRevision: 7,
    };
    const adopted = store.request(revisioned);
    expect(adopted?.src).toBe('asset:///cache/peerpng');
    expect(adopted?.degraded).toBe(false);
    expect(store.getSnapshot(avatarAssetKey(revisioned))?.phase).toBe('ready');
    expect(resolveLocal.mock.calls.filter(([identity]) => identity === '/peer.png')).toHaveLength(1);
  });

  it('shares one live flight across concurrently dispatched revision key variants', async () => {
    const resolveLocal = vi.fn(async (identity: string) => ({
      state: 'ready' as const,
      identity,
      local_path: `/cache/${identity.replace(/\W/g, '')}`,
    }));
    const store = new AvatarAssetsStore({
      resolveLocal,
      fileSrc: (path) => `asset://${path}`,
      imageFactory: () => new FakeImage() as unknown as HTMLImageElement,
    }, vi.fn());
    store.bindSession({ epoch: 1, actorPtid: 'ptid:owner', identity: '/self.png' });

    // Row (no revision) and authoritative warm (revision 7) dispatch within
    // the same tick, before either flight lands.
    const revisionless: AvatarAssetQuery = {
      identity: '/peer.png',
      actorPtid: 'ptid:peer',
      epoch: 0,
      profileRevision: null,
    };
    const revisioned: AvatarAssetQuery = {
      identity: '/peer.png',
      actorPtid: 'ptid:peer',
      epoch: 0,
      profileRevision: 7,
    };
    store.request(revisionless);
    store.request(revisioned);

    await vi.waitFor(() => {
      expect(store.getSnapshot(avatarAssetKey(revisionless))?.phase).toBe('ready');
    });
    await vi.waitFor(() => {
      expect(store.getSnapshot(avatarAssetKey(revisioned))?.phase).toBe('ready');
    });
    expect(resolveLocal.mock.calls.filter(([identity]) => identity === '/peer.png')).toHaveLength(1);
  });
});