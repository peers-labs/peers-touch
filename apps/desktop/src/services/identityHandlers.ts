import { registerIdentityHandler } from './identityPipeline';
import { AuthCommandException } from './desktop_api';
import { useSessionStore } from '../store/session';
import { useSocialChatStore } from '../store/socialChat';
import { useNotificationStore } from '../store/notification';
import { useNavigationBadgeStore } from '../store/navigationBadges';
import { useAccountIdentityStore } from '../store/accountIdentity';
import { useChatStore } from '../store/chat';
import { useSidebarStore } from '../store/sidebar';
import { useGlobalContextStore } from '../kernel/global-context/store';
import { closeBrowserCapabilitySession } from '../runtimes/agentCapabilityRuntime';
import { toolRuntime } from '../runtimes/toolRuntime';
import { createDesktopClientStorageRuntime } from '../storage/desktopClientStorage';

registerIdentityHandler('close-browser-capability-session', async (payload) => {
  const currentActorPtid = useSessionStore.getState().currentUser?.actorPtid ?? null;
  if (
    payload.reason === 'logout'
    || payload.reason === 'revoked'
    || currentActorPtid !== payload.actorPtid
  ) {
    await closeBrowserCapabilitySession();
  }
});

registerIdentityHandler('clear-zustand-stores', async (payload) => {
  const currentActorPtid = useSessionStore.getState().currentUser?.actorPtid ?? null;
  // #region debug-point E:zustand-reset-decision
  void fetch('http://127.0.0.1:7781/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'foundation-login-readiness',
      runId: 'post-fix-3',
      hypothesisId: 'E',
      location: 'identityHandlers.ts:clear-zustand-stores',
      msg: '[DEBUG] Zustand reset decision',
      data: {
        reason: payload.reason,
        currentActorPresent: Boolean(currentActorPtid),
        payloadActorPresent: Boolean(payload.actorPtid),
        actorMatches: currentActorPtid === payload.actorPtid,
      },
      ts: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  if (payload.reason === 'logout' || payload.reason === 'revoked' || currentActorPtid !== payload.actorPtid) {
    useChatStore.getState().reset();
    toolRuntime.reset();
    useSessionStore.getState().reset();
    useSocialChatStore.getState().reset();
    useNotificationStore.getState().reset();
    useNavigationBadgeStore.getState().reset();
    useAccountIdentityStore.getState().reset();
    useSidebarStore.getState().reset();
    useGlobalContextStore.getState().reset();
  }
});

registerIdentityHandler('clear-client-storage-caches', async (payload) => {
  await createDesktopClientStorageRuntime({ ptid: payload.actorPtid ?? null }).kernel.invalidateDomains([
    'asset.avatar',
    'chat.conversation-settings',
    'chat.message',
    'config.preference',
    'identity.trust',
    'profile.peer',
    'runtime.projection',
  ]);
});

registerIdentityHandler('refresh-current-session', async (payload) => {
  if (payload.reason === 'logout' || payload.reason === 'revoked' || payload.reason === 'switch') {
    return;
  }
  try {
    await useSessionStore.getState().restoreSession();
    // #region debug-point F-G:session-restore-result
    void fetch('http://127.0.0.1:7781/event', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'foundation-login-readiness',
        runId: 'post-fix-3',
        hypothesisId: 'F-G',
        location: 'identityHandlers.ts:refresh-current-session',
        msg: '[DEBUG] session restore completed',
        data: {
          reason: payload.reason,
          sessionAuthenticated: useSessionStore.getState().authenticated,
          sessionActorPresent: Boolean(useSessionStore.getState().currentUser?.actorPtid),
        },
        ts: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  } catch (e) {
    if (e instanceof AuthCommandException && e.code === 'UNAUTHORIZED') {
      useSessionStore.getState().reset();
      // #region debug-point F:session-restore-unauthorized
      void fetch('http://127.0.0.1:7781/event', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'foundation-login-readiness',
          runId: 'post-fix-3',
          hypothesisId: 'F',
          location: 'identityHandlers.ts:refresh-current-session',
          msg: '[DEBUG] session restore unauthorized',
          data: { reason: payload.reason },
          ts: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      return;
    }
    throw e;
  }
});
