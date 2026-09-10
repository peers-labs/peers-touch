/**
 * MomentFeedItem.tsx — Single moment card in the feed
 *
 * Pure renderer that displays a Post with author info, content,
 * reaction summary, reaction picker, comment preview, and inline
 * comment input. Visual hierarchy aligned with the prototype
 * MomentsPage card layout (antd Card borderless, Avatar 42 px,
 * reaction tag row, 5-emoji picker, inline comment input).
 *
 * All interactions (react, comment, reply) dispatch through
 * callbacks to the parent.
 *
 * W6B: Initial implementation with reaction, comment count,
 * and policy/block state rendering.
 * W6B-sync: Restructured to prototype card layout.
 */

import { useCallback, useMemo, useState } from 'react';
import { Card, Typography } from 'antd';
import { Heart, MessageCircle, Send, Share2 } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import { MobileAvatar } from '../../components/MobileAvatar';
import type { Post } from '../../gen/proto/domain/social/post_pb';

const { Text } = Typography;

// ---------------------------------------------------------------------------
// Reaction emoji map (matches prototype REACTION_EMOJI)
// ---------------------------------------------------------------------------

const REACTION_EMOJI: Record<number, string> = {
  1: '\u{1F44D}', // like (thumbs up)
  2: '\u{2764}\u{FE0F}',  // love (heart)
  3: '\u{1F602}', // laugh
  4: '\u{1F62E}', // wow
  5: '\u{1F389}', // celebrate
};

const REACTION_KINDS: number[] = [1, 2, 3, 4, 5];

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

  // Local UI state for reaction picker and comment input
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [commentText, setCommentText] = useState('');

  const createdAtMs = useMemo(() => {
    if (!post.createdAt) return 0;
    return Number(post.createdAt.seconds) * 1000;
  }, [post.createdAt]);

  const timeLabel = createdAtMs > 0
    ? formatRelativeTime(createdAtMs, t)
    : '';

  const authorName = post.author?.displayName || post.author?.username || t('mobile.moments.time.justNow');

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

  // Reaction state — build per-kind counts from the reactions array
  const reactionCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    let viewerReactionKind: number | undefined;
    for (const r of post.reactions) {
      const count = Number(r.count ?? 0);
      if (count > 0) counts[r.kind] = count;
      if (r.reactedByViewer) viewerReactionKind = r.kind;
    }
    return { counts, viewerReactionKind };
  }, [post.reactions]);

  const totalReactions = useMemo(
    () => Object.values(reactionCounts.counts).reduce((sum, n) => sum + n, 0),
    [reactionCounts.counts],
  );

  const commentCount = Number(post.stats?.commentsCount ?? 0);

  // Handlers
  const toggleReactionPicker = useCallback(() => {
    setShowReactionPicker((prev) => !prev);
  }, []);

  const handlePickReaction = useCallback(
    (kind: number) => {
      onReact(post.id, kind);
      setShowReactionPicker(false);
    },
    [post.id, onReact],
  );

  const handleSendComment = useCallback(() => {
    const trimmed = commentText.trim();
    if (!trimmed) return;
    // Open the full comments panel to type there (production flow)
    onOpenComments(post.id);
    setCommentText('');
  }, [commentText, post.id, onOpenComments]);

  // Policy / block states
  if (post.isDeleted) {
    return (
      <Card className="moments-card" variant="borderless">
        <Text type="secondary">{t('mobile.moments.detail.deleted')}</Text>
      </Card>
    );
  }

  // Image grid renderer
  const renderImageGrid = () => {
    if (images.length === 0) return null;
    if (images.length === 1) {
      return (
        <div className="moments-image-single">
          <img
            src={images[0].thumbnailUrl || images[0].url}
            alt={images[0].altText || ''}
            loading="lazy"
          />
        </div>
      );
    }
    const gridClass = images.length === 2 ? 'moments-image-grid-2' : 'moments-image-grid-3';
    return (
      <div className={gridClass}>
        {images.map((img, idx) => (
          <div className="moments-grid-image" key={img.id || idx}>
            <img
              src={img.thumbnailUrl || img.url}
              alt={img.altText || ''}
              loading="lazy"
            />
          </div>
        ))}
      </div>
    );
  };

  return (
    <Card className="moments-card" variant="borderless">
      {/* Author header — Avatar 42px + name + time */}
      <div className="moments-card-header" onClick={() => onOpenDetail(post.id)}>
        <MobileAvatar
          src={post.author?.avatarUrl}
          size={42}
          style={{ borderRadius: 14 }}
        />
        <div className="moments-card-author">
          <Text strong className="moments-card-name">{authorName}</Text>
          <Text type="secondary" className="moments-card-time">{timeLabel}</Text>
        </div>
      </div>

      {/* Text content */}
      {textContent && (
        <p className="moments-card-text">{textContent}</p>
      )}

      {/* Image grid (1/2/3+ layout) */}
      {renderImageGrid()}

      {/* Reaction summary tags */}
      {totalReactions > 0 && (
        <div className="moments-reaction-summary">
          {REACTION_KINDS.map((kind) => {
            const count = reactionCounts.counts[kind] ?? 0;
            if (count === 0) return null;
            return (
              <span
                key={kind}
                className={`moments-reaction-tag ${reactionCounts.viewerReactionKind === kind ? 'mine' : ''}`}
              >
                {REACTION_EMOJI[kind]} {count}
              </span>
            );
          })}
        </div>
      )}

      {/* Action row — Heart + MessageCircle + Share2 disabled */}
      <div className="moments-card-actions" onClick={(e) => e.stopPropagation()}>
        <div className="moments-action-group">
          <button
            type="button"
            className={`moments-action ${reactionCounts.viewerReactionKind ? 'reacted' : ''}`}
            onClick={toggleReactionPicker}
          >
            <Heart size={18} fill={reactionCounts.viewerReactionKind ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            className="moments-action"
            onClick={() => onOpenComments(post.id)}
          >
            <MessageCircle size={18} />
            {commentCount > 0 && <span>{commentCount}</span>}
          </button>
          <button
            type="button"
            className="moments-action moments-action--share"
            disabled
            title={t('mobile.moments.reaction.celebrate')}
          >
            <Share2 size={18} />
          </button>
        </div>

        {/* Reaction picker — 5 emoji buttons */}
        {showReactionPicker && (
          <div className="moments-reaction-picker">
            {REACTION_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className={`moments-reaction-picker-btn ${reactionCounts.viewerReactionKind === kind ? 'active' : ''}`}
                onClick={() => handlePickReaction(kind)}
              >
                {REACTION_EMOJI[kind]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Inline comment input with Send button */}
      <div className="moments-comment-input-row">
        <input
          type="text"
          className="moments-comment-input"
          placeholder={t('mobile.moments.comment.placeholder')}
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSendComment();
            }
          }}
        />
        <button
          type="button"
          className={`moments-comment-send ${commentText.trim() ? 'active' : ''}`}
          onClick={handleSendComment}
        >
          <Send size={14} />
        </button>
      </div>
    </Card>
  );
}
