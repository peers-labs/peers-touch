import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@lobehub/ui';
import { Card, Dropdown, Space, Typography, theme, message } from 'antd';
import {
  Globe,
  Lock,
  MessageCircle,
  MoreHorizontal,
  UserCheck,
  UsersRound,
  Users,
  Eye,
} from 'lucide-react';
import {
  Audience_Kind,
  RelationshipReason_Kind,
  PostType,
  ReactionKind,
  type FeedObjectExplanation,
  type Post,
  type ReactionSummary,
  type ImageAttachment,
} from '../../gen/proto/domain/social/post_pb';
import type { Comment } from '../../gen/proto/domain/social/comment_pb';
import { ReactionBar } from './ReactionBar';
import { ImageGrid } from './ImageGrid';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { FederatedHandle } from '../FederatedHandle';
import { useFederationStore } from '../../store/federation';

const { Paragraph, Text, Link } = Typography;

// MomentCard — renders a single Post in a feed list.
//
// Anatomy:
//   ┌─────────────────────────────────────────────┐
//   │ [avatar]  display_name @username · 5m       │ ← header
//   │           [audience badge]                  │
//   │                                             │
//   │  Body text here… (truncated to 5 lines      │
//   │  with "Show more" affordance)               │
//   │  [image grid if any]                        │
//   │  [original-post embed if REPOST]            │
//   │                                             │
//   │  👍 12  ❤️ 3   + React  💬 7   ↗ Repost    │
//   └─────────────────────────────────────────────┘
//
// Repost rendering:
//   - The card shows the reposter's wrapper text + a nested embed
//     of the original post. To avoid recursion-depth surprises we
//     render the original at most ONE level deep — repost-of-repost
//     collapses to "Reposted via X" without the chain.

interface MomentCardProps {
  post: Post;
  reactions?: ReactionSummary[];
  explanation?: FeedObjectExplanation;
  viewerActorId?: string;
  surface?: 'home' | 'federated' | 'profile' | 'circle';
  /** Optional click target — opens the detail page when provided. */
  onOpen?: (postId: string) => void;
  /** Click handler for the comment count + composer. */
  onOpenComments?: (postId: string) => void;
  onReact?: (postId: string, kind: ReactionKind) => Promise<void>;
  onUnreact?: (postId: string, kind?: ReactionKind) => Promise<void>;
  onAuthorClick?: (actorId: string) => void;
  commentPreview?: Comment[];
}

function audienceBadge(kind: Audience_Kind, t: (k: string) => string) {
  switch (kind) {
    case Audience_Kind.PUBLIC:
      return { Icon: Globe, label: t('moments.audience.public') };
    case Audience_Kind.FOLLOWERS:
      return { Icon: UserCheck, label: t('moments.audience.followers') };
    case Audience_Kind.SELF:
      return { Icon: Lock, label: t('moments.audience.self') };
    case Audience_Kind.CIRCLE:
      return { Icon: UsersRound, label: t('moments.audience.circle') };
    case Audience_Kind.GROUP:
      return { Icon: Users, label: t('moments.audience.group') };
    case Audience_Kind.CUSTOM_ALLOW:
      return { Icon: Eye, label: t('moments.audience.customAllow') };
    case Audience_Kind.CUSTOM_DENY:
      return { Icon: Eye, label: t('moments.audience.customDeny') };
    default:
      return { Icon: Globe, label: t('moments.audience.public') };
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

function sourceLabel({
  authorId,
  stationDomain,
  selfStationDomain,
  t,
}: {
  authorId?: string;
  stationDomain?: string;
  selfStationDomain?: string;
  t: (k: string, options?: Record<string, string>) => string;
}) {
  if (!authorId) return t('moments.source.unresolved');
  if (stationDomain && selfStationDomain && stationDomain === selfStationDomain) {
    return t('moments.source.local');
  }
  if (stationDomain) return t('moments.source.station', { station: stationDomain });
  return t('moments.source.unresolved');
}

function relativeTime(seconds: bigint | undefined, t: (k: string, options?: Record<string, number>) => string): string {
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
  const c = post.content as any;
  if (!c || !c.case) return [];
  if (c.case === 'imagePost' || c.case === 'locationPost') {
    return c.value?.images ?? [];
  }
  return [];
}

function getRepostOriginal(post: Post): Post | undefined {
  if (post.type !== PostType.REPOST) return undefined;
  const c = post.content;
  if (c?.case === 'repostPost') {
    return c.value?.originalPost as Post | undefined;
  }
  return undefined;
}

export function MomentCard({
  post,
  reactions,
  explanation,
  viewerActorId,
  surface = 'home',
  onOpen,
  onOpenComments,
  onReact,
  onUnreact,
  onAuthorClick,
  commentPreview,
}: MomentCardProps) {
  const { t } = useTranslation('moments');
  const { token } = theme.useToken();
  const selfStationDomain = useFederationStore((s) => s.self?.homeStationDomain);
  const [expanded, setExpanded] = useState(false);
  const [reactionSubmitting, setReactionSubmitting] = useState(false);

  const author = post.author;
  const audience = post.audience;
  const audienceKind = explanation?.audienceExplanation?.kind ?? audience?.kind ?? Audience_Kind.PUBLIC;
  const badge = audienceBadge(audienceKind, t);
  const body = getBodyText(post);
  const images = getImages(post);
  const original = getRepostOriginal(post);
  const longBody = body.length > 320;
  const visibleBody = expanded || !longBody ? body : `${body.slice(0, 320)}…`;
  const commentsCount = Number(post.stats?.commentsCount ?? 0n);
  const visibleComments = (commentPreview ?? []).slice(0, 2);
  const displayName = author?.displayName || author?.username || t('moments.author.unknown');
  const stationDomain = explanation?.source?.stationDomain || author?.homeStationDomain || '';
  const isSelf = Boolean(viewerActorId && author?.id === viewerActorId);
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
  const source = sourceLabel({
    authorId: explanation?.relationshipReason?.actorId || author?.id,
    stationDomain,
    selfStationDomain,
    t,
  });

  const handleReact = async (kind: ReactionKind) => {
    if (reactionSubmitting) return;
    setReactionSubmitting(true);
    try {
      await onReact?.(post.id, kind);
    } catch (err) {
      message.error(String(err));
    } finally {
      setReactionSubmitting(false);
    }
  };

  const handleUnreact = async (kind?: ReactionKind) => {
    if (reactionSubmitting) return;
    setReactionSubmitting(true);
    try {
      await onUnreact?.(post.id, kind);
    } catch (err) {
      message.error(String(err));
    } finally {
      setReactionSubmitting(false);
    }
  };

  return (
    <Card
      style={{
        marginBottom: 10,
        borderColor: token.colorBorderSecondary,
        borderRadius: 16,
        boxShadow: 'none',
        overflow: 'hidden',
      }}
      bodyStyle={{ padding: 0 }}
      hoverable={!!onOpen}
      onClick={() => onOpen?.(post.id)}
    >
      <div style={{ display: 'flex', gap: 12, padding: '14px 16px' }}>
        <div
          onClick={(e) => {
            e?.stopPropagation();
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
            <Space size={6} align="center" wrap style={{ minWidth: 0 }}>
              <Text
                strong
                style={{ cursor: author?.id ? 'pointer' : 'default', fontSize: 14.5 }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (author?.id) onAuthorClick?.(author.id);
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
              <Text type="secondary" style={{ fontSize: 12 }}>
                · {relativeTime(post.createdAt?.seconds, t)}
              </Text>
            </Space>
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'open', label: t('moments.action.openPost') },
                  { key: 'profile', label: t('moments.action.viewProfile'), disabled: !author?.id },
                ],
                onClick: ({ key, domEvent }) => {
                  domEvent.stopPropagation();
                  if (key === 'open') onOpen?.(post.id);
                  if (key === 'profile' && author?.id) onAuthorClick?.(author.id);
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

          <Text
            type="secondary"
            style={{
              display: 'block',
              marginTop: 4,
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            {source} · {reason} · {badge.label}
          </Text>

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
            <div onClick={(e) => e.stopPropagation()}>
              <ImageGrid
                images={images.slice(0, 9)}
                cids={images.slice(0, 9).map((im) => im.url || im.id)}
                audience={audience}
                authorDid={post.authorId || author?.id || null}
              />
            </div>
          )}

          {original && (
            <Card
              size="small"
              style={{
                marginTop: 8,
                background: token.colorBgLayout,
                borderColor: token.colorBorderSecondary,
                borderRadius: 16,
              }}
              bodyStyle={{ padding: 12 }}
            >
              <Space size={6}>
                <UserSquareAvatar
                  remoteUrl={original.author?.avatarUrl || undefined}
                  name={original.author?.displayName || original.author?.username || t('moments.author.unknown')}
                  size={20}
                  radius={5}
                />
                <Text strong style={{ fontSize: 13 }}>
                  {original.author?.displayName || original.author?.username || t('moments.author.unknown')}
                </Text>
              </Space>
              <Paragraph
                style={{ margin: 0, marginTop: 4, fontSize: 13, whiteSpace: 'pre-wrap' }}
              >
                {getBodyText(original)}
              </Paragraph>
            </Card>
          )}

          {(visibleComments.length > 0 || commentsCount > 0) && (
            <div
              style={{
                marginTop: 10,
                padding: '8px 10px',
                borderRadius: 12,
                background: token.colorFillQuaternary,
              }}
              onClick={(e) => e.stopPropagation()}
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

          <div
            style={{
              marginTop: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <ReactionBar
              reactions={reactions ?? post.reactions ?? []}
              loading={reactionSubmitting}
              onReact={handleReact}
              onUnreact={handleUnreact}
            />
            <Space size={4} wrap>
              <Button
                type="text"
                size="small"
                icon={<MessageCircle size={15} />}
                onClick={() => onOpenComments?.(post.id)}
                style={{ color: token.colorTextSecondary }}
              >
                {String(post.stats?.commentsCount ?? 0n)}
              </Button>
            </Space>
          </div>
        </div>
      </div>
    </Card>
  );
}
