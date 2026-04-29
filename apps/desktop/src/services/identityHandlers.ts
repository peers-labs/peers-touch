import { registerIdentityHandler } from './identityPipeline';
import { AuthCommandException } from './desktop_api';
import { useSessionStore } from '../store/session';
import { useSocialChatStore } from '../store/socialChat';
import { useAccountIdentityStore } from '../store/accountIdentity';
import { useSidebarStore } from '../store/sidebar';
import { useGlobalContextStore } from '../kernel/global-context/store';
import { log } from '../utils/logger';

const STORAGE_PREFIXES = [
  'user:',
  'chat:',
  'friend:',
  'group:',
  'profile:',
  'accountSession:',
  'socialChat:',
] as const;

function clearPrefixedStorage(kind: 'local' | 'session', storage: Storage) {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (!k) continue;
    for (const p of STORAGE_PREFIXES) {
      if (k.startsWith(p)) {
        keys.push(k);
        break;
      }
    }
  }
  for (const k of keys) {
    try {
      storage.removeItem(k);
    } catch (e) {
      log.warn('identity', `clear ${kind} key failed`, { key: k, error: String(e) });
    }
  }
}

registerIdentityHandler('clear-zustand-stores', async (payload) => {
  const actorId = payload.actorId ?? '';
  useSessionStore.getState().reset();
  useSocialChatStore.getState().reset();
  useAccountIdentityStore.getState().reset();
  useSidebarStore.getState().reset();
  useGlobalContextStore.getState().reset();
  if (payload.reason === 'logout') {
    return;
  }
  await useSessionStore.getState().hydrate(actorId);
  await useSocialChatStore.getState().hydrate(actorId);
  await useAccountIdentityStore.getState().hydrate(actorId);
  await useSidebarStore.getState().hydrate(actorId);
  await useGlobalContextStore.getState().hydrate(actorId);
});

registerIdentityHandler('clear-localstorage-caches', () => {
  if (typeof localStorage === 'undefined' || typeof sessionStorage === 'undefined') return;
  clearPrefixedStorage('local', localStorage);
  clearPrefixedStorage('session', sessionStorage);
});

registerIdentityHandler('refresh-current-session', async (payload) => {
  if (payload.reason === 'logout') {
    return;
  }
  try {
    await useSessionStore.getState().restoreSession();
  } catch (e) {
    if (e instanceof AuthCommandException && e.code === 'UNAUTHORIZED') {
      useSessionStore.getState().reset();
      return;
    }
    throw e;
  }
});
