import { describe, expect, it } from 'vitest';
import { normalizeNotification } from '../features/social/socialNormalizers';
import type { SocialNotification } from '../features/social/socialTypes';
import type { MobileDetailRoute } from '../app/navigation';
import { notificationDetailRoute } from './MobileNotificationCenter';

describe('notificationDetailRoute', () => {
  it.each<{ name: string; input: Partial<SocialNotification>; route: MobileDetailRoute | null }>([
    {
      name: 'Social owner comment mention',
      input: { type: 210, targetType: 'social-comment', targetId: 'comment-7',
        metadata: { post_id: 'post-3', comment_id: 'comment-7' } },
      route: { routeId: 'detail:moment', postId: 'post-3', commentId: 'comment-7' },
    },
    {
      name: 'comment resource target with normalized metadata',
      input: { type: 0, targetType: 'social-comment', targetId: 'comment-8',
        metadata: { postId: 'post-4' } },
      route: { routeId: 'detail:moment', postId: 'post-4', commentId: 'comment-8' },
    },
    {
      name: 'mention whose parent is unavailable',
      input: { type: 210, targetType: 'social-comment', targetId: 'comment-9', metadata: {} },
      route: null,
    },
    {
      name: 'direct message target',
      input: { type: 202, targetType: 'friend_chat_session', targetId: 'chat-5',
        metadata: { message_id: 'message-6' } },
      route: { routeId: 'detail:chat-conversation', sessionUlid: 'chat-5', messageId: 'message-6' },
    },
    {
      name: 'ordinary post notification',
      input: { type: 0, targetType: 'post', targetId: 'post-5', metadata: {} },
      route: { routeId: 'detail:moment', postId: 'post-5', commentId: undefined },
    },
  ])('resolves $name', ({ input, route }) => {
    expect(notificationDetailRoute(normalizeNotification(input))).toEqual(route);
  });
});
