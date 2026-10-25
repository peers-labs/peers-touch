import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useLifecyclePhase } from '../../app/lifecycle';
import type { MobileAuthSession } from '../auth/authSession';
import { useSocialStore } from '../social/socialStore';
import {
  MobileMutationAdmissionError,
} from '../../runtimes/mutationAdmission';
import { getRecoveryProjection } from '../../runtimes/recoveryProjection';
import { useSessionRuntime } from '../../runtimes/sessionRuntime';

const readWriteBlocked = () => getRecoveryProjection().getSnapshot().isWriteBlocked;
const subscribeWriteBlocked = (listener: () => void) =>
  getRecoveryProjection().subscribe(listener);

/** Visible Chat submits read intent after lifecycle and write recovery converge. */
export function useChatReadCursor({
  session, conversationId, messageId, sequence, visible, onError,
}: {
  session: MobileAuthSession | null;
  conversationId: string;
  messageId: string;
  sequence: number;
  visible: boolean;
  onError: (error: unknown) => void;
}) {
  const phase = useLifecyclePhase();
  const { writesAllowed } = useSessionRuntime();
  const selectedConversationId = useSocialStore(state => state.activeSessionUlid);
  const writeBlocked = useSyncExternalStore(
    subscribeWriteBlocked, readWriteBlocked, readWriteBlocked,
  );
  const acknowledged = useRef({ scope: '', sequence: 0 });
  const scope = session
    ? `${session.sessionId}:${session.lifecycleGeneration}:${conversationId}`
    : '';

  useEffect(() => {
    if (!visible || !scope || !messageId || sequence <= 0
      || selectedConversationId !== conversationId
      || phase !== 'ACTIVE' || !writesAllowed || writeBlocked) return;
    if (acknowledged.current.scope === scope
      && acknowledged.current.sequence >= sequence) return;
    let current = true;
    void useSocialStore.getState().markActiveSessionRead(conversationId, messageId)
      .then(() => {
        if (current) acknowledged.current = { scope, sequence };
      })
      .catch((error: unknown) => {
        // A fence closing before dispatch is expected; recovery triggers new intent.
        if (current && !(error instanceof MobileMutationAdmissionError)) onError(error);
      });
    return () => { current = false; };
  }, [conversationId, messageId, onError, phase, scope, selectedConversationId, sequence,
    visible, writeBlocked, writesAllowed]);
}
