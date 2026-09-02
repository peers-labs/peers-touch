import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from 'antd';
import { useSessionStore } from '../store/session';
import { onSessionRevoked } from '../services/desktop_api';
import { installAppRuntime, installDeferredAppRuntimeProjections, teardownAppRuntime } from '../services/appRuntime';
import { installEventStreamBridge, teardownEventStreamBridge } from '../services/eventStream';
import { usePresence } from './usePresence';
import {
  installIdleRuntimes,
  markPhaseEnd,
  markPhaseStart,
  scheduleIdle,
} from '../kernel/boot';
import type { AppLifecycle } from '../types/navigation';

const CRITICAL_SESSION_RUNTIMES: ReadonlyArray<string> = [];

export function useAppRuntime(lifecycle: AppLifecycle): void {
  useRuntimeInstall(lifecycle);
  useDeferredProjections(lifecycle);
  usePresence();
  useEventStreamBridge();
  useSessionRevocationNotice(lifecycle);
}

function useRuntimeInstall(lifecycle: AppLifecycle): void {
  useEffect(() => {
    if (!lifecycle.dataReady) return;
    markPhaseStart('runtime:critical');
    installAppRuntime();
    markPhaseEnd('runtime:critical', { critical: CRITICAL_SESSION_RUNTIMES, mode: 'early' });
    return () => teardownAppRuntime();
  }, [lifecycle.dataReady]);
}

function useDeferredProjections(lifecycle: AppLifecycle): void {
  useEffect(() => {
    if (!lifecycle.authenticated) return;
    const session = useSessionStore.getState();
    const actorPtid = session.authenticated ? session.currentUser?.actorPtid ?? null : null;
    if (!actorPtid) return;
    return scheduleIdle(() => {
      void installDeferredAppRuntimeProjections();
      void installIdleRuntimes(actorPtid, CRITICAL_SESSION_RUNTIMES);
    });
  }, [lifecycle.authenticated]);
}

function useEventStreamBridge(): void {
  useEffect(() => {
    void installEventStreamBridge();
    return () => teardownEventStreamBridge();
  }, []);
}

function useSessionRevocationNotice(lifecycle: AppLifecycle): void {
  const { t } = useTranslation('common');
  const sessionEndedRef = useRef(false);

  useEffect(() => {
    if (lifecycle.authenticated) {
      sessionEndedRef.current = false;
    }
  }, [lifecycle.authenticated]);

  useEffect(() => {
    return onSessionRevoked((payload) => {
      const session = useSessionStore.getState();
      if (session.authenticated) return;
      if (!lifecycle.authenticated) return;

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
}
