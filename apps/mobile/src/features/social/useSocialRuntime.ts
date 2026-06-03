import { useEffect } from 'react';

import type { MobileAuthSession } from '../auth/authSession';
import { useSocialStore } from './socialStore';
import { startSocialRuntime } from './socialRuntime';

export function useSocialRuntime(session: MobileAuthSession | null) {
  const bindSession = useSocialStore((state) => state.bindSession);

  useEffect(() => {
    bindSession(session);
    if (!session) return;

    const controller = startSocialRuntime(session, useSocialStore.getState());

    return () => {
      controller.teardown();
    };
  }, [bindSession, session]);
}
