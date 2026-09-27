import copy from '../../../../locales/en/common.json';
import { demoGroups } from './data';
import { GRADIENTS, type Contact, type Conversation, type Message } from './types';

const ordinal = (index: number) => String(index + 1).padStart(3, '0');

// Presentation samples only. No Station, native history, or delivery assertions.
export const longListConversations: Conversation[] = Array.from({ length: 240 }, (_, index) => ({
  key: `long-chat-${ordinal(index)}`,
  name: `${copy['mobile.chat.thread']} ${ordinal(index)}`,
  avatar: ordinal(index),
  avatarGradient: GRADIENTS[index % GRADIENTS.length],
  lastMessage: `${copy['mobile.chat.threadReplyPlaceholder']} ${ordinal(index)}`,
  time: '09:41',
  unread: 0,
}));

export const longListContacts: Contact[] = Array.from({ length: 240 }, (_, index) => ({
  key: `long-contact-${ordinal(index)}`,
  name: `${copy['mobile.contacts.profile']} ${ordinal(index)}`,
  avatar: ordinal(index),
  avatarGradient: GRADIENTS[index % GRADIENTS.length],
  note: copy['mobile.contacts.alreadyFriend'],
}));

export interface RequestRowSample {
  key: string;
  contact: Contact;
  direction: 'incoming' | 'outgoing';
  status: 'pending';
}

export const longListRequests: RequestRowSample[] = Array.from({ length: 240 }, (_, index) => ({
  key: `long-request-${ordinal(index)}`,
  contact: {
    key: `long-request-peer-${ordinal(index)}`,
    name: `${copy['mobile.contacts.profile']} R${ordinal(index)}`,
    avatar: ordinal(index),
    avatarGradient: GRADIENTS[index % GRADIENTS.length],
    note: copy['mobile.contacts.requestPending'],
  },
  direction: index % 2 === 0 ? 'incoming' : 'outgoing',
  status: 'pending',
}));

export const longListMembers: Contact[] = Array.from({ length: 240 }, (_, index) => ({
  key: `long-member-${ordinal(index)}`,
  name: `${copy['mobile.group.roleMember']} ${ordinal(index)}`,
  avatar: ordinal(index),
  avatarGradient: GRADIENTS[index % GRADIENTS.length],
  note: copy['mobile.group.roleMember'],
}));

export const longListGroups = [{ ...demoGroups[0], memberCount: longListMembers.length }];

export const longListMessages: Message[] = Array.from({ length: 480 }, (_, index) => ({
  id: `long-message-${ordinal(index)}`,
  mine: index % 3 === 0,
  text: Array.from({ length: index % 5 === 0 ? 4 : 1 },
    () => `${copy['mobile.chat.threadReplyPlaceholder']} ${ordinal(index)}`).join('\n'),
  time: `09:${String(index % 60).padStart(2, '0')}`,
  status: 'read',
  ...(index % 20 === 0 ? {
    threadCount: 3,
    threadReplies: Array.from({ length: 3 }, (_, replyIndex) => ({
      id: `long-reply-${ordinal(index)}-${replyIndex}`,
      mine: replyIndex % 2 === 0,
      text: `${copy['mobile.chat.reply']} ${ordinal(replyIndex)}`,
      time: '09:41',
      status: 'read' as const,
    })),
  } : {}),
}));
