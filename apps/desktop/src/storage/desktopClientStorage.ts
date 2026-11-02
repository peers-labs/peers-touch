import {
  createClientStorageKernel,
  createLocalStorageAdapter,
  type CacheStore,
  type ClientStorageDomainId,
  type ClientStorageKernel,
  type ClientStorageScope,
  type DomainCacheRepository,
} from '@peers-touch/client-storage';

export interface DesktopClientStorageRuntime {
  readonly kernel: ClientStorageKernel;
  readonly cache: CacheStore;
  readonly repositories: {
    readonly avatars: DomainCacheRepository<string>;
    readonly chatPreferences: DomainCacheRepository<unknown>;
    readonly conversationSettings: DomainCacheRepository<unknown>;
    readonly identityTrust: DomainCacheRepository<unknown>;
    readonly messages: DomainCacheRepository<unknown>;
    readonly peerProfiles: DomainCacheRepository<unknown>;
    readonly runtimeProjection: DomainCacheRepository<unknown>;
    readonly stationRegistry: DomainCacheRepository<unknown>;
    readonly agentConversations: DomainCacheRepository<Record<string, unknown>>;
    readonly agentMessages: DomainCacheRepository<Record<string, unknown[]>>;
    readonly agentTurnEvents: DomainCacheRepository<Record<string, unknown[]>>;
    readonly agentCursor: DomainCacheRepository<number>;
  };
  readonly clearSession: () => Promise<void>;
}

export interface DesktopStorageSessionScope {
  readonly stationPeerId?: string | null;
  readonly ptid?: string | null;
  readonly deviceId?: string | null;
  readonly sessionId?: string | null;
}

export function createDesktopClientStorageRuntime(scope: DesktopStorageSessionScope): DesktopClientStorageRuntime {
  const kernel = createClientStorageKernel({
    adapter: createLocalStorageAdapter(browserLocalStorage()),
    scope: desktopStorageScope(scope),
  });

  return {
    kernel,
    cache: kernel.cache,
    repositories: {
      avatars: kernel.repository<string>('asset.avatar'),
      chatPreferences: kernel.repository<unknown>('config.preference'),
      conversationSettings: kernel.repository<unknown>('chat.conversation-settings'),
      identityTrust: kernel.repository<unknown>('identity.trust'),
      messages: kernel.repository<unknown>('chat.message'),
      peerProfiles: kernel.repository<unknown>('profile.peer'),
      runtimeProjection: kernel.repository<unknown>('runtime.projection'),
      stationRegistry: kernel.repository<unknown>('station.registry'),
      agentConversations: kernel.repository<Record<string, unknown>>('agent.conversation'),
      agentMessages: kernel.repository<Record<string, unknown[]>>('agent.message'),
      agentTurnEvents: kernel.repository<Record<string, unknown[]>>('agent.turn-event'),
      agentCursor: kernel.repository<number>('agent.cursor'),
    },
    clearSession: () => kernel.invalidateSession(),
  };
}

export function createDesktopAppStorageRuntime(): DesktopClientStorageRuntime {
  return createDesktopClientStorageRuntime({});
}

export function readDesktopPreferenceSync<T>(key: string): T | null {
  return readDesktopDomainValueSync<T>('config.preference', key);
}

export function writeDesktopPreferenceSync<T>(key: string, value: T): void {
  writeDesktopDomainValueSync('config.preference', key, value);
}

export function removeDesktopPreferenceSync(key: string): void {
  removeDesktopDomainValueSync('config.preference', key);
}

export function readDesktopDomainValueSync<T>(domain: ClientStorageDomainId, key: string): T | null {
  const storage = browserLocalStorage();
  if (!storage) return null;
  try {
    const runtime = createDesktopAppStorageRuntime();
    const raw = storage.getItem(runtime.cache.storageKey(domain, key));
    if (!raw) return null;
    const envelope = JSON.parse(raw) as { value?: T };
    return envelope.value ?? null;
  } catch {
    return null;
  }
}

export function writeDesktopDomainValueSync<T>(domain: ClientStorageDomainId, key: string, value: T): void {
  const storage = browserLocalStorage();
  if (!storage) return;
  try {
    const runtime = createDesktopAppStorageRuntime();
    void runtime.kernel.repository<T>(domain).write(key, value);
  } catch {
    // Storage is best-effort for UI preferences; callers keep in-memory state.
  }
}

export function removeDesktopDomainValueSync(domain: ClientStorageDomainId, key: string): void {
  const storage = browserLocalStorage();
  if (!storage) return;
  try {
    const runtime = createDesktopAppStorageRuntime();
    storage.removeItem(runtime.cache.storageKey(domain, key));
  } catch {
    // Storage is best-effort for UI preferences; callers keep in-memory state.
  }
}

export function desktopStorageScope(scope: DesktopStorageSessionScope): ClientStorageScope {
  return {
    app: 'desktop',
    station: scope.stationPeerId ?? null,
    actor: scope.ptid ?? null,
    device: scope.deviceId ?? null,
    session: scope.sessionId ?? null,
  };
}

/**
 * Build an actor-scoped runtime (station segment left neutral). Used for
 * actor-owned presentation caches (peer profiles, avatar last-good) that
 * must stay readable regardless of the active Station binding.
 */
function actorStorageRuntime(actorPtid: string): DesktopClientStorageRuntime | null {
  const did = actorPtid.trim();
  if (!did) return null;
  return createDesktopClientStorageRuntime({ ptid: did });
}

/**
 * Synchronously read every cached value of `domain` for one actor, keyed by
 * the cache key. localStorage is synchronous; the promise-based kernel is
 * only used for canonical key construction. Cold-start first-frame seeding
 * relies on this staying synchronous.
 */
export function readAllActorDomainValuesSync<T>(
  actorPtid: string,
  domain: ClientStorageDomainId,
): Map<string, T> {
  const out = new Map<string, T>();
  const storage = browserLocalStorage();
  const runtime = actorStorageRuntime(actorPtid);
  if (!storage || !runtime) return out;
  // Domain entries live directly under the domain segment prefix.
  const prefix = `${runtime.cache.storageKey(domain, '').slice(0, -1)}`;
  for (let index = 0; index < storage.length; index += 1) {
    const storageKey = storage.key(index);
    if (!storageKey || !storageKey.startsWith(prefix)) continue;
    const cacheKey = storageKey.slice(prefix.length + 1);
    try {
      const envelope = JSON.parse(storage.getItem(storageKey) ?? 'null') as { value?: T } | null;
      if (envelope?.value !== undefined) out.set(cacheKey, envelope.value);
    } catch {
      // Corrupt envelopes are skipped; the next network reconcile rewrites.
    }
  }
  return out;
}

/** Synchronously write one actor-scoped domain value (best-effort last-good). */
export function writeActorDomainValueSync<T>(
  actorPtid: string,
  domain: ClientStorageDomainId,
  key: string,
  value: T,
): void {
  const storage = browserLocalStorage();
  const runtime = actorStorageRuntime(actorPtid);
  if (!storage || !runtime) return;
  try {
    const envelope = {
      schemaVersion: 1,
      domain,
      key,
      scope: runtime.kernel.scope,
      value,
      cachedAt: Date.now(),
      expiresAt: null,
    };
    storage.setItem(runtime.cache.storageKey(domain, key), JSON.stringify(envelope));
  } catch {
    // Presentation caches must never break the calling projection.
  }
}

function browserLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}
