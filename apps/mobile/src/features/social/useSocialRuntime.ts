import { useEffect, useRef } from 'react';

import type { MobileAuthSession } from '../auth/authSession';
import { mobileAuthScopeKey } from '../auth/mobileAuthIdentity';
import { startGroupRuntime } from '../group/groupRuntime';
import { useGroupStore } from '../group/groupStore';
import { useSocialStore } from './socialStore';
import { startSocialRuntime } from './socialRuntime';

export function useSocialRuntime(session: MobileAuthSession | null) {
  const bindSession = useSocialStore((state) => state.bindSession);
  const bindGroupSession = useGroupStore((state) => state.bindSession);
  const activeKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const sessionKey = session ? mobileAuthScopeKey(session) : null;
    if (sessionKey === activeKeyRef.current) return;
    activeKeyRef.current = sessionKey;

    bindSession(session);
    bindGroupSession(session);
    if (!session) return;

    const groupController = startGroupRuntime(session, useGroupStore.getState);
    const socialController = startSocialRuntime(session, useSocialStore.getState(), useGroupStore.getState(), groupController);

    return () => {
      activeKeyRef.current = null;
      socialController.teardown();
      groupController.teardown();
    };
  }, [bindGroupSession, bindSession, session]);
}
