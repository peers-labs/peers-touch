import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from 'antd';
import { useSessionStore } from '../store/session';
import { onSessionRevoked } from '../services/desktop_api';
import {
  CRITICAL_SESSION_RUNTIME_IDS,
  installAppRuntime,
  installAuthenticatedCriticalRuntimes,
  installDeferredAppRuntimeProjections,
  teardownAppRuntime,
} from '../services/appRuntime';
import { installEventStreamBridge, teardownEventStreamBridge } from '../services/eventStream';
import { usePresence } from './usePresence';
import {
  installIdleRuntimes,
  markPhaseEnd,
  markPhaseStart,
  scheduleIdle,
  tearDownSessionRuntimes,
} from '../kernel/boot';
import type { AppLifecycle } from '../types/navigation';

export function useAppRuntime(lifecycle: AppLifecycle): boolean {
  const actorPtid = useSessionStore((state) =>
    state.authenticated ? state.currentUser?.actorPtid ?? null : null);
  const [criticalActorPtid, setCriticalActorPtid] = useState<string | null>(null);
  useRuntimeInstall(lifecycle);
  useAuthenticatedRuntimes(
    lifecycle,
    actorPtid,
    setCriticalActorPtid,
  );
  usePresence();
  useEventStreamBridge();
  useSessionRevocationNotice(lifecycle);
  return !lifecycle.authenticated
    || (actorPtid !== null && criticalActorPtid === actorPtid);
}

function useRuntimeInstall(lifecycle: AppLifecycle): void {
  useEffect(() => {
    if (!lifecycle.dataReady) return;
    installAppRuntime();
    return () => teardownAppRuntime();
  }, [lifecycle.dataReady]);
}

function useAuthenticatedRuntimes(
  lifecycle: AppLifecycle,
  actorPtid: string | null,
  setCriticalActorPtid: (actorPtid: string | null) => void,
): void {
  useEffect(() => {
    if (!lifecycle.authenticated || !actorPtid) {
      setCriticalActorPtid(null);
      tearDownSessionRuntimes();
      return;
    }
    let cancelled = false;
    let cancelIdle: (() => void) | null = null;
    setCriticalActorPtid(null);
    markPhaseStart('runtime:critical');
    void installAuthenticatedCriticalRuntimes(actorPtid).then(() => {
      if (cancelled) return;
      setCriticalActorPtid(actorPtid);
      markPhaseEnd('runtime:critical', {
        actorPtid,
        critical: CRITICAL_SESSION_RUNTIME_IDS,
      });
      cancelIdle = scheduleIdle(() => {
        void installDeferredAppRuntimeProjections(actorPtid);
        void installIdleRuntimes(actorPtid, CRITICAL_SESSION_RUNTIME_IDS);
      });
    });
    return () => {
      cancelled = true;
      cancelIdle?.();
      tearDownSessionRuntimes();
    };
  }, [actorPtid, lifecycle.authenticated, setCriticalActorPtid]);
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
