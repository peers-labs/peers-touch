import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Space, Typography, theme, message } from 'antd';
import {
  Globe,
  Lock,
  MessageCircle,
  UserCheck,
  UsersRound,
  Users,
  Eye,
} from 'lucide-react';
import {
  Audience_Kind,
  PostType,
  ReactionKind,
  type Post,
  type ReactionSummary,
  type ImageAttachment,
} from '../../gen/proto/domain/social/post_pb';
import type { Comment } from '../../gen/proto/domain/social/comment_pb';
import { ReactionBar } from './ReactionBar';
import { ImageGrid } from './ImageGrid';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { FederatedHandle } from '../FederatedHandle';

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

function relativeTime(seconds: bigint | undefined): string {
  if (!seconds) return '';
  const ms = Number(seconds) * 1000;
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d`;
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
  onOpen,
  onOpenComments,
  onReact,
  onUnreact,
  onAuthorClick,
  commentPreview,
}: MomentCardProps) {
  const { t } = useTranslation('moments');
  const { token } = theme.useToken();
  const [expanded, setExpanded] = useState(false);

  const author = post.author;
  const audience = post.audience;
  const badge = audienceBadge(audience?.kind ?? Audience_Kind.PUBLIC, t);
  const body = getBodyText(post);
  const images = getImages(post);
  const original = getRepostOriginal(post);
  const longBody = body.length > 320;
  const visibleBody = expanded || !longBody ? body : `${body.slice(0, 320)}…`;
  const commentsCount = Number(post.stats?.commentsCount ?? 0n);
  const visibleComments = (commentPreview ?? []).slice(0, 2);

  return (
    <Card
      style={{
        marginBottom: 10,
        borderColor: token.colorBorderSecondary,
        boxShadow: 'none',
      }}
      bodyStyle={{ padding: '14px 16px' }}
      hoverable={!!onOpen}
      onClick={() => onOpen?.(post.id)}
    >
      <div style={{ display: 'flex', gap: 12 }}>
        <div
          onClick={(e) => {
            e?.stopPropagation();
            if (author?.id) onAuthorClick?.(author.id);
          }}
          style={{ cursor: author?.id ? 'pointer' : 'default', flexShrink: 0 }}
        >
          <UserSquareAvatar
            remoteUrl={author?.avatarUrl || undefined}
            name={author?.displayName || author?.username || t('moments.author.unknown')}
            size={40}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Space size={6} align="center" wrap>
            <Text
              strong
              style={{ cursor: author?.id ? 'pointer' : 'default', fontSize: 14 }}
              onClick={(e) => {
                e.stopPropagation();
                if (author?.id) onAuthorClick?.(author.id);
              }}
            >
              {author?.displayName || author?.username || t('moments.author.unknown')}
            </Text>
            {author?.username && (
              <FederatedHandle
                localPart={author.username}
                home={author.homeStationDomain || undefined}
                fontSize={12}
              />
            )}
            <Text type="secondary" style={{ fontSize: 12 }}>
              · {relativeTime(post.createdAt?.seconds)}
            </Text>
            <Text
              type="secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12 }}
            >
              <badge.Icon size={11} />
              {badge.label}
            </Text>
          </Space>

          {body && (
            <Paragraph
              style={{
                marginTop: 8,
                marginBottom: 0,
                whiteSpace: 'pre-wrap',
                lineHeight: 1.65,
              }}
            >
              {visibleBody}
              {longBody && !expanded && (
                <Link
                  onClick={(e: any) => {
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
                background: token.colorFillQuaternary,
                borderColor: token.colorBorderSecondary,
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
                borderRadius: token.borderRadius,
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
                  ? `${t('moments.comment.viewAll', { defaultValue: 'View comments' })} (${commentsCount})`
                  : t('moments.comment.viewAll', { defaultValue: 'View comments' })}
              </Button>
            </div>
          )}

          <div
            style={{
              marginTop: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <ReactionBar
              reactions={reactions ?? post.reactions ?? []}
              onReact={async (k) => {
                try {
                  await onReact?.(post.id, k);
                } catch (err) {
                  message.error(String(err));
                }
              }}
              onUnreact={async (k) => {
                try {
                  await onUnreact?.(post.id, k);
                } catch (err) {
                  message.error(String(err));
                }
              }}
            />
            <Button
              type="text"
              size="small"
              icon={<MessageCircle size={14} />}
              onClick={() => onOpenComments?.(post.id)}
              style={{ color: token.colorTextSecondary }}
            >
              {String(post.stats?.commentsCount ?? 0n)}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
