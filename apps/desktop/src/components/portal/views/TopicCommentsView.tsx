import { useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { theme, Typography, Input, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { MessageCircle, Trash2, Send } from 'lucide-react';

import { useTopicCommentStore, type TopicComment } from '../../../store/topicComments';

interface TopicCommentsViewProps {
  topicKey: string;
}

export function TopicCommentsView({ topicKey }: TopicCommentsViewProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const comments = useTopicCommentStore((s) => s.commentsByTopic[topicKey] || []);
  const addComment = useTopicCommentStore((s) => s.addComment);
  const deleteComment = useTopicCommentStore((s) => s.deleteComment);
  const [input, setInput] = useState('');

  const handleSubmit = () => {
    if (!input.trim()) return;
    addComment(topicKey, input);
    setInput('');
  };

  return (
    <Flexbox style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Flexbox
        horizontal
        align="center"
        gap={8}
        style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0,
        }}
      >
        <MessageCircle size={16} color={token.colorPrimary} />
        <Typography.Text strong style={{ fontSize: 13 }}>
          {t('chat.topicComments.title')}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          ({comments.length})
        </Typography.Text>
      </Flexbox>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {comments.length === 0 ? (
          <Typography.Text type="secondary" style={{ fontSize: 12, textAlign: 'center', marginTop: 24 }}>
            {t('chat.topicComments.empty')}
          </Typography.Text>
        ) : (
          comments.map((comment: TopicComment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              token={token}
              onDelete={() => deleteComment(topicKey, comment.id)}
            />
          ))
        )}
      </div>

      <Flexbox
        horizontal
        gap={8}
        style={{
          padding: '8px 16px',
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0,
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={handleSubmit}
          placeholder={t('chat.topicComments.placeholder')}
          size="small"
          style={{ flex: 1 }}
        />
        <Button
          type="primary"
          size="small"
          icon={<Send size={12} />}
          onClick={handleSubmit}
          disabled={!input.trim()}
        />
      </Flexbox>
    </Flexbox>
  );
}

function CommentItem({ comment, token, onDelete }: { comment: TopicComment; token: any; onDelete: () => void }) {
  const timeStr = new Date(comment.createdAt).toLocaleString();
  return (
    <Flexbox
      style={{
        padding: '8px 10px',
        borderRadius: 6,
        background: token.colorFillQuaternary,
        fontSize: 13,
      }}
    >
      <Flexbox horizontal justify="space-between" align="center">
        <Typography.Text type="secondary" style={{ fontSize: 10 }}>
          {timeStr}
        </Typography.Text>
        <button
          onClick={onDelete}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 2,
            color: token.colorTextTertiary,
            display: 'flex',
          }}
        >
          <Trash2 size={11} />
        </button>
      </Flexbox>
      <div style={{ marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {comment.content}
      </div>
    </Flexbox>
  );
}
