import { useChatStore } from '../store/chat';
import { MessageBubble } from './MessageBubble';

export function MessageList() {
  const messages = useChatStore((s) => s.messages);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 0' }}>
      {messages.map((message, index) => (
        <MessageBubble key={message.id} message={message} index={index} />
      ))}
    </div>
  );
}
