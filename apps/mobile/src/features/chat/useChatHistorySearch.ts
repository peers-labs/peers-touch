import { useEffect, useRef, useState } from 'react';
import type { MobileAuthSession } from '../auth/authSession';
import { dispatchSearchMessages, type ChatConversationKind, type ChatSearchCursor } from './chatCommands';

type SearchPage = Awaited<ReturnType<typeof dispatchSearchMessages>>;
interface SearchState {
  query: string;
  loading: boolean;
  error: boolean;
  page: SearchPage | null;
  cursors: Array<ChatSearchCursor | undefined>;
  index: number;
}

const empty = (): SearchState => ({
  query: '', loading: false, error: false, page: null, cursors: [undefined], index: 0,
});

/** One-shot, intent-owned search; no page-created freshness runtime. */
export function useChatHistorySearch(
  session: MobileAuthSession | null,
  kind: ChatConversationKind,
  conversationId: string,
) {
  const [state, setState] = useState<SearchState>(empty);
  const revision = useRef(0);
  const scope = useRef({ session, kind, conversationId });
  if (scope.current.session !== session || scope.current.kind !== kind
    || scope.current.conversationId !== conversationId) {
    scope.current = { session, kind, conversationId };
    revision.current += 1;
  }
  const identity = scope.current;
  const publishedScope = useRef(identity);
  const visible = publishedScope.current === identity ? state : empty();
  useEffect(() => () => { revision.current += 1; }, []);

  const clear = () => {
    revision.current += 1;
    publishedScope.current = identity;
    setState(empty());
  };

  const load = async (query: string, cursors: SearchState['cursors'], index: number) => {
    const admittedRevision = ++revision.current;
    const current = () => revision.current === admittedRevision && scope.current === identity;
    publishedScope.current = identity;
    setState({ query, cursors, index, loading: true, error: false, page: null });
    try {
      if (!session) throw new Error('mobile.social.notAuthenticated');
      const page = await dispatchSearchMessages(session, kind, conversationId, query, cursors[index]);
      if (current()) setState({ query, cursors, index, loading: false, error: false, page });
    } catch {
      if (current()) setState({ query, cursors, index, loading: false, error: true, page: null });
    }
  };

  return {
    ...visible,
    clear,
    search: (query: string) => {
      if (!query.trim()) { clear(); return; }
      void load(query.trim(), [undefined], 0);
    },
    retry: () => { void load(visible.query, visible.cursors, visible.index); },
    previous: () => {
      if (visible.index > 0) void load(visible.query, visible.cursors, visible.index - 1);
    },
    next: () => {
      if (!visible.page?.nextCursor) return;
      void load(visible.query, [
        ...visible.cursors.slice(0, visible.index + 1),
        visible.page.nextCursor,
      ], visible.index + 1);
    },
  };
}
