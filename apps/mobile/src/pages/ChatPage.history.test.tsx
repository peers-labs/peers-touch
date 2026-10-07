import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeMessage, normalizeSession } from '../features/social/socialNormalizers';
import { useSocialStore } from '../features/social/socialStore';
import { ChatPage } from './ChatPage';

vi.mock('../app/mobileI18n', () => ({
  useMobileI18n: () => ({ t: (key: string) => key }),
}));
vi.mock('../features/social/socialStore', async (original) => {
  const module = await original<typeof import('../features/social/socialStore')>();
  return {
    ...module,
    useSocialStore: Object.assign(
      (select: (state: ReturnType<typeof module.useSocialStore.getState>) => unknown) =>
        select(module.useSocialStore.getState()),
      module.useSocialStore,
    ),
  };
});
describe('Chat logical history and rendering', () => {
  beforeEach(() => {
    useSocialStore.setState(useSocialStore.getInitialState(), true);
    useSocialStore.setState({
      currentUserPtid: 'ptid:alice',
      sessions: [normalizeSession({
        ulid: 'conversation',
        participantAPtid: 'ptid:alice',
        participantBPtid: 'ptid:bob',
      })],
      messages: { conversation: Array.from({ length: 240 }, (_, index) =>
        normalizeMessage({
          ulid: `message-${index}`,
          sessionUlid: 'conversation',
          senderPtid: 'ptid:bob',
          content: `History ${index}`,
          sentAt: { seconds: index + 1, nanos: 0 },
        }),
      ) },
    });
  });

  it('keeps a reachable earlier-history control while bounding mounted messages', () => {
    const html = renderToStaticMarkup(<ChatPage
      activeDetail={{ routeId: 'detail:chat-conversation', sessionUlid: 'conversation' }}
      onBack={() => undefined}
      onOpenConversation={() => undefined}
    />);
    expect(html.match(/data-message-ulid=/g)).toHaveLength(200);
    expect(html).toContain('mobile.list.previous');
    expect(html).toContain('data-window-total="240"');
    expect(html).toContain('History 239');
  });
});
