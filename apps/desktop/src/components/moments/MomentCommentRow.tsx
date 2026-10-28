import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Space, Typography, theme } from 'antd';
import { actorDisplayName } from '../../store/socialProfileProjection';
import { useActorIdentity } from '../common/useActorIdentity';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import type { MomentCommentItem } from './CommentList';

interface MomentCommentRowProps {
  comment: MomentCommentItem;
  children: ReactNode;
  highlighted?: boolean;
}

export function MomentCommentRow({ comment, children, highlighted = false }: MomentCommentRowProps) {
  const { t } = useTranslation('moments');
  const { token } = theme.useToken();
  const identity = useActorIdentity(comment.authorPtid, {
    requireCanonicalProfile: true,
  });
  const authorName = actorDisplayName(
    identity.displayName,
    t('moments.author.unknown'),
  );

  return (
    <div
      data-moments-comment={comment.id}
      data-search-anchor={highlighted || undefined}
      tabIndex={-1}
      style={{
        display: 'flex', gap: 10, padding: '2px 0',
        ...(highlighted ? { background: token.colorPrimaryBg, outlineColor: token.colorPrimary } : {}),
      }}
    >
      <UserSquareAvatar
        remoteUrl={identity.avatarUrl || undefined}
        name={authorName}
        size={26}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Space size={6} align="baseline">
          <Typography.Text strong style={{ fontSize: 13 }}>
            {authorName}
          </Typography.Text>
          {comment.replyToCommentId && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('moments.comment.replyingTo')}
            </Typography.Text>
          )}
        </Space>
        <Typography.Paragraph
          style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13 }}
        >
          {comment.content}
        </Typography.Paragraph>
        {children}
      </div>
    </div>
  );
}
