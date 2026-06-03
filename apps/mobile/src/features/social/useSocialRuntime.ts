import { useEffect } from 'react';

import type { MobileAuthSession } from '../auth/authSession';
import { startGroupRuntime } from '../group/groupRuntime';
import { useGroupStore } from '../group/groupStore';
import { useSocialStore } from './socialStore';
import { startSocialRuntime } from './socialRuntime';

export function useSocialRuntime(session: MobileAuthSession | null) {
  const bindSession = useSocialStore((state) => state.bindSession);
  const bindGroupSession = useGroupStore((state) => state.bindSession);

  useEffect(() => {
    bindSession(session);
    bindGroupSession(session);
    if (!session) return;

    const socialController = startSocialRuntime(session, useSocialStore.getState());
    const groupController = startGroupRuntime(session, useGroupStore.getState());

    return () => {
      socialController.teardown();
      groupController.teardown();
    };
  }, [bindGroupSession, bindSession, session]);
}
