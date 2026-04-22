import { type ComponentType, useEffect, useRef, useCallback } from 'react';
import { Modal } from 'antd';
import { useAppLifecycle, clearWarmResume } from './hooks/useAppLifecycle';
import { OnboardingView } from './views/OnboardingView';
import { ReadyView } from './views/ReadyView';
import { onSessionRevoked } from './services/desktop_api';
import type { SessionRevokedPayload } from './kernel/events/types';
import { useSessionStore } from './store/session';
import type { AppState, AppLifecycle } from './types/navigation';

interface ViewProps {
  lifecycle: AppLifecycle;
}

const APP_VIEWS: Record<AppState, ComponentType<ViewProps>> = {
  onboarding: OnboardingView,
  resuming: ReadyView,
  ready: ReadyView,
};

function App() {
  const lifecycle = useAppLifecycle();
  const View = APP_VIEWS[lifecycle.state];
  const handledRef = useRef(false);

  const handleSessionRevoked = useCallback((payload: SessionRevokedPayload) => {
    if (handledRef.current) return;
    handledRef.current = true;

    useSessionStore.getState().logout().catch(() => {});
    clearWarmResume();

    const reason = payload?.reason || 'unknown';
    const title = reason === 'expired'
      ? 'Session Expired'
      : 'Session Ended';
    const content = reason === 'expired'
      ? 'Your session has expired. Please log in again.'
      : 'Your session has been terminated. Please log in again.';

    Modal.warning({
      title,
      content,
      okText: 'OK',
    });
  }, []);

  useEffect(() => {
    return onSessionRevoked(handleSessionRevoked);
  }, [handleSessionRevoked]);

  return <View lifecycle={lifecycle} />;
}

export default App;
