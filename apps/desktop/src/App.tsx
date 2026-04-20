import { type ComponentType, useEffect, useRef, useCallback } from 'react';
import { Modal } from 'antd';
import { useAppLifecycle, clearWarmResume } from './hooks/useAppLifecycle';
import { OnboardingView } from './views/OnboardingView';
import { ReadyView } from './views/ReadyView';
import { onSessionRevoked } from './services/desktop_api';
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

  const handleSessionRevoked = useCallback(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    useSessionStore.getState().logout().catch(() => {});
    clearWarmResume();

    Modal.warning({
      title: 'Session Ended',
      content: 'Your account has been logged in on another device. This session has been terminated.',
      okText: 'OK',
      onOk: () => {
        window.location.reload();
      },
    });
  }, []);

  useEffect(() => {
    return onSessionRevoked(handleSessionRevoked);
  }, [handleSessionRevoked]);

  return <View lifecycle={lifecycle} />;
}

export default App;
