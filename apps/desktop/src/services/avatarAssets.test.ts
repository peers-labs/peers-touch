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
      // eslint-disable-next-line no-await-in-loop
      await store.prepare({ identity: `/a${i}.png`, epoch: 0 }, { budgetMs: 500 });
    }

    // Oldest entry remains paint-ready (src kept) even after image eviction.
    const oldest = store.getSnapshot(avatarAssetKey({ identity: '/a0.png', epoch: 0 }));
    expect(oldest?.phase).toBe('ready');
    expect(oldest?.src).toContain('/cache/a0png');
  });
});
