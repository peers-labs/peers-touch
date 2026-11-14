import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createFeedbackChannel, type FeedbackChannel } from '@peers-touch/ui';
import { sessionIdentityScope, type SessionIdentityScope } from '../kernel/sessionIdentity';
import { useSessionStore } from '../store/session';

export const AppFeedbackContext = createContext<FeedbackChannel | null>(null);

function sameScope(a: SessionIdentityScope | null, b: SessionIdentityScope | null): boolean {
  return a?.actorPtid === b?.actorPtid
    && a?.stationPeerId === b?.stationPeerId
    && a?.sessionEpoch === b?.sessionEpoch;
}

/** Bind the SDK's transient feedback to the existing session owner. */
export function bindFeedbackSession(channel: FeedbackChannel): () => void {
  const noticeIds = new Set<string>();
  const unsubscribeNotices = channel.notices.subscribe(event => {
    if ('dismiss' in event) noticeIds.delete(event.dismiss);
    else noticeIds.add(event.id);
  });
  const clear = () => {
    for (const id of noticeIds) channel.dismissNotice(id);
    channel.clear();
  };
  let scope = sessionIdentityScope(useSessionStore.getState());
  const unsubscribeSession = useSessionStore.subscribe(session => {
    const next = sessionIdentityScope(session);
    if (!sameScope(scope, next)) {
      scope = next;
      clear();
    }
  });
  return () => {
    unsubscribeSession();
    clear();
    unsubscribeNotices();
  };
}

/** The shell owns one SDK channel and its identity-bound lifetime per window. */
export function useAppFeedback(): FeedbackChannel {
  const [channel] = useState(createFeedbackChannel);
  useEffect(() => bindFeedbackSession(channel), [channel]);
  return channel;
}

export function captureScopedFeedback(channel: FeedbackChannel | null, isAlive: () => boolean) {
  const scope = sessionIdentityScope(useSessionStore.getState());
  const notify = (message: string, tone: 'success' | 'warning' | 'danger') => {
    if (isAlive() && scope && sameScope(scope, sessionIdentityScope(useSessionStore.getState()))) {
      channel?.notify({ message, tone });
    }
  };
  return {
    success: (message: string) => notify(message, 'success'),
    warning: (message: string) => notify(message, 'warning'),
    error: (message: string) => notify(message, 'danger'),
  };
}

/** Capture authority before an async command; late results cannot cross sessions. */
export function useScopedFeedback() {
  const channel = useContext(AppFeedbackContext);
  const scopeKey = useSessionStore(state =>
    `${state.authenticated}:${state.currentUser?.actorPtid ?? ''}:${state.stationPeerId ?? ''}:${state.sessionEpoch}`);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  return useMemo(() => captureScopedFeedback(channel, () => alive.current), [channel, scopeKey]);
}
