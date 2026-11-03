import { t } from './i18n';
import { demoGroups } from './data';
import type { Contact, Conversation, Message } from './types';

const ordinal = (index: number) => String(index + 1).padStart(3, '0');

// Presentation samples only. No Station, native history, or delivery assertions.
export const longListConversations: Conversation[] = Array.from({ length: 240 }, (_, index) => ({
  key: `long-chat-${ordinal(index)}`,
  name: `${t('mobile.chat.thread')} ${ordinal(index)}`,
  avatar: ordinal(index),
  lastMessage: `${t('mobile.chat.threadReplyPlaceholder')} ${ordinal(index)}`,
  time: '09:41',
  unread: 0,
}));

export const longListContacts: Contact[] = Array.from({ length: 240 }, (_, index) => ({
  key: `long-contact-${ordinal(index)}`,
  name: `${t('mobile.contacts.profile')} ${ordinal(index)}`,
  avatar: ordinal(index),
  note: t('mobile.contacts.alreadyFriend'),
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
    name: `${t('mobile.contacts.profile')} R${ordinal(index)}`,
    avatar: ordinal(index),
    note: t('mobile.contacts.requestPending'),
  },
  direction: index % 2 === 0 ? 'incoming' : 'outgoing',
  status: 'pending',
}));

export const longListMembers: Contact[] = Array.from({ length: 240 }, (_, index) => ({
  key: `long-member-${ordinal(index)}`,
  name: `${t('mobile.group.roleMember')} ${ordinal(index)}`,
  avatar: ordinal(index),
  note: t('mobile.group.roleMember'),
}));

export const longListGroups = [{ ...demoGroups[0], memberCount: longListMembers.length }];

export const longListMessages: Message[] = Array.from({ length: 480 }, (_, index) => ({
  id: `long-message-${ordinal(index)}`,
  mine: index % 3 === 0,
  text: Array.from({ length: index % 5 === 0 ? 4 : 1 },
    () => `${t('mobile.chat.threadReplyPlaceholder')} ${ordinal(index)}`).join('\n'),
  time: `09:${String(index % 60).padStart(2, '0')}`,
  status: 'read',
  ...(index % 20 === 0 ? {
    threadCount: 3,
    threadReplies: Array.from({ length: 3 }, (_, replyIndex) => ({
      id: `long-reply-${ordinal(index)}-${replyIndex}`,
      mine: replyIndex % 2 === 0,
      text: `${t('mobile.chat.reply')} ${ordinal(replyIndex)}`,
      time: '09:41',
      status: 'read' as const,
    })),
  } : {}),
}));
