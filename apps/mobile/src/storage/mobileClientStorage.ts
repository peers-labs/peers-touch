import {
  createClientStorageKernel,
  createLocalStorageAdapter,
  type CacheStore,
  type ClientStorageKernel,
  type ClientStorageScope,
  type DomainCacheRepository,
} from '@peers-touch/client-storage';

import type { MobileAuthSession } from '../features/auth/authSession';
import { mobileAuthScope, mobileAuthScopeKey } from '../features/auth/mobileAuthIdentity';

export interface MobileClientStorageRuntime {
  readonly kernel: ClientStorageKernel;
  readonly cache: CacheStore;
  readonly repositories: {
    readonly avatars: DomainCacheRepository<string>;
    readonly chatPreferences: DomainCacheRepository<Record<string, unknown>>;
    readonly conversationSettings: DomainCacheRepository<unknown>;
    readonly identityTrust: DomainCacheRepository<unknown>;
    readonly messageFlags: DomainCacheRepository<unknown>;
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

export function createMobileCacheStore(session: MobileAuthSession | null): CacheStore {
  return createMobileClientStorageRuntime(session).cache;
}

export function createMobileClientStorageRuntime(session: MobileAuthSession | null): MobileClientStorageRuntime {
  const kernel = createClientStorageKernel({
    adapter: createLocalStorageAdapter(browserLocalStorage()),
    scope: mobileStorageScope(session),
  });

  return createMobileClientStorageRuntimeFromKernel(kernel);
}

export function createMobileAppStorageRuntime(): MobileClientStorageRuntime {
  const kernel = createClientStorageKernel({
    adapter: createLocalStorageAdapter(browserLocalStorage()),
    scope: { app: 'mobile' },
  });

  return createMobileClientStorageRuntimeFromKernel(kernel);
}

export function createMobileActorStorageRuntime(
  stationPeerId: string,
  ptid: string,
): MobileClientStorageRuntime {
  if (!stationPeerId.trim() || !ptid.trim()) {
    throw new Error('mobile.auth.missingIdentityScope');
  }
  const kernel = createClientStorageKernel({
    adapter: createLocalStorageAdapter(browserLocalStorage()),
    scope: {
      app: 'mobile',
      station: stationPeerId,
      actor: ptid,
    },
  });

  return createMobileClientStorageRuntimeFromKernel(kernel);
}

function createMobileClientStorageRuntimeFromKernel(kernel: ClientStorageKernel): MobileClientStorageRuntime {
  return {
    kernel,
    cache: kernel.cache,
    repositories: {
      avatars: kernel.repository<string>('asset.avatar'),
      chatPreferences: kernel.repository<Record<string, unknown>>('config.preference'),
      conversationSettings: kernel.repository<unknown>('chat.conversation-settings'),
      identityTrust: kernel.repository<unknown>('identity.trust'),
      messageFlags: kernel.repository<unknown>('chat.message-flag'),
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

export function mobileStorageScope(session: MobileAuthSession | null): ClientStorageScope {
  if (!session) {
    return {
      app: 'mobile',
      station: null,
      actor: null,
      device: null,
      session: null,
    };
  }
  const scope = mobileAuthScope(session);
  return {
    app: 'mobile',
    station: scope.stationPeerId,
    actor: scope.ptid,
    device: scope.deviceId,
    session: mobileAuthScopeKey(session),
  };
}

function browserLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}
