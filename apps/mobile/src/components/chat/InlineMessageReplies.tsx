import { useState, type ReactNode } from 'react';
import { ChevronRight, MessagesSquare } from 'lucide-react';
import { useMobileI18n } from '../../app/mobileI18n';
import { BoundedList } from '../BoundedList';
import './message-presentation.css';

export interface InlineMessageReply {
  readonly id: string;
  readonly avatar: ReactNode;
  readonly body: ReactNode;
  readonly time: string;
}

export function InlineMessageReplies({ replies, onOpenThread }: {
  readonly replies: readonly InlineMessageReply[];
  readonly onOpenThread: () => void;
}) {
  const { t } = useMobileI18n();
  const [expanded, setExpanded] = useState(false);
  if (!replies.length) return null;
  const row = (reply: InlineMessageReply) => (
    <div key={reply.id} className="chat-inline-reply" data-chat-inline-reply={reply.id}>
      {reply.avatar}
      <div className="chat-inline-reply-content">
        <div className="chat-inline-reply-body">{reply.body}</div>
        <time>{reply.time}</time>
      </div>
    </div>
  );
  return (
    <section className="chat-inline-replies" aria-label={t('mobile.chat.thread')}
      data-chat-inline-replies={replies.length}>
      <button type="button" className="chat-inline-replies-open" onClick={onOpenThread}>
        <MessagesSquare size={13} />
        <span>{t('mobile.chat.inlineThreadCount', { count: replies.length })}</span>
        <ChevronRight size={13} />
      </button>
      {expanded ? (
        <BoundedList surfaceKey={`inline-replies:${replies[0].id}`} items={[...replies]} itemKey={(reply) => reply.id}>
          {(rows) => rows.map(row)}
        </BoundedList>
      ) : replies.slice(0, 10).map(row)}
      {!expanded && replies.length > 10 ? (
        <button type="button" className="chat-inline-replies-more" data-chat-replies-more
          onClick={() => setExpanded(true)}>
          {t('mobile.chat.showMoreReplies', { count: replies.length - 10 })}
        </button>
      ) : null}
    </section>
  );
}
