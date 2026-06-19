import { type ComponentType, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from 'antd';
import { useAppLifecycle } from './hooks/useAppLifecycle';
import { OnboardingView } from './views/OnboardingView';
import { ResumingView } from './views/ResumingView';
import { ReadyView } from './views/ReadyView';
import { onSessionRevoked } from './services/desktop_api';
import './services/identityHandlers';
import { installAppRuntime, teardownAppRuntime } from './services/appRuntime';
import { usePresence } from './hooks/usePresence';
import { useSessionStore } from './store/session';
import {
  installIdleRuntimes,
  markPhaseEnd,
  markPhaseStart,
  scheduleIdle,
} from './kernel/boot';
import { installEventStreamBridge, teardownEventStreamBridge } from './services/eventStream';
import type { AppState, AppLifecycle } from './types/navigation';

// Critical session-scope runtimes installed during `runtime:critical`.
// `social` is currently the only kernel-managed runtime; everything else
// is still driven by `installAppRuntime` (legacy bridges) until those
// are wrapped in `RuntimeDescriptor`s. Adding a new id here is the
// supported way to mark a session-scope runtime as critical for first
// paint.
const CRITICAL_SESSION_RUNTIMES: ReadonlyArray<string> = [];

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
  const { t } = useTranslation('common');

  // Install app-level bridge listeners once at app boot. Supervisor
  // lifetimes still follow usePresence's authenticated actor edges.
  // `installAppRuntime` covers both legacy (presence, eventStream, ...)
  // and kernel-managed (`social` via `runtimes/socialRuntime.ts`)
  // runtimes; the kernel `runtime:critical` phase is observed here for
  // boot-trace symmetry.
  useEffect(() => {
    if (!lifecycle.dataReady) return;
    markPhaseStart('runtime:critical');
    installAppRuntime();
    markPhaseEnd('runtime:critical', { critical: CRITICAL_SESSION_RUNTIMES });
    return () => teardownAppRuntime();
  }, [lifecycle.dataReady]);

  // Schedule idle-scope runtime install once we hit `ready`. The
  // pipeline only activates the slot when an actor is known; otherwise
  // it's a no-op. This is a forward-compatible hook: as additional
  // runtimes are wrapped into `RuntimeDescriptor`s with `scope: 'session'`,
  // they will start appearing in the `runtime:idle` log line without any
  // change here.
  useEffect(() => {
    if (!lifecycle.authenticated) return;
    const session = useSessionStore.getState();
    const actorId = session.authenticated ? session.currentUser?.actorId ?? null : null;
    if (!actorId) return;
    return scheduleIdle(() => {
      void installIdleRuntimes(actorId, CRITICAL_SESSION_RUNTIMES);
    });
  }, [lifecycle.authenticated]);

  usePresence();

  // Realtime event-stream bridge: decodes the unified SSE plane
  // (messages, presence, resync, …) into typed eventBus dispatches.
  // The Rust supervisor lifetime is owned by `usePresence` (started
  // on the same edge as `app_launch`); here we only install the
  // decode listener, so the bridge itself is a singleton for the
  // life of the renderer.
  useEffect(() => {
    void installEventStreamBridge();
    return () => teardownEventStreamBridge();
  }, []);

  // Reset guard when user successfully returns to ready state,
  // so a future revocation can show the notification again.
  const sessionEndedRef = useRef(false);
  useEffect(() => {
    if (lifecycle.authenticated) {
      sessionEndedRef.current = false;
    }
  }, [lifecycle.authenticated]);

  // Session-revoked UI notification. Identity state transition is owned by
  // identityRuntime; App only decides whether to notify the visible user.
  useEffect(() => {
    return onSessionRevoked((payload) => {
      const { authenticated } = useSessionStore.getState();
      const sessionVisible = authenticated || lifecycle.authenticated;
      if (!sessionVisible) return;

      // Show notification only once per revocation cycle.
      if (sessionEndedRef.current) return;
      sessionEndedRef.current = true;

      const reason = payload?.reason || 'unknown';
      Modal.warning({
        title: reason === 'expired'
          ? t('desktop.auth.sessionExpiredTitle')
          : t('desktop.auth.sessionEndedTitle'),
        content: reason === 'expired'
          ? t('desktop.auth.sessionExpiredBody')
          : t('desktop.auth.sessionEndedBody'),
        okText: t('common.action.confirm'),
      });
    });
  }, [lifecycle.authenticated, t]);

  return <View lifecycle={lifecycle} />;
}

export default App;
