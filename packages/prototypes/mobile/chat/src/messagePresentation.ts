import type { Conversation, Message, MessageSender } from './types';
import { presentMessageClusters } from '../../../shared/message-presentation';

export function messageSender(message: Message, conversation: Conversation): MessageSender & { avatar: string } {
  if (message.mine) return { id: 'self', name: 'You', avatar: '' };
  if (conversation.isGroup) {
    const sender = message.sender;
    return sender ? {
      ...sender,
      avatar: sender.avatar ?? sender.name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join(''),
    } : { id: '', name: 'Unknown sender', avatar: '?' };
  }
  return {
    id: conversation.key,
    name: conversation.name,
    avatar: conversation.avatar,
    avatarUrl: conversation.avatarUrl,
  };
}

// Demo clocks are local day offsets; date separator rows carry day boundaries.
function demoTimestamp(time: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i.exec(time);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || hour > (match[3] ? 12 : 23)) return undefined;
  const clockHour = match[3] ? hour % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0) : hour;
  return (clockHour * 60 + minute) * 60_000;
}

export function mobileMessageClusters(messages: readonly Message[], conversation: Conversation) {
  return presentMessageClusters(messages.map((message) => ({
    id: message.id,
    senderId: messageSender(message, conversation).id,
    own: message.mine,
    timestamp: message.timestamp ?? demoTimestamp(message.time),
    barrier: Boolean(message.dateLabel || message.recalled || message.moderated),
  })), Boolean(conversation.isGroup));
}
