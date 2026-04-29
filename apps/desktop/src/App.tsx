import { type ComponentType, useEffect, useRef } from 'react';
import { Modal } from 'antd';
import { useAppLifecycle } from './hooks/useAppLifecycle';
import { OnboardingView } from './views/OnboardingView';
import { ResumingView } from './views/ResumingView';
import { ReadyView } from './views/ReadyView';
import { onSessionRevoked } from './services/desktop_api';
import './services/identityHandlers';
import { installIdentityChangedBridge } from './services/identity_event';
import { installPresenceBridge, teardownPresenceBridge } from './services/presence';
import { installPeerPresenceBridge, teardownPeerPresenceBridge } from './services/peerPresence';
import { usePresence } from './hooks/usePresence';
import { useSessionStore } from './store/session';
import type { AppState, AppLifecycle } from './types/navigation';

interface ViewProps {
  lifecycle: AppLifecycle;
}

const APP_VIEWS: Record<AppState, ComponentType<ViewProps>> = {
  onboarding: OnboardingView,
  resuming: ResumingView,
  ready: ReadyView,
};

function App() {
  const lifecycle = useAppLifecycle();
  const View = APP_VIEWS[lifecycle.state];

  // Install the cross-window identity bridge once at app boot.
  useEffect(() => {
    installIdentityChangedBridge();
  }, []);

  // Presence supervisor: install the Tauri-side `presence.transition`
  // listener and start emitting browser-lifecycle triggers.
  useEffect(() => {
    void installPresenceBridge();
    return () => teardownPresenceBridge();
  }, []);
  usePresence();

  // Peer-presence bridge: relays Station's friend-chat presence SSE
  // (proxied by the Rust supervisor) into the social chat store. The
  // listener itself is just a thin router; the supervisor lifetime is
  // managed in `SocialChatPage` so it only runs when the user is on
  // the chat surface.
  useEffect(() => {
    void installPeerPresenceBridge();
    return () => teardownPeerPresenceBridge();
  }, []);

  // Reset guard when user successfully returns to ready state,
  // so a future revocation can show the notification again.
  const sessionEndedRef = useRef(false);
  useEffect(() => {
    if (lifecycle.state === 'ready') {
      sessionEndedRef.current = false;
    }
  }, [lifecycle.state]);

  // Single session-revoked handler: trigger logout + show user notification.
  // State transition is automatic — logout() sets authenticated=false,
  // which the derived AppState in useAppLifecycle picks up.
  useEffect(() => {
    return onSessionRevoked((payload) => {
      const { authenticated } = useSessionStore.getState();
      // Only handle revocation when there is an active session.
      if (!authenticated) return;

      useSessionStore.getState().logout().catch(() => {});

      // Show notification only once per revocation cycle.
      if (sessionEndedRef.current) return;
      sessionEndedRef.current = true;

      const reason = payload?.reason || 'unknown';
      Modal.warning({
        title: reason === 'expired' ? 'Session Expired' : 'Session Ended',
        content: reason === 'expired'
          ? 'Your session has expired. Please log in again.'
          : 'Your session has been terminated. Please log in again.',
        okText: 'OK',
      });
    });
  }, []);

  return <View lifecycle={lifecycle} />;
}

export default App;
