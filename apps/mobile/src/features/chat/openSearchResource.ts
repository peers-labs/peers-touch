import type { MobileDetailRoute } from '../../app/navigation';
import type { ResourceRef } from '../../gen/proto/domain/search/search_pb';
import { useSocialStore } from '../social/socialStore';

export function messagingSearchDetailRoute(resource: ResourceRef): MobileDetailRoute {
  if (!['message', 'conversation'].includes(resource.kind) || !resource.conversationId) {
    throw { code: 'SEARCH_RESOURCE_UNAVAILABLE' };
  }
  const social = useSocialStore.getState();
  const conversation = social.messagingConversations.find(row => row.conversationId === resource.conversationId);
  const direct = social.sessions.some(row => row.ulid === resource.conversationId);
  if (!conversation && !direct) throw { code: 'SEARCH_RESOURCE_UNAVAILABLE' };
  const anchor = {
    messageId: resource.kind === 'message' ? resource.messageId || resource.id : undefined,
    threadRootMessageId: resource.anchor?.kind === 'thread' ? resource.anchor.id : undefined,
  };
  return conversation?.kind === 2
    ? { routeId: 'detail:group-conversation', groupUlid: resource.conversationId, ...anchor }
    : { routeId: 'detail:chat-conversation', sessionUlid: resource.conversationId, ...anchor };
}
