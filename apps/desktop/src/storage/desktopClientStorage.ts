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
    readonly chatPreferences: DomainCacheRepository<Record<string, unknown>>;
    readonly conversationSettings: DomainCacheRepository<unknown>;
    readonly cryptoSenderKeyLedger: DomainCacheRepository<unknown>;
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
  readonly stationUrl?: string | null;
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
      chatPreferences: kernel.repository<Record<string, unknown>>('config.preference'),
      conversationSettings: kernel.repository<unknown>('chat.conversation-settings'),
      cryptoSenderKeyLedger: kernel.repository<unknown>('crypto.sender-key-ledger'),
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
    station: scope.stationUrl ?? null,
    actor: scope.ptid ?? null,
    device: scope.deviceId ?? null,
    session: scope.sessionId ?? null,
  };
}

function browserLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}
