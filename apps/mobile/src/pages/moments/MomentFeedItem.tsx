import {
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Typography } from 'antd';
import {
  Globe2,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Share2,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import { SocialActorAvatar } from '../../features/social/SocialActorAvatar';
import type {
  MomentPolicyState,
  ReactionMutationState,
} from '../../features/social/momentsFeedStore';
import {
  ActivitySource_Kind,
  Audience_Kind,
  ReactionKind,
  RelationshipReason_Kind,
  type FeedObjectExplanation,
  type Post,
} from '../../gen/proto/domain/social/post_pb';
import { MomentActionsSheet } from './MomentActionsSheet';
import { MomentContent, type OpenMomentMedia } from './MomentContent';

const { Text } = Typography;
const PRIMARY_REACTION_KIND = ReactionKind.REACTION_LOVE;
const PRIMARY_REACTION_EMOJI = '\u{2764}\u{FE0F}';

function formatRelativeTime(
  timestampMs: number,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const diffMs = Date.now() - timestampMs;
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffMinutes < 1) return t('mobile.moments.time.justNow');
  if (diffMinutes < 60)
    return t('mobile.moments.time.minutesAgo', { count: diffMinutes });
  if (diffHours < 24)
    return t('mobile.moments.time.hoursAgo', { count: diffHours });
  return t('mobile.moments.time.daysAgo', { count: diffDays });
}

function reactionStatusKey(status: ReactionMutationState['status']): string {
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

function audienceLabelKey(kind: Audience_Kind): string {
  switch (kind) {
    case Audience_Kind.PUBLIC:
      return 'mobile.moments.audience.public';
    case Audience_Kind.FOLLOWERS:
      return 'mobile.moments.audience.followers';
    case Audience_Kind.CIRCLE:
      return 'mobile.moments.audience.circle';
    case Audience_Kind.GROUP:
      return 'mobile.moments.audience.group';
    case Audience_Kind.SELF:
      return 'mobile.moments.audience.self';
    case Audience_Kind.CUSTOM_ALLOW:
      return 'mobile.moments.audience.customAllow';
    case Audience_Kind.CUSTOM_DENY:
      return 'mobile.moments.audience.customDeny';
    case Audience_Kind.FRIENDS:
      return 'mobile.moments.audience.friends';
    default:
      return 'mobile.moments.audience.public';
  }
}

function relationshipReasonLabelKey(
  kind: RelationshipReason_Kind,
): string | null {
  switch (kind) {
    case RelationshipReason_Kind.RELATIONSHIP_REASON_SELF:
      return 'mobile.moments.reason.self';
    case RelationshipReason_Kind.RELATIONSHIP_REASON_FOLLOWING:
      return 'mobile.moments.reason.following';
    case RelationshipReason_Kind.RELATIONSHIP_REASON_FOLLOWER:
      return 'mobile.moments.reason.follower';
    case RelationshipReason_Kind.RELATIONSHIP_REASON_MUTUAL:
      return 'mobile.moments.reason.mutual';
    case RelationshipReason_Kind.RELATIONSHIP_REASON_CIRCLE:
      return 'mobile.moments.reason.circle';
    case RelationshipReason_Kind.RELATIONSHIP_REASON_MENTIONED:
      return 'mobile.moments.reason.mentioned';
    case RelationshipReason_Kind.RELATIONSHIP_REASON_PUBLIC_FEDERATED:
      return 'mobile.moments.reason.publicFederated';
    case RelationshipReason_Kind.RELATIONSHIP_REASON_PROFILE_VIEW:
      return 'mobile.moments.reason.profileView';
    default:
      return null;
  }
}

interface MomentFeedItemProps {
  readonly post: Post;
  readonly children?: ReactNode;
  readonly onReact: (postId: string, reactionKind: number) => void;
  readonly onOpenComments: (postId: string) => void;
  readonly onDelete?: (postId: string) => void;
  readonly deleteBusy?: boolean;
  readonly onOpenAuthor?: (actorPtid: string, federationId: string) => void;
  readonly onOpenMedia?: OpenMomentMedia;
  readonly reactionMutation?: ReactionMutationState;
  readonly explanation?: FeedObjectExplanation;
  readonly policyState?: MomentPolicyState;
}

export function MomentFeedItem({
  post,
  children,
  onReact,
  onOpenComments,
  onDelete,
  deleteBusy = false,
  onOpenAuthor,
  onOpenMedia,
  reactionMutation,
  explanation,
  policyState = 'visible',
}: MomentFeedItemProps) {
  const { t } = useMobileI18n();
  const [showActions, setShowActions] = useState(false);
  const createdAtMs = post.createdAt
    ? Number(post.createdAt.seconds) * 1000
    : 0;
  const timeLabel = createdAtMs > 0 ? formatRelativeTime(createdAtMs, t) : '';
  const authorName =
    post.author?.displayName ||
    post.author?.username ||
    post.authorPtid ||
    t('mobile.moments.time.justNow');
  const source = explanation?.source;
  const sourceLabel =
    source?.stationDomain || post.author?.homeStationDomain || '';
  const sourceAndTime = [sourceLabel, timeLabel].filter(Boolean).join(' · ');
  const isRemote =
    source?.kind === ActivitySource_Kind.ACTIVITY_SOURCE_REMOTE ||
    Boolean(post.author?.homeStationDomain);
  const audienceKind =
    explanation?.audienceExplanation?.kind ??
    post.audience?.kind ??
    Audience_Kind.PUBLIC;
  const reasonKey = explanation?.relationshipReason
    ? relationshipReasonLabelKey(explanation.relationshipReason.kind)
    : null;
  const trustLabel = [
    t(audienceLabelKey(audienceKind)),
    reasonKey ? t(reasonKey) : sourceLabel,
  ]
    .filter(Boolean)
    .join(' · ');

  const heartReaction = useMemo(
    () => post.reactions.find(({ kind }) => kind === PRIMARY_REACTION_KIND),
    [post.reactions],
  );
  const heartCount = Number(heartReaction?.count ?? 0);
  const viewerReacted = heartReaction?.reactedByViewer ?? false;
  const reactionBusy =
    reactionMutation?.status === 'pending' ||
    reactionMutation?.status === 'retrying' ||
    reactionMutation?.status === 'unknown-outcome';
  const commentCount = Number(post.stats?.commentsCount ?? 0);

  if (policyState !== 'visible') {
    const blocked = policyState === 'blocked';
    return (
      <article
        className="moments-article moments-article--policy"
        data-product-surface="moments.policy-hidden"
      >
        <div className="moments-policy-inline" role="alert">
          <ShieldAlert size={24} strokeWidth={1.5} />
          <Text strong>
            {t(
              blocked
                ? 'mobile.moments.policy.blocked'
                : 'mobile.moments.policy.violation',
            )}
          </Text>
          <Text type="secondary">
            {t(
              blocked
                ? 'mobile.moments.policy.blockedHint'
                : 'mobile.moments.policy.violationHint',
            )}
          </Text>
        </div>
      </article>
    );
  }

  if (post.isDeleted) {
    return (
      <article className="moments-article">
        <Text type="secondary">{t('mobile.moments.detail.deleted')}</Text>
      </article>
    );
  }

  return (
    <article
      className="moments-article"
      data-acceptance-id="social-moment-card"
      data-post-id={post.id}
      data-moment-content-kind={post.content.case ?? 'unknown'}
    >
      <div className="moments-author-row">
        <button
          type="button"
          className="moments-author"
          data-acceptance-id="social-moment-author"
          onClick={() =>
            onOpenAuthor?.(
              post.authorPtid || post.author?.id || '',
              post.author?.homeStationDomain || '',
            )
          }
          disabled={!onOpenAuthor}
        >
          <SocialActorAvatar
            actorPtid={post.authorPtid || post.author?.id || ''}
            avatar={post.author?.avatarUrl}
            displayName={authorName}
            size={42}
            username={post.author?.username}
          />
          <span>
            <strong>{authorName}</strong>
            {sourceAndTime ? <small>{sourceAndTime}</small> : null}
          </span>
        </button>
        {onDelete ? (
          <button
            type="button"
            className="moments-more"
            aria-label={t('mobile.moments.actions')}
            onClick={() => setShowActions(true)}
          >
            <MoreHorizontal size={18} />
          </button>
        ) : null}
      </div>

      <MomentContent post={post} onOpenMedia={onOpenMedia} />

      <div className="moments-trust-meta">
        {isRemote ? <Globe2 size={13} /> : <ShieldCheck size={13} />}
        <span>{trustLabel}</span>
      </div>

      <div
        className="moments-actions"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="moments-reaction-summary" aria-hidden={heartCount === 0}>
          {heartCount > 0 ? (
            <span
              className={viewerReacted
                ? 'moments-reaction-tag mine'
                : 'moments-reaction-tag'}
            >
              {PRIMARY_REACTION_EMOJI} {heartCount}
            </span>
          ) : null}
        </div>
        <div className="moments-action-group">
          <button
            type="button"
            className={[
              'moments-action',
              viewerReacted ? 'reacted' : '',
              reactionMutation?.status ?? '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-acceptance-id="social-reaction-open"
            data-reaction-kind={PRIMARY_REACTION_KIND}
            onClick={() => onReact(post.id, PRIMARY_REACTION_KIND)}
            disabled={reactionBusy}
            aria-busy={reactionBusy}
            aria-label={t('mobile.moments.reaction.love')}
          >
            <Heart
              size={18}
              fill={viewerReacted ? 'currentColor' : 'none'}
            />
          </button>
          <button
            type="button"
            className="moments-action"
            data-acceptance-id="social-thread-open"
            data-post-id={post.id}
            onClick={() => onOpenComments(post.id)}
            aria-label={t('mobile.moments.comment.title')}
          >
            <MessageCircle size={18} />
            {commentCount > 0 ? (
              <span className="moments-action-count">{commentCount}</span>
            ) : null}
          </button>
          <button
            type="button"
            className="moments-action moments-action--share"
            disabled
            aria-label={t('mobile.moments.share.unavailable')}
            title={t('mobile.moments.share.unavailable')}
          >
            <Share2 size={18} />
          </button>
        </div>
      </div>

      {reactionMutation ? (
        <Text
          className={`moments-reaction-status moments-reaction-status--${
            reactionMutation.status
          }`}
          data-product-surface={
            reactionBusy
              ? 'moments.reaction-pending'
              : 'moments.reaction-rollback'
          }
          type={
            reactionMutation.status === 'rolled-back' ||
            reactionMutation.status === 'rejected'
              ? 'danger'
              : 'secondary'
          }
          role="status"
          aria-live="polite"
        >
          {t(reactionStatusKey(reactionMutation.status))}
        </Text>
      ) : null}

      {children}

      {showActions && onDelete ? (
        <MomentActionsSheet
          busy={deleteBusy}
          onClose={() => setShowActions(false)}
          onDelete={() => onDelete(post.id)}
        />
      ) : null}
    </article>
  );
}
