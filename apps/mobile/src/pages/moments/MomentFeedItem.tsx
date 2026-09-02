/**
 * MomentFeedItem.tsx — Single moment card in the feed
 *
 * Pure renderer that displays a Post with author info, content,
 * reaction bar, and comment preview. All interactions (react,
 * comment, reply) dispatch through callbacks to the parent.
 *
 * W6B: Initial implementation with reaction, comment count,
 * and policy/block state rendering.
 */

import { useMemo } from 'react';
import { Button, Typography } from 'antd';
import { Heart, MessageCircle, Repeat2, Share2 } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import { MobileAvatar } from '../../components/MobileAvatar';
import type { Post, ReactionSummary } from '../../gen/proto/domain/social/post_pb';
import { Audience_Kind } from '../../gen/proto/domain/social/post_pb';

const { Text, Paragraph } = Typography;

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

function formatRelativeTime(
  timestampMs: number,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const now = Date.now();
  const diffMs = now - timestampMs;
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMinutes < 1) return t('mobile.moments.time.justNow');
  if (diffMinutes < 60) return t('mobile.moments.time.minutesAgo', { count: diffMinutes });
  if (diffHours < 24) return t('mobile.moments.time.hoursAgo', { count: diffHours });
  return t('mobile.moments.time.daysAgo', { count: diffDays });
}

function audienceLabel(
  kind: number,
  t: (key: string) => string,
): string {
  switch (kind) {
    case Audience_Kind.PUBLIC: return t('mobile.moments.audience.public');
    case Audience_Kind.FOLLOWERS: return t('mobile.moments.audience.followers');
    case Audience_Kind.CIRCLE: return t('mobile.moments.audience.circle');
    case Audience_Kind.SELF: return t('mobile.moments.audience.self');
    default: return t('mobile.moments.audience.public');
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MomentFeedItemProps {
  readonly post: Post;
  readonly onReact: (postId: string, reactionKind: number) => void;
  readonly onOpenComments: (postId: string) => void;
  readonly onOpenDetail: (postId: string) => void;
}

export function MomentFeedItem({
  post,
  onReact,
  onOpenComments,
  onOpenDetail,
}: MomentFeedItemProps) {
  const { t } = useMobileI18n();

  const createdAtMs = useMemo(() => {
    if (!post.createdAt) return 0;
    // Timestamp proto seconds to ms
    return Number(post.createdAt.seconds) * 1000;
  }, [post.createdAt]);

  const timeLabel = createdAtMs > 0
    ? formatRelativeTime(createdAtMs, t)
    : '';

  const authorName = post.author?.displayName || post.author?.username || t('mobile.moments.time.justNow');
  const authorHandle = post.author?.username ? `@${post.author.username}` : '';

  // Extract text content from post content union
  const textContent = useMemo(() => {
    if (post.content.case === 'textPost') return post.content.value.text;
    if (post.content.case === 'imagePost') return post.content.value.text;
    if (post.content.case === 'videoPost') return post.content.value.text;
    if (post.content.case === 'linkPost') return post.content.value.text;
    if (post.content.case === 'pollPost') return post.content.value.text;
    if (post.content.case === 'repostPost') return post.content.value.comment;
    if (post.content.case === 'locationPost') return post.content.value.text;
    return '';
  }, [post.content]);

  // Extract images if image post
  const images = useMemo(() => {
    if (post.content.case === 'imagePost') {
      return post.content.value.images ?? [];
    }
    return [];
  }, [post.content]);

  // Reaction state
  const likeReaction = useMemo(
    () => post.reactions.find((r) => r.kind === 1),
    [post.reactions],
  );
  const isLiked = likeReaction?.reactedByViewer ?? false;
  const likeCount = Number(likeReaction?.count ?? 0);
  const commentCount = Number(post.stats?.commentsCount ?? 0);
  const repostCount = Number(post.stats?.repostsCount ?? 0);

  // Audience label
  const audienceText = post.audience
    ? audienceLabel(post.audience.kind, t)
    : t('mobile.moments.audience.public');

  // Policy / block states
  if (post.isDeleted) {
    return (
      <div className="moments-feed-item moments-feed-item--deleted">
        <Text type="secondary">{t('mobile.moments.detail.deleted')}</Text>
      </div>
    );
  }

  return (
    <article
      className="moments-feed-item"
      role="article"
      onClick={() => onOpenDetail(post.id)}
    >
      {/* Author header */}
      <div className="moments-feed-item__header">
        <MobileAvatar
          src={post.author?.avatarUrl}
          size={40}
        />
        <div className="moments-feed-item__author">
          <Text strong className="moments-feed-item__name">{authorName}</Text>
          {authorHandle && (
            <Text type="secondary" className="moments-feed-item__handle">{authorHandle}</Text>
          )}
          <div className="moments-feed-item__meta">
            {timeLabel && <Text type="secondary">{timeLabel}</Text>}
            <Text type="secondary">{audienceText}</Text>
          </div>
        </div>
      </div>

      {/* Content */}
      {textContent && (
        <Paragraph className="moments-feed-item__text">{textContent}</Paragraph>
      )}

      {/* Image grid */}
      {images.length > 0 && (
        <div className={`moments-feed-item__images moments-feed-item__images--${Math.min(images.length, 3)}`}>
          {images.map((img, idx) => (
            <div className="moments-feed-item__image-wrap" key={img.id || idx}>
              <img
                src={img.thumbnailUrl || img.url}
                alt={img.altText || ''}
                loading="lazy"
              />
            </div>
          ))}
        </div>
      )}

      {/* Action bar */}
      <div className="moments-feed-item__actions" onClick={(e) => e.stopPropagation()}>
        <Button
          type="text"
          size="small"
          className={`moments-action-btn ${isLiked ? 'moments-action-btn--active' : ''}`}
          icon={<Heart size={16} fill={isLiked ? 'currentColor' : 'none'} />}
          onClick={() => onReact(post.id, 1)}
        >
          {likeCount > 0 ? String(likeCount) : t('mobile.moments.reaction.like')}
        </Button>

        <Button
          type="text"
          size="small"
          className="moments-action-btn"
          icon={<MessageCircle size={16} />}
          onClick={() => onOpenComments(post.id)}
        >
          {commentCount > 0 ? String(commentCount) : t('mobile.moments.comment.title')}
        </Button>

        <Button
          type="text"
          size="small"
          className="moments-action-btn"
          icon={<Repeat2 size={16} />}
          disabled
        >
          {repostCount > 0 ? String(repostCount) : ''}
        </Button>

        <Button
          type="text"
          size="small"
          className="moments-action-btn"
          icon={<Share2 size={16} />}
          disabled
        />
      </div>
    </article>
  );
}
