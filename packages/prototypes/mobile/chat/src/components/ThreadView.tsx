import { useState } from 'react';
import { Typography } from 'antd';
import { ArrowLeft, File, Image as ImageIcon } from 'lucide-react';
import type { Message, Conversation } from '../types';
import { messageSender, mobileMessageClusters } from '../messagePresentation';
import { IdentityAvatar } from './IdentityAvatar';
import { MessageAuthor } from '../../../../shared/MessageAuthor';
import {
  MobileMessageComposer,
  type MobileComposerAttachment,
} from './MobileMessageComposer';

const { Text } = Typography;

export function ThreadView({ message, conversation, onBack, onReply }: {
  message: Message;
  conversation: Conversation;
  onBack: () => void;
  onReply: (text: string, attachment?: MobileComposerAttachment) => void;
}) {
  const [threadInput, setThreadInput] = useState('');
  const replies = message.threadReplies ?? [];
  const clusters = mobileMessageClusters(replies, conversation);

  function handleThreadSend(attachment?: MobileComposerAttachment) {
    const text = threadInput.trim();
    if (!text && !attachment) return;
    onReply(text, attachment);
    setThreadInput('');
  }

  return (
    <div className="mp-thread-view">
      <header className="mp-thread-header">
        <button type="button" className="mp-thread-back" onClick={onBack} aria-label="Back">
          <ArrowLeft size={22} />
        </button>
        <div className="mp-thread-contact">
          <div className="mp-thread-contact-info">
            <Text strong className="mp-thread-name">Thread</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>{messageSender(message, conversation).name}</Text>
          </div>
        </div>
      </header>

      <div className="mp-thread-root-msg">
        <div className="mp-thread-root-text">{message.text}</div>
      </div>

      <div className="mp-thread-replies-header">{replies.length} replies</div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {replies.map((reply) => {
          const sender = messageSender(reply, conversation);
          const cluster = clusters.get(reply.id)!;
          return (
          <div key={reply.id}
            className={`mp-thread-reply-item ${reply.mine ? 'mine' : 'peer'} ${cluster.start ? 'cluster-start' : ''}`}>
            {!reply.mine && <span className="mp-message-avatar-slot">
              {cluster.start && <MessageAuthor name={sender.name}><IdentityAvatar name={sender.name} initials={sender.avatar}
                src={sender.avatarUrl} kind="person" size={32} /></MessageAuthor>}
            </span>}
            <div className="mp-thread-reply-content">
              {reply.image && !reply.moderated && !reply.recalled && (
                <div className="mp-thread-reply-image" style={{ background: reply.image }}>
                  <ImageIcon size={22} aria-hidden="true" />
                </div>
              )}
              {reply.file && !reply.moderated && !reply.recalled && (
                <div className="mp-thread-reply-file">
                  <File size={18} />
                  <span><strong>{reply.file.name}</strong><small>{reply.file.size}</small></span>
                </div>
              )}
              {(reply.text || reply.moderated || reply.recalled) && (
                <div className="mp-thread-reply-text">{reply.moderated ? 'Message removed by a moderator'
                  : reply.recalled ? 'Message recalled' : reply.text}</div>
              )}
              {cluster.end && <div className="mp-thread-reply-time">{reply.time}</div>}
            </div>
          </div>
          );
        })}
      </div>

      <MobileMessageComposer value={threadInput} onChange={setThreadInput}
        placeholder="Reply in thread…" onSend={handleThreadSend} />
    </div>
  );
}
