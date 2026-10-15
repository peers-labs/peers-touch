import { useState, type ReactNode } from 'react';
import { ChevronRight, MessagesSquare } from 'lucide-react';
import './inline-message-replies.css';

export const INLINE_REPLY_LIMIT = 10;

export interface InlineReply {
  id: string;
  avatar: ReactNode;
  body: ReactNode;
  time: string;
}

/** A reply count is disclosure metadata; reading replies never changes routes. */
export function InlineMessageReplies({
  replies, onOpenThread,
}: {
  replies: readonly InlineReply[];
  onOpenThread: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (replies.length === 0) return null;
  const visible = expanded ? replies : replies.slice(0, INLINE_REPLY_LIMIT);
  const remaining = replies.length - visible.length;
  return (
    <section className="prototype-inline-replies" aria-label="Message replies" data-chat-inline-replies={replies.length}>
      <button type="button" className="prototype-inline-replies-open"
        aria-label={`Open thread with ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
        onClick={onOpenThread}>
        <MessagesSquare size={13} aria-hidden="true" />
        <span>Thread · {replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>
        <ChevronRight size={13} aria-hidden="true" />
      </button>
      {visible.map((reply) => (
        <div key={reply.id} className="prototype-inline-reply" data-chat-inline-reply={reply.id}>
          {reply.avatar}
          <div className="prototype-inline-reply-content">
            <div className="prototype-inline-reply-body">{reply.body}</div>
            <time className="prototype-inline-reply-time">{reply.time}</time>
          </div>
        </div>
      ))}
      {remaining > 0 && (
        <button type="button" className="prototype-inline-replies-more" data-chat-replies-more
          onClick={() => setExpanded(true)}>
          Show {remaining} more
        </button>
      )}
    </section>
  );
}
