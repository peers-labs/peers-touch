export const CLIENT_STORAGE_SCHEMA_VERSION = 1;

export type ClientStorageDomainId =
  | 'asset.avatar'
  | 'chat.conversation-settings'
  | 'chat.message'
  | 'config.preference'
  | 'crypto.sender-key-ledger'
  | 'identity.trust'
  | 'profile.peer'
  | 'station.registry'
  | 'runtime.projection';

export type StorageScopeLevel = 'app' | 'station' | 'actor' | 'device' | 'session' | 'process';

export interface ClientStorageDomain {
  readonly id: ClientStorageDomainId;
  readonly scope: StorageScopeLevel;
  readonly ttlMs: number | null;
  readonly persistent: boolean;
}

export const CLIENT_STORAGE_DOMAINS: Record<ClientStorageDomainId, ClientStorageDomain> = {
  'asset.avatar': { id: 'asset.avatar', scope: 'actor', ttlMs: 7 * 24 * 60 * 60 * 1000, persistent: true },
  'chat.conversation-settings': {
    id: 'chat.conversation-settings',
    scope: 'actor',
    ttlMs: 24 * 60 * 60 * 1000,
    persistent: true,
  },
  'chat.message': { id: 'chat.message', scope: 'actor', ttlMs: null, persistent: true },
  'config.preference': { id: 'config.preference', scope: 'actor', ttlMs: null, persistent: true },
  'crypto.sender-key-ledger': { id: 'crypto.sender-key-ledger', scope: 'actor', ttlMs: null, persistent: true },
  'identity.trust': { id: 'identity.trust', scope: 'actor', ttlMs: null, persistent: true },
  'profile.peer': { id: 'profile.peer', scope: 'actor', ttlMs: 30 * 60 * 1000, persistent: true },
  'station.registry': { id: 'station.registry', scope: 'app', ttlMs: null, persistent: true },
  'runtime.projection': { id: 'runtime.projection', scope: 'session', ttlMs: 5 * 60 * 1000, persistent: false },
};

export interface ClientStorageScope {
  readonly app: 'desktop' | 'mobile' | string;
  readonly station?: string | null;
  readonly actor?: string | null;
  readonly device?: string | null;
  readonly session?: string | null;
  readonly process?: string | null;
}

export interface CacheEnvelope<T> {
  readonly schemaVersion: number;
  readonly domain: ClientStorageDomainId;
  readonly key: string;
  readonly scope: ClientStorageScope;
  readonly value: T;
  readonly cachedAt: number;
  readonly expiresAt: number | null;
  readonly revision?: string;
  readonly cursor?: string;
  readonly stale?: boolean;
}

export interface CacheWriteOptions {
  readonly cachedAt?: number;
  readonly ttlMs?: number | null;
  readonly revision?: string;
  readonly cursor?: string;
  readonly stale?: boolean;
}

export interface CacheReadResult<T> {
  readonly envelope: CacheEnvelope<T> | null;
  readonly hit: boolean;
  readonly stale: boolean;
}

export interface PlatformStorageAdapter {
  readonly getItem: (key: string) => Promise<string | null>;
  readonly setItem: (key: string, value: string) => Promise<void>;
  readonly removeItem: (key: string) => Promise<void>;
  readonly keys?: (prefix: string) => Promise<string[]>;
}

export interface CacheStore {
  readonly read: <T>(domain: ClientStorageDomainId, key: string) => Promise<CacheReadResult<T>>;
  readonly write: <T>(domain: ClientStorageDomainId, key: string, value: T, options?: CacheWriteOptions) => Promise<CacheEnvelope<T>>;
  readonly remove: (domain: ClientStorageDomainId, key: string) => Promise<void>;
  readonly invalidateDomain: (domain: ClientStorageDomainId) => Promise<void>;
  readonly storageKey: (domain: ClientStorageDomainId, key: string) => string;
}

export interface DomainCacheRepository<T> {
  readonly domain: ClientStorageDomainId;
  readonly read: (key: string) => Promise<CacheReadResult<T>>;
  readonly readValue: (key: string) => Promise<T | null>;
  readonly write: (key: string, value: T, options?: CacheWriteOptions) => Promise<CacheEnvelope<T>>;
  readonly remove: (key: string) => Promise<void>;
  readonly invalidate: () => Promise<void>;
}

export interface ClientStorageKernel {
  readonly scope: ClientStorageScope;
  readonly cache: CacheStore;
  readonly repository: <T>(domain: ClientStorageDomainId) => DomainCacheRepository<T>;
  readonly invalidateDomains: (domains: readonly ClientStorageDomainId[]) => Promise<void>;
  readonly invalidateSession: () => Promise<void>;
}

export interface ClientStorageKernelOptions {
  readonly adapter: PlatformStorageAdapter;
  readonly scope: ClientStorageScope;
  readonly clock?: () => number;
}

const ROOT_PREFIX = 'peers-touch.client-storage.v1';

export function createCacheStore(
  adapter: PlatformStorageAdapter,
  scope: ClientStorageScope,
  clock: () => number = () => Date.now(),
): CacheStore {
  const storageKey = (domain: ClientStorageDomainId, key: string) => scopedStorageKey(scope, domain, key);

  return {
    read: async <T>(domain: ClientStorageDomainId, key: string): Promise<CacheReadResult<T>> => {
      const raw = await adapter.getItem(storageKey(domain, key));
      if (!raw) return { envelope: null, hit: false, stale: false };

      const envelope = parseEnvelope<T>(raw, domain, key);
      if (!envelope) return { envelope: null, hit: false, stale: false };

      const expired = Boolean(envelope.expiresAt && envelope.expiresAt <= clock());
      return { envelope, hit: true, stale: Boolean(envelope.stale || expired) };
    },

    write: async <T>(
      domain: ClientStorageDomainId,
      key: string,
      value: T,
      options: CacheWriteOptions = {},
    ): Promise<CacheEnvelope<T>> => {
      const domainPolicy = CLIENT_STORAGE_DOMAINS[domain];
      const cachedAt = options.cachedAt ?? clock();
      const ttlMs = options.ttlMs === undefined ? domainPolicy.ttlMs : options.ttlMs;
      const envelope: CacheEnvelope<T> = {
        schemaVersion: CLIENT_STORAGE_SCHEMA_VERSION,
        domain,
        key,
        scope,
        value,
        cachedAt,
        expiresAt: ttlMs === null ? null : cachedAt + ttlMs,
        ...(options.revision ? { revision: options.revision } : {}),
        ...(options.cursor ? { cursor: options.cursor } : {}),
        ...(options.stale !== undefined ? { stale: options.stale } : {}),
      };
      await adapter.setItem(storageKey(domain, key), JSON.stringify(envelope));
      return envelope;
    },

    remove: async (domain: ClientStorageDomainId, key: string) => {
      await adapter.removeItem(storageKey(domain, key));
    },

    invalidateDomain: async (domain: ClientStorageDomainId) => {
      const prefix = domainStoragePrefix(scope, domain);
      const keys = await adapter.keys?.(prefix);
      await Promise.all((keys ?? []).map((key) => adapter.removeItem(key)));
    },

    storageKey,
  };
}

export function createClientStorageKernel(options: ClientStorageKernelOptions): ClientStorageKernel {
  const cache = createCacheStore(options.adapter, options.scope, options.clock);

  return {
    scope: options.scope,
    cache,
    repository: <T>(domain: ClientStorageDomainId): DomainCacheRepository<T> => createDomainRepository<T>(cache, domain),
    invalidateDomains: async (domains) => {
      await Promise.all(domains.map((domain) => cache.invalidateDomain(domain)));
    },
    invalidateSession: async () => {
      await Promise.all(
        Object.values(CLIENT_STORAGE_DOMAINS)
          .filter((domain) => domain.scope === 'session' || domain.scope === 'process')
          .map((domain) => cache.invalidateDomain(domain.id)),
      );
    },
  };
}

export function createDomainRepository<T>(
  cache: CacheStore,
  domain: ClientStorageDomainId,
): DomainCacheRepository<T> {
  return {
    domain,
    read: (key) => cache.read<T>(domain, key),
    readValue: async (key) => {
      const result = await cache.read<T>(domain, key);
      return result.envelope?.value ?? null;
    },
    write: (key, value, options) => cache.write<T>(domain, key, value, options),
    remove: (key) => cache.remove(domain, key),
    invalidate: () => cache.invalidateDomain(domain),
  };
}

export function createLocalStorageAdapter(storage: Storage | null | undefined): PlatformStorageAdapter {
  return {
    getItem: async (key) => storage?.getItem(key) ?? null,
    setItem: async (key, value) => {
      storage?.setItem(key, value);
    },
    removeItem: async (key) => {
      storage?.removeItem(key);
    },
    keys: async (prefix) => {
      if (!storage) return [];
      const result: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(prefix)) result.push(key);
      }
      return result;
    },
  };
}

export function scopedStorageKey(scope: ClientStorageScope, domain: ClientStorageDomainId, key: string): string {
  return `${domainStoragePrefix(scope, domain)}:${safeSegment(key)}`;
}

export function safeStorageKey(parts: readonly string[]): string {
  return parts.map(safeSegment).filter(Boolean).join('.');
}

function domainStoragePrefix(scope: ClientStorageScope, domain: ClientStorageDomainId): string {
  return [
    ROOT_PREFIX,
    safeSegment(scope.app),
    safeSegment(scope.station ?? 'station'),
    safeSegment(scope.actor ?? 'actor'),
    safeSegment(scope.device ?? 'device'),
    safeSegment(scope.session ?? 'session'),
    safeSegment(scope.process ?? 'process'),
    safeSegment(domain),
  ].join(':');
}

function parseEnvelope<T>(raw: string, domain: ClientStorageDomainId, key: string): CacheEnvelope<T> | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CacheEnvelope<T>>;
    if (parsed.schemaVersion !== CLIENT_STORAGE_SCHEMA_VERSION) return null;
    if (parsed.domain !== domain || parsed.key !== key) return null;
    if (parsed.value === undefined || typeof parsed.cachedAt !== 'number') return null;
    return parsed as CacheEnvelope<T>;
  } catch {
    return null;
  }
}

function safeSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '_';
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160);
}
