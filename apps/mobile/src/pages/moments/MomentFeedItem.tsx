/**
 * MomentFeedItem.tsx — Single moment card in the feed
 *
 * Pure renderer that displays a Post with author info, content,
 * reaction summary, reaction picker, and media triggers. Visual hierarchy aligned with the prototype
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
import {
  BarChart3,
  Heart,
  Link as LinkIcon,
  MapPin,
  MessageCircle,
  Play,
  Repeat2,
  Share2,
  ShieldAlert,
  Trash2,
} from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import { MobileAvatar } from '../../components/MobileAvatar';
import type {
  MomentPolicyState,
  ReactionMutationState,
} from '../../features/social/momentsFeedStore';
import type { Post } from '../../gen/proto/domain/social/post_pb';
import { MomentImage } from './MomentImage';

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

function reactionStatusKey(
  status: ReactionMutationState['status'],
): string {
  switch (status) {
    case 'pending':
      return 'mobile.moments.reaction.pending';
    case 'retrying':
      return 'mobile.moments.reaction.retrying';
    case 'unknown-outcome':
      return 'mobile.moments.reaction.unknownOutcome';
    case 'rejected':
      return 'mobile.moments.reaction.rejected';
    case 'rolled-back':
      return 'mobile.moments.reaction.rolledBack';
  }
}

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
  readonly onDelete?: (postId: string) => void;
  readonly deleteBusy?: boolean;
  readonly onOpenAuthor?: (actorPtid: string, federationId: string) => void;
  readonly onOpenMedia?: (
    postId: string,
    attachmentId: string,
    kind: 'image' | 'video',
    trigger: HTMLButtonElement,
  ) => void;
  readonly reactionMutation?: ReactionMutationState;
  readonly policyState?: MomentPolicyState;
}

export function MomentFeedItem({
  post,
  onReact,
  onOpenComments,
  onDelete,
  deleteBusy = false,
  onOpenAuthor,
  onOpenMedia,
  reactionMutation,
  policyState = 'visible',
}: MomentFeedItemProps) {
  const { t } = useMobileI18n();

  const [showReactionPicker, setShowReactionPicker] = useState(false);

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
  const contentKind = post.content.case ?? 'unknown';

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
  const reactionBusy = reactionMutation?.status === 'pending'
    || reactionMutation?.status === 'retrying'
    || reactionMutation?.status === 'unknown-outcome';

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

  // Policy / block states
  if (policyState !== 'visible') {
    const blocked = policyState === 'blocked';
    return (
      <Card className="moments-card moments-card--policy" variant="borderless">
        <div className="moments-policy-inline" role="alert">
          <ShieldAlert size={24} strokeWidth={1.5} />
          <Text strong>
            {blocked
              ? t('mobile.moments.policy.blocked')
              : t('mobile.moments.policy.violation')
            }
          </Text>
          <Text type="secondary">
            {blocked
              ? t('mobile.moments.policy.blockedHint')
              : t('mobile.moments.policy.violationHint')
            }
          </Text>
        </div>
      </Card>
    );
  }

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
        <button
          type="button"
          className="moments-image-single moments-media-trigger"
          onClick={(event) => onOpenMedia?.(
            post.id,
            images[0].id,
            'image',
            event.currentTarget,
          )}
          aria-label={t('mobile.moments.media.open')}
        >
          <MomentImage
            attachment={images[0]}
            alt={images[0].altText || ''}
          />
        </button>
      );
    }
    const gridClass = images.length === 2 ? 'moments-image-grid-2' : 'moments-image-grid-3';
    return (
      <div className={gridClass}>
        {images.map((img, idx) => (
          <button
            type="button"
            className="moments-grid-image moments-media-trigger"
            key={img.id || idx}
            onClick={(event) => onOpenMedia?.(
              post.id,
              img.id,
              'image',
              event.currentTarget,
            )}
            aria-label={t('mobile.moments.media.open')}
          >
            <MomentImage
              attachment={img}
              alt={img.altText || ''}
            />
          </button>
        ))}
      </div>
    );
  };

  const renderStructuredContent = () => {
    switch (post.content.case) {
      case 'videoPost': {
        const video = post.content.value.video;
        return (
          <button
            type="button"
            className="moments-content-detail moments-content-video moments-media-trigger"
            onClick={(event) => video && onOpenMedia?.(
              post.id,
              video.id,
              'video',
              event.currentTarget,
            )}
            disabled={!video}
          >
            <Play size={18} aria-hidden="true" />
            <span>
              {video
                ? `${video.width || 0}\u00d7${video.height || 0} \u00b7 ${video.durationSeconds || 0}s`
                : t('mobile.moments.content.video')}
            </span>
          </button>
        );
      }
      case 'linkPost': {
        const link = post.content.value.link;
        return link ? (
          <div className="moments-content-detail moments-content-link">
            <LinkIcon size={18} aria-hidden="true" />
            <div>
              <strong>{link.title || link.url}</strong>
              <span>{link.url}</span>
            </div>
          </div>
        ) : null;
      }
      case 'pollPost': {
        const poll = post.content.value.poll;
        return poll ? (
          <div className="moments-content-detail moments-content-poll">
            <BarChart3 size={18} aria-hidden="true" />
            <div>
              {poll.options.map((option, index) => (
                <div key={`${index}:${option.text}`} className="moments-poll-option">
                  {option.text}
                </div>
              ))}
            </div>
          </div>
        ) : null;
      }
      case 'repostPost':
        return (
          <div className="moments-content-detail moments-content-repost">
            <Repeat2 size={18} aria-hidden="true" />
            <span>{post.content.value.originalPostId}</span>
          </div>
        );
      case 'locationPost': {
        const location = post.content.value.location;
        return location ? (
          <div className="moments-content-detail moments-content-location">
            <MapPin size={18} aria-hidden="true" />
            <div>
              <strong>{location.name}</strong>
              <span>{location.address}</span>
            </div>
          </div>
        ) : null;
      }
      case 'textPost':
      case 'imagePost':
      default:
        return null;
    }
  };

  return (
    <Card
      className="moments-card"
      variant="borderless"
      data-moment-content-kind={contentKind}
    >
      {/* Author header — Avatar 42px + name + time */}
      <button
        type="button"
        className="moments-card-header moments-author-trigger"
        onClick={() => onOpenAuthor?.(
          post.authorPtid || post.author?.id || '',
          post.author?.homeStationDomain || '',
        )}
        disabled={!onOpenAuthor}
      >
        <MobileAvatar
          src={post.author?.avatarUrl}
          size={42}
          style={{ borderRadius: 14 }}
        />
        <div className="moments-card-author">
          <Text strong className="moments-card-name">{authorName}</Text>
          <Text type="secondary" className="moments-card-time">{timeLabel}</Text>
        </div>
      </button>

      {/* Text content */}
      {textContent && (
        <p className="moments-card-text">{textContent}</p>
      )}

      {/* Image grid (1/2/3+ layout) */}
      {renderImageGrid()}
      {renderStructuredContent()}

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
            className={[
              'moments-action',
              reactionCounts.viewerReactionKind ? 'reacted' : '',
              reactionMutation?.status ?? '',
            ].filter(Boolean).join(' ')}
            onClick={toggleReactionPicker}
            disabled={reactionBusy}
            aria-busy={reactionBusy}
            aria-label={t('mobile.moments.reaction.reacted')}
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
          {onDelete ? (
            <button
              type="button"
              className="moments-action moments-action--delete"
              disabled={deleteBusy}
              aria-busy={deleteBusy}
              aria-label={t('mobile.moments.delete.action')}
              onClick={() => onDelete(post.id)}
            >
              <Trash2 size={18} />
            </button>
          ) : null}
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
                disabled={reactionBusy}
              >
                {REACTION_EMOJI[kind]}
              </button>
            ))}
          </div>
        )}
      </div>

      {reactionMutation && (
        <Text
          className={`moments-reaction-status moments-reaction-status--${reactionMutation.status}`}
          type={
            reactionMutation.status === 'rolled-back'
            || reactionMutation.status === 'rejected'
              ? 'danger'
              : 'secondary'
          }
          role="status"
          aria-live="polite"
        >
          {t(reactionStatusKey(reactionMutation.status))}
        </Text>
      )}
    </Card>
  );
}
