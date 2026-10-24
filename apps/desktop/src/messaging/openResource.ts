import type { ResourceRef } from '../gen/proto/domain/search/search_pb';
import { messagingDomainRuntime } from './runtime';
import { socialThreadKey, useSocialChatStore } from '../store/socialChat';
import { ConversationStatus } from '../gen/proto/domain/chat/conversation_pb';

// Open is executed by Messaging. Search passes only an owner-resolved reference.
export async function openMessagingResource(
  resource: ResourceRef, showChat: () => void, isCurrent: () => boolean,
): Promise<void> {
  const scope = messagingDomainRuntime.requireActiveScope();
  const conversationId = resource.conversationId;
  if (!conversationId || !['message', 'conversation'].includes(resource.kind)) throw new Error('invalid resource');
  let store = useSocialChatStore.getState();
  let conversation = store.conversations.find(item => item.conversationId === conversationId);
  if (!conversation) {
    await store.loadSessions();
    if (!messagingDomainRuntime.isCurrent(scope) || !isCurrent()) throw new Error('scope changed');
    store = useSocialChatStore.getState();
    conversation = store.conversations.find(item => item.conversationId === conversationId);
  }
  if (!conversation || conversation.status === ConversationStatus.DISSOLVED
    || `station:${conversation.authorityStationPeerId}` !== resource.authorityNamespace) throw new Error('resource unavailable');
  if (!isCurrent()) throw new Error('cancelled');
  if (conversation.kind === 2) store.selectGroup(conversationId);
  else store.selectSession(conversationId);
  showChat();
  if (resource.kind === 'conversation') return;
  const messageId = resource.anchor?.id || resource.messageId;
  if (!messageId) throw new Error('missing anchor');
  await store.loadMessages(conversationId, conversation.kind === 2 ? 'group' : 'friend', messageId);
  if (!messagingDomainRuntime.isCurrent(scope) || !isCurrent()) throw new Error('scope changed');
  store = useSocialChatStore.getState();
  const anchor = store.messages[conversationId]?.find(item => item.ulid === messageId);
  if (!anchor) throw new Error('anchor unavailable');
  const root = anchor.threadRootUlid;
  if (root) {
    const kind = conversation.kind === 2 ? 'group' : 'friend';
    await store.loadThreadMessages(conversationId, root, kind);
    if (!messagingDomainRuntime.isCurrent(scope) || !isCurrent()) throw new Error('scope changed');
    if (!useSocialChatStore.getState().threadMessages[socialThreadKey(kind, conversationId, root)]
      ?.some(item => item.ulid === messageId)) throw new Error('thread anchor unavailable');
    store.openThread(root);
  }
  store.setScrollToMessageUlid(messageId);
}
