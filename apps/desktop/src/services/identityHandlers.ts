import { registerIdentityHandler } from './identityPipeline';
import { AuthCommandException } from './desktop_api';
import { useSessionStore } from '../store/session';
import { useSocialChatStore } from '../store/socialChat';
import { useAccountIdentityStore } from '../store/accountIdentity';
import { useSidebarStore } from '../store/sidebar';
import { useGlobalContextStore } from '../kernel/global-context/store';
import { createDesktopClientStorageRuntime } from '../storage/desktopClientStorage';

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

registerIdentityHandler('clear-client-storage-caches', async (payload) => {
  await createDesktopClientStorageRuntime({ actorDid: payload.actorId ?? null }).kernel.invalidateDomains([
    'asset.avatar',
    'chat.conversation-settings',
    'chat.message',
    'config.preference',
    'crypto.sender-key-ledger',
    'identity.trust',
    'profile.peer',
    'runtime.projection',
  ]);
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
