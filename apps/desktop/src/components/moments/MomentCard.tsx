import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dropdown, Typography, theme, message } from 'antd';
import { ExternalLink, MapPin, MoreHorizontal } from 'lucide-react';
import {
  Audience_Kind,
  RelationshipReason_Kind,
  PostType,
  ReactionKind,
  type FeedObjectExplanation,
  type Post,
  type ImageAttachment,
} from '../../gen/proto/domain/social/post_pb';
import type { Comment } from '../../gen/proto/domain/social/comment_pb';
import { ImageGrid } from './ImageGrid';
import { PrivateMediaGrid } from './PrivateMediaGrid';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { FederatedHandle } from '../FederatedHandle';
import {
  useActiveMomentsFederationSlice,
  useActivePrivateMomentsSlice,
} from './useActiveMomentsStore';
import {
  SocialTrustMeta,
  SocialActionBar,
  SocialPrivateState,
} from './surfaces';

const { Paragraph, Text, Link } = Typography;

// MomentCard — renders a single Post in a feed list.
//
// Refactored for UI Identity:
//   - The outer card border is now just a soft container (no heavy border).
//   - source · reason · audience  →  SocialTrustMeta
//   - reaction picker + count +  "more"  →  SocialActionBar
//
// Anatomy:
//   ┌─────────────────────────────────────────────┐
//   │ [avatar]  display_name @username · 5m       │ ← header
//   │           [SocialTrustMeta: source · reason · audience]
//   │                                             │
//   │  Body text here…                            │
//   │  [image grid if any]                        │
//   │  [original-post embed if REPOST]            │
//   │                                             │
//   │  [SocialActionBar: 👍12  3❤️  💬7   ⋯ ]   │
//   └─────────────────────────────────────────────┘

interface MomentCardProps {
  post: Post;
  reactions?: import('../../gen/proto/domain/social/post_pb').ReactionSummary[];
  explanation?: FeedObjectExplanation;
  viewerActorPtid?: string;
  surface?: 'home' | 'federated' | 'profile' | 'circle';
  onOpen?: (postId: string) => void;
  onOpenComments?: (postId: string) => void;
  onReact?: (postId: string, kind: ReactionKind) => Promise<void>;
  onUnreact?: (postId: string, kind?: ReactionKind) => Promise<void>;
  onAuthorClick?: (actorPtid: string) => void;
  commentPreview?: Comment[];
  embedded?: boolean;
}

function audienceLabel(kind: Audience_Kind, t: (k: string) => string) {
  switch (kind) {
    case Audience_Kind.PUBLIC:
      return t('moments.audience.public');
    case Audience_Kind.FOLLOWERS:
      return t('moments.audience.followers');
    case Audience_Kind.FRIENDS:
      return t('moments.audience.friends');
    case Audience_Kind.SELF:
      return t('moments.audience.self');
    case Audience_Kind.CIRCLE:
      return t('moments.audience.circle');
    case Audience_Kind.GROUP:
      return t('moments.audience.group');
    case Audience_Kind.CUSTOM_ALLOW:
      return t('moments.audience.customAllow');
    case Audience_Kind.CUSTOM_DENY:
      return t('moments.audience.customDeny');
    default:
      return t('moments.audience.public');
  }
}

function reasonLabel({
  audienceKind,
  isSelf,
  hasStation,
  surface,
  t,
}: {
  audienceKind: Audience_Kind;
  isSelf: boolean;
  hasStation: boolean;
  surface: MomentCardProps['surface'];
  t: (k: string) => string;
}) {
  if (isSelf) return t('moments.reason.self');
  if (audienceKind === Audience_Kind.CIRCLE) return t('moments.reason.circle');
  if (surface === 'federated') return t('moments.reason.publicFederated');
  if (surface === 'profile') return t('moments.reason.profileView');
  if (hasStation) return t('moments.reason.remotePublic');
  return t('moments.reason.homeDefault');
}

function protocolReasonLabel({
  kind,
  fallback,
  t,
}: {
  kind?: RelationshipReason_Kind;
  fallback: string;
  t: (k: string) => string;
}) {
  switch (kind) {
    case RelationshipReason_Kind.RELATIONSHIP_REASON_SELF:
      return t('moments.reason.self');
    case RelationshipReason_Kind.RELATIONSHIP_REASON_FOLLOWING:
      return t('moments.reason.following');
    case RelationshipReason_Kind.RELATIONSHIP_REASON_FOLLOWER:
      return t('moments.reason.follower');
    case RelationshipReason_Kind.RELATIONSHIP_REASON_MUTUAL:
      return t('moments.reason.mutual');
    case RelationshipReason_Kind.RELATIONSHIP_REASON_CIRCLE:
      return t('moments.reason.circle');
    case RelationshipReason_Kind.RELATIONSHIP_REASON_MENTIONED:
      return t('moments.reason.mentioned');
    case RelationshipReason_Kind.RELATIONSHIP_REASON_PUBLIC_FEDERATED:
      return t('moments.reason.publicFederated');
    case RelationshipReason_Kind.RELATIONSHIP_REASON_PROFILE_VIEW:
      return t('moments.reason.profileView');
    case RelationshipReason_Kind.RELATIONSHIP_REASON_UNKNOWN:
      return t('moments.reason.unknown');
    default:
      return fallback;
  }
}

function relativeTime(
  seconds: bigint | undefined,
  t: (k: string, options?: Record<string, number>) => string,
): string {
  if (!seconds) return '';
  const ms = Number(seconds) * 1000;
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return t('moments.time.seconds', { count: diffSec });
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t('moments.time.minutes', { count: diffMin });
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return t('moments.time.hours', { count: diffHour });
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return t('moments.time.days', { count: diffDay });
  const date = new Date(ms);
  return date.toLocaleDateString();
}

function getBodyText(post: Post): string {
  const c = post.content;
  if (!c.case) return '';
  switch (c.case) {
    case 'textPost':
    case 'imagePost':
    case 'videoPost':
    case 'linkPost':
    case 'pollPost':
    case 'locationPost':
      return c.value?.text ?? '';
    case 'repostPost':
      return c.value?.comment ?? '';
    default:
      return '';
  }
}

function getImages(post: Post): ImageAttachment[] {
  const c = post.content as unknown as { case?: string; value?: { images?: ImageAttachment[] } };
  if (!c || !c.case) return [];
  if (c.case === 'imagePost' || c.case === 'locationPost') {
    return c.value?.images ?? [];
  }
  return [];
}

function getRepostOriginal(post: Post): Post | undefined {
  if (post.type !== PostType.REPOST) return undefined;
  const c = post.content as unknown as {
    case?: string;
    value?: { originalPost?: Post };
  };
  if (c?.case === 'repostPost') {
    return c.value?.originalPost as Post | undefined;
  }
  return undefined;
}

export function MomentCard({
  post,
  reactions,
  explanation,
  viewerActorPtid,
  surface = 'home',
  onOpen,
  onOpenComments,
  onReact,
  onUnreact,
  onAuthorClick,
  commentPreview,
  embedded,
}: MomentCardProps) {
  const { t } = useTranslation('moments');
  const { token } = theme.useToken();
  const selfStationDomain = useActiveMomentsFederationSlice((s) => s.self?.home_station_domain);
  const {
    privateProjection,
    privatePlatform,
    readPrivateMoment,
    recoverPrivateMoment,
    openPrivateMedia,
    privateReaction,
    retryPrivateReaction,
  } = useActivePrivateMomentsSlice((s) => ({
    privateProjection: s.postsById[post.id],
    privatePlatform: s.platform,
    readPrivateMoment: s.readMoment,
    recoverPrivateMoment: s.recoverMoment,
    openPrivateMedia: s.openMedia,
    privateReaction: s.reactionsByPost[post.id],
    retryPrivateReaction: s.retryReaction,
  }));
  const [expanded, setExpanded] = useState(false);
  const [reactionSubmitting, setReactionSubmitting] = useState(false);

  const author = post.author;
  const audience = post.audience;
  const audienceKind =
    explanation?.audienceExplanation?.kind
    ?? audience?.kind
    ?? Audience_Kind.PUBLIC;
  const isPrivate =
    audienceKind !== Audience_Kind.PUBLIC
    && audienceKind !== Audience_Kind.KIND_UNSPECIFIED;
  const privateState = privateProjection?.state ?? (
    privatePlatform === 'native'
      ? 'LOADING_AUTHORIZED_RESOURCE'
      : 'PRIVATE_UNSUPPORTED_ON_DEVICE'
  );
  const privateBody = privateProjection?.content?.kind === 'REPOST'
    ? privateProjection.content.comment
    : privateProjection?.content?.text ?? '';
  const privateRepost = privateProjection?.content?.kind === 'REPOST'
    ? privateProjection.content
    : undefined;
  const privateLink = privateProjection?.content?.kind === 'LINK'
    ? privateProjection.content
    : undefined;
  const privatePoll = privateProjection?.content?.kind === 'POLL'
    ? privateProjection.content
    : undefined;
  const privateLocation = privateProjection?.content?.kind === 'LOCATION'
    ? privateProjection.content
    : undefined;
  const body = isPrivate ? privateBody : getBodyText(post);
  const images = isPrivate ? [] : getImages(post);
  const original = isPrivate ? undefined : getRepostOriginal(post);
  const visibleReactions = isPrivate && privateProjection?.reactionsHydrated
    ? privateProjection.reactions ?? []
    : reactions ?? post.reactions ?? [];
  const longBody = body.length > 320;
  const visibleBody = expanded || !longBody ? body : `${body.slice(0, 320)}…`;
  const commentsCount = Number(post.stats?.commentsCount ?? 0n);
  const visibleComments = (commentPreview ?? []).slice(0, 2);
  const displayName = author?.displayName || author?.username || t('moments.author.unknown');
  const stationDomain = explanation?.source?.stationDomain || author?.homeStationDomain || '';
  const isSelf = Boolean(viewerActorPtid && author?.id === viewerActorPtid);
  const fallbackReason = reasonLabel({
    audienceKind,
    isSelf,
    hasStation: Boolean(stationDomain),
    surface,
    t,
  });
  const reason = protocolReasonLabel({
    kind: explanation?.relationshipReason?.kind,
    fallback: fallbackReason,
    t,
  });
  const handleReact = async (kind: ReactionKind) => {
    if (reactionSubmitting) return;
    setReactionSubmitting(true);
    try {
      await onReact?.(post.id, kind);
    } catch {
      message.error(t('moments.reaction.status.REACTION_REJECTED'));
    } finally {
      setReactionSubmitting(false);
    }
  };

  const handleUnreact = async (kind?: ReactionKind) => {
    if (reactionSubmitting) return;
    setReactionSubmitting(true);
    try {
      await onUnreact?.(post.id, kind);
    } catch {
      message.error(t('moments.reaction.status.REACTION_REJECTED'));
    } finally {
      setReactionSubmitting(false);
    }
  };

  const handleRetryReaction = async () => {
    if (reactionSubmitting) return;
    setReactionSubmitting(true);
    try {
      await retryPrivateReaction(post.id);
    } catch {
      message.error(t('moments.reaction.retryUnavailable'));
    } finally {
      setReactionSubmitting(false);
    }
  };

  const createdText = relativeTime(post.createdAt?.seconds, t);

  return (
    <div
      onClick={() => onOpen?.(post.id)}
      style={{
        background: embedded ? 'transparent' : token.colorBgContainer,
        border: embedded ? 'none' : `1px solid ${token.colorBorderSecondary}`,
        borderRadius: embedded ? 0 : 14,
        padding: embedded ? 0 : 16,
        cursor: onOpen ? 'pointer' : 'default',
      }}
    >
      <div style={{ display: 'flex', gap: 12 }}>
        <div
          onClick={(e) => {
            e.stopPropagation();
            if (author?.id) onAuthorClick?.(author.id);
          }}
          style={{ cursor: author?.id ? 'pointer' : 'default', flexShrink: 0 }}
        >
          <UserSquareAvatar
            remoteUrl={author?.avatarUrl || undefined}
            name={displayName}
            size={44}
            radius={13}
          />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' }}>
              <Text
                strong
                style={{
                  fontSize: 14.5,
                }}
              >
                {displayName}
              </Text>
              {author?.username && (
                <FederatedHandle
                  localPart={author.username}
                  home={author.homeStationDomain || undefined}
                  fontSize={12}
                />
              )}
              {createdText && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  · {createdText}
                </Text>
              )}
            </div>

            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'open', label: t('moments.action.openPost') },
                ],
                onClick: ({ key, domEvent }) => {
                  domEvent.stopPropagation();
                  if (key === 'open') onOpen?.(post.id);
                },
              }}
            >
              <Button
                type="text"
                size="small"
                icon={<MoreHorizontal size={16} />}
                onClick={(e) => e.stopPropagation()}
              />
            </Dropdown>
          </div>

          <SocialTrustMeta
            source={{
              kind: stationDomain
                ? stationDomain === selfStationDomain
                  ? 'local'
                  : 'remote'
                : 'unknown',
              stationDomain,
            }}
            reason={{ label: reason, kind: explanation?.relationshipReason?.kind }}
            audience={{ kind: audienceKind, label: audienceLabel(audienceKind, t) }}
          />

          {isPrivate && privateState !== 'CONTENT_READY' && (
            <div onClick={(event) => event.stopPropagation()}>
              <SocialPrivateState
                state={privateState}
                revocationReason={privateProjection?.revocationReason}
                compact
                onRetry={() => void readPrivateMoment(post.id)}
                onRecover={() => void recoverPrivateMoment(post.id)}
              />
            </div>
          )}

          {body && (
            <Paragraph
              style={{
                marginTop: 8,
                marginBottom: 0,
                whiteSpace: 'pre-wrap',
                lineHeight: 1.68,
                fontSize: 15,
              }}
            >
              {visibleBody}
              {longBody && !expanded && (
                <Link
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded(true);
                  }}
                  style={{ marginLeft: 4 }}
                >
                  {t('moments.action.showMore')}
                </Link>
              )}
            </Paragraph>
          )}

          {images.length > 0 && (
            <div style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
              <ImageGrid
                cids={images.slice(0, 9).map((im) => im.url || im.id)}
              />
            </div>
          )}

          {isPrivate
            && privateState === 'CONTENT_READY'
            && (
              privateProjection?.content?.kind === 'IMAGE'
              || privateProjection?.content?.kind === 'VIDEO'
            )
            && (
              <div style={{ marginTop: 8 }} onClick={(event) => event.stopPropagation()}>
                <PrivateMediaGrid
                  media={privateProjection.content.media}
                  onOpen={(objectId) => void openPrivateMedia(post.id, objectId)}
                />
              </div>
            )}

          {isPrivate
            && privateState === 'CONTENT_READY'
            && privateRepost
            && (
              <div
                style={{
                  marginTop: 10,
                  paddingLeft: 12,
                  borderLeft: `2px solid ${token.colorBorder}`,
                }}
              >
                <Text strong style={{ fontSize: 13 }}>
                  {privateRepost.sourceAuthorPtid}
                </Text>
                <Paragraph
                  type="secondary"
                  style={{ margin: '4px 0 0', fontSize: 13, whiteSpace: 'pre-wrap' }}
                >
                  {privateRepost.sourceText}
                </Paragraph>
              </div>
            )}

          {isPrivate
            && privateState === 'CONTENT_READY'
            && privateLink
            && (
              <div
                onClick={(event) => event.stopPropagation()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 10,
                  minWidth: 0,
                }}
              >
                <ExternalLink size={15} color={token.colorTextSecondary} />
                <Link
                  href={privateLink.url}
                  target="_blank"
                  rel="noreferrer"
                  ellipsis
                  style={{ minWidth: 0 }}
                >
                  {privateLink.title}
                </Link>
              </div>
            )}

          {isPrivate
            && privateState === 'CONTENT_READY'
            && privatePoll
            && (
              <div style={{ marginTop: 10 }}>
                <Text strong>{privatePoll.question}</Text>
                <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
                  {privatePoll.options.map((option) => (
                    <div
                      key={option}
                      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                    >
                      <span
                        aria-hidden
                        style={{
                          width: 8,
                          height: 8,
                          flex: '0 0 8px',
                          border: `1px solid ${token.colorBorder}`,
                          borderRadius: '50%',
                        }}
                      />
                      <Text>{option}</Text>
                    </div>
                  ))}
                </div>
              </div>
            )}

          {isPrivate
            && privateState === 'CONTENT_READY'
            && privateLocation
            && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  marginTop: 10,
                }}
              >
                <MapPin
                  size={15}
                  color={token.colorTextSecondary}
                  style={{ marginTop: 3, flexShrink: 0 }}
                />
                <div style={{ minWidth: 0 }}>
                  <Text strong>{privateLocation.name}</Text>
                  {privateLocation.address && (
                    <div>
                      <Text type="secondary">{privateLocation.address}</Text>
                    </div>
                  )}
                </div>
              </div>
            )}

          {original && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                marginTop: 8,
                padding: 12,
                background: token.colorBgLayout,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <UserSquareAvatar
                  remoteUrl={original.author?.avatarUrl || undefined}
                  name={
                    original.author?.displayName ||
                    original.author?.username ||
                    t('moments.author.unknown')
                  }
                  size={20}
                  radius={5}
                />
                <Text strong style={{ fontSize: 13 }}>
                  {original.author?.displayName ||
                    original.author?.username ||
                    t('moments.author.unknown')}
                </Text>
              </div>
              <Paragraph style={{ margin: 0, marginTop: 4, fontSize: 13, whiteSpace: 'pre-wrap' }}>
                {getBodyText(original)}
              </Paragraph>
            </div>
          )}

          {!isPrivate && (visibleComments.length > 0 || commentsCount > 0) && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                marginTop: 10,
                padding: '8px 12px',
                borderRadius: 12,
                background: token.colorFillQuaternary,
              }}
            >
              {visibleComments.map((comment) => (
                <div key={comment.id} style={{ fontSize: 13, lineHeight: 1.6 }}>
                  <Text strong style={{ fontSize: 13 }}>
                    {comment.author?.displayName ||
                      comment.author?.username ||
                      t('moments.author.unknown')}
                  </Text>
                  <Text style={{ fontSize: 13 }}> {comment.content}</Text>
                </div>
              ))}
              <Button
                type="link"
                size="small"
                onClick={() => onOpenComments?.(post.id)}
                style={{ padding: 0, height: 22, fontSize: 12 }}
              >
                {commentsCount > visibleComments.length
                  ? `${t('moments.comment.viewAll')} (${commentsCount})`
                  : t('moments.comment.viewAll')}
              </Button>
            </div>
          )}

          <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 10 }}>
            <SocialActionBar
              reactions={visibleReactions}
              commentCount={commentsCount}
              loading={reactionSubmitting}
              onReact={(kind) => handleReact(kind)}
              onUnreact={handleUnreact}
              reactionState={isPrivate ? privateReaction?.state : undefined}
              onRetryReaction={isPrivate ? handleRetryReaction : undefined}
              onOpenComments={() => onOpenComments?.(post.id)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
