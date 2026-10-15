import { useEffect, useRef, useState } from 'react';
import type { MobileAuthSession } from '../auth/authSession';
import type { SocialMessage } from '../social/socialTypes';
import { dispatchSearchMessages, type ChatSearchCursor } from './chatCommands';
import { messageTimestampMillis, type MobileConversation } from './chatSelectors';

export interface GlobalChatMessageResult {
  readonly conversation: MobileConversation;
  readonly message: SocialMessage;
}

interface GlobalSearchState {
  readonly query: string;
  readonly index: number;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly results: readonly GlobalChatMessageResult[];
  readonly pages: readonly ReadonlyMap<string, ChatSearchCursor | undefined>[];
  readonly next: ReadonlyMap<string, ChatSearchCursor>;
}

const empty = (): GlobalSearchState => ({
  query: '', index: 0, loading: false, failed: false,
  results: [], pages: [], next: new Map(),
});

/** Explicit search intents read every accessible conversation's native index. */
export function useGlobalChatSearch(
  session: MobileAuthSession | null,
  conversations: readonly MobileConversation[],
) {
  const [state, setState] = useState<GlobalSearchState>(empty);
  const revision = useRef(0);
  const owner = useRef(session);
  if (owner.current !== session) {
    owner.current = session;
    revision.current += 1;
  }
  const publishedOwner = useRef(session);
  const visible = publishedOwner.current === session ? state : empty();
  useEffect(() => () => { revision.current += 1; }, []);

  const clear = () => {
    revision.current += 1;
    publishedOwner.current = session;
    setState(empty());
  };
  const load = async (
    query: string,
    pages: GlobalSearchState['pages'],
    index: number,
  ) => {
    const admitted = ++revision.current;
    const current = () => revision.current === admitted && owner.current === session;
    const cursors = pages[index] ?? new Map();
    publishedOwner.current = session;
    setState({ ...empty(), query, pages, index, loading: true });
    try {
      if (!session) throw new Error('mobile.social.notAuthenticated');
      const results: GlobalChatMessageResult[] = [];
      const next = new Map<string, ChatSearchCursor>();
      const targets = conversations.filter((conversation) => cursors.has(conversation.key));
      // Bound native IPC concurrency; no full-history hydration or new background polling.
      for (let offset = 0; offset < targets.length && current(); offset += 4) {
        const batch = await Promise.all(targets.slice(offset, offset + 4).map(async (conversation) => ({
          conversation,
          page: await dispatchSearchMessages(
            session, conversation.kind,
            conversation.kind === 'friend'
              ? conversation.conversation.session.ulid
              : conversation.conversation.projection.conversationId,
            query, cursors.get(conversation.key),
          ),
        })));
        for (const { conversation, page } of batch) {
          results.push(...page.messages.map((message) => ({ conversation, message })));
          if (page.nextCursor) next.set(conversation.key, page.nextCursor);
        }
      }
      if (current()) setState({
        query, pages, index, loading: false, failed: false, next,
        results: results.sort((a, b) => messageTimestampMillis(b.message)
          - messageTimestampMillis(a.message) || b.message.ulid.localeCompare(a.message.ulid)),
      });
    } catch {
      if (current()) setState({ ...empty(), query, pages, index, failed: true });
    }
  };

  return {
    ...visible,
    clear,
    search: (query: string) => {
      if (!query.trim()) { clear(); return; }
      void load(query.trim(), [new Map(conversations.map((conversation) => [conversation.key, undefined]))], 0);
    },
    retry: () => { void load(visible.query, visible.pages, visible.index); },
    previous: () => {
      if (visible.index > 0) void load(visible.query, visible.pages, visible.index - 1);
    },
    nextPage: () => {
      if (visible.next.size) void load(
        visible.query, [...visible.pages.slice(0, visible.index + 1), visible.next], visible.index + 1,
      );
    },
  };
}
