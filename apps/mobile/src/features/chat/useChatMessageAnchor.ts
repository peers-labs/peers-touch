import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { MobileChatDetailRoute } from '../../app/navigation';
import { activeMobileDetailRoute, useMobileNavigationStore } from '../../app/navigation';
import type { BoundedListHandle } from '../../components/BoundedList';
import { useAuthStore } from '../auth/authStore';
import { useSocialStore } from '../social/socialStore';
import type { SocialMessage } from '../social/socialTypes';

/** Route intent materializes through the original Messaging projection owner. */
export function useChatMessageAnchor({
  route, conversationId, messages, threadMessages, threadRootMessageId,
  setThreadRootMessageId, highlight, controller,
}: {
  route: MobileChatDetailRoute | null;
  conversationId: string;
  messages: readonly SocialMessage[];
  threadMessages: readonly SocialMessage[];
  threadRootMessageId: string;
  setThreadRootMessageId: (id: string) => void;
  highlight: (id: string) => void;
  controller: RefObject<BoundedListHandle | null>;
}) {
  const target = route?.messageId ?? '';
  const selected = messages.find(message => message.ulid === target)
    ?? threadMessages.find(message => message.ulid === target);
  const root = route?.threadRootMessageId || selected?.threadRootUlid || '';
  const attempted = useRef('');
  const session = useAuthStore(state => state.session);
  const intentKey = `${session?.sessionId}:${conversationId}:${root}:${target}`;

  useEffect(() => {
    if (!target) return;
    if (threadRootMessageId !== root) setThreadRootMessageId(root);
    if (!root || attempted.current === intentKey) return;
    attempted.current = intentKey;
    void useSocialStore.getState().loadThreadMessages(conversationId, root).catch(() => {
      // The original owner publishes a route-local error and preserves Back.
    });
  }, [conversationId, intentKey, root, setThreadRootMessageId, target, threadRootMessageId]);

  useLayoutEffect(() => {
    if (!target || !selected || root !== threadRootMessageId) return;
    const task = requestAnimationFrame(() => {
      const currentRoute = activeMobileDetailRoute(useMobileNavigationStore.getState());
      if (useAuthStore.getState().session !== session
        || !currentRoute || !('messageId' in currentRoute)
        || currentRoute.messageId !== target) return;
      if (controller.current?.reveal(target)) highlight(target);
    });
    return () => cancelAnimationFrame(task);
  }, [controller, highlight, root, selected, session, target, threadMessages, threadRootMessageId]);
}
