import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Card, Space, Tag, Typography, theme, message } from 'antd';
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
  PostType,
  ReactionKind,
  type Post,
  type ReactionSummary,
} from '../../gen/proto/domain/social/post_pb';
import { ReactionBar } from './ReactionBar';
import { ImageThumbnail } from './ImageThumbnail';

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
}

function audienceBadge(kind: Audience_Kind, t: (k: string) => string) {
  switch (kind) {
    case Audience_Kind.PUBLIC:
      return { Icon: Globe, label: t('moments.audience.public'), color: 'green' };
    case Audience_Kind.FOLLOWERS:
      return { Icon: UserCheck, label: t('moments.audience.followers'), color: 'blue' };
    case Audience_Kind.SELF:
      return { Icon: Lock, label: t('moments.audience.self'), color: 'default' };
    case Audience_Kind.CIRCLE:
      return { Icon: UsersRound, label: t('moments.audience.circle'), color: 'purple' };
    case Audience_Kind.GROUP:
      return { Icon: Users, label: t('moments.audience.group'), color: 'cyan' };
    case Audience_Kind.CUSTOM_ALLOW:
      return { Icon: Eye, label: t('moments.audience.customAllow'), color: 'gold' };
    case Audience_Kind.CUSTOM_DENY:
      return { Icon: Eye, label: t('moments.audience.customDeny'), color: 'orange' };
    default:
      return { Icon: Globe, label: t('moments.audience.public'), color: 'default' };
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
  const c = post.content as any;
  if (!c || !c.case) return '';
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

function getImages(post: Post): { id: string; url: string }[] {
  const c = post.content as any;
  if (!c || !c.case) return [];
  if (c.case === 'imagePost' || c.case === 'locationPost') {
    const imgs = c.value?.images ?? [];
    return imgs.map((im: any) => ({ id: String(im.id ?? ''), url: String(im.url ?? im.id ?? '') }));
  }
  return [];
}

function getRepostOriginal(post: Post): Post | undefined {
  if (post.type !== PostType.REPOST) return undefined;
  const c = post.content as any;
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

  return (
    <Card
      style={{ marginBottom: 12 }}
      bodyStyle={{ padding: 16 }}
      hoverable={!!onOpen}
      onClick={() => onOpen?.(post.id)}
    >
      <div style={{ display: 'flex', gap: 12 }}>
        <Avatar
          size={40}
          src={author?.avatarUrl || undefined}
          onClick={(e) => {
            e?.stopPropagation();
            if (author?.id) onAuthorClick?.(author.id);
          }}
          style={{ cursor: author?.id ? 'pointer' : 'default', flexShrink: 0 }}
        >
          {(author?.displayName || author?.username || '?').slice(0, 1).toUpperCase()}
        </Avatar>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Space size={8} align="center" wrap>
            <Text
              strong
              style={{ cursor: author?.id ? 'pointer' : 'default' }}
              onClick={(e) => {
                e.stopPropagation();
                if (author?.id) onAuthorClick?.(author.id);
              }}
            >
              {author?.displayName || author?.username || t('moments.author.unknown')}
            </Text>
            {author?.username && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                @{author.username}
              </Text>
            )}
            <Text type="secondary" style={{ fontSize: 12 }}>
              · {relativeTime(post.createdAt?.seconds as any)}
            </Text>
            <Tag
              color={badge.color}
              icon={<badge.Icon size={11} style={{ marginRight: 2 }} />}
              style={{ marginLeft: 4 }}
            >
              {badge.label}
            </Tag>
          </Space>

          {body && (
            <Paragraph style={{ marginTop: 8, marginBottom: 0, whiteSpace: 'pre-wrap' }}>
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
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: images.length === 1 ? '1fr' : 'repeat(3, 1fr)',
                gap: 6,
                marginTop: 8,
              }}
            >
              {images.slice(0, 9).map((im) => (
                <ImageThumbnail key={im.id} cid={im.url || im.id} />
              ))}
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
                <Avatar size={20} src={original.author?.avatarUrl || undefined}>
                  {(original.author?.displayName || '?').slice(0, 1)}
                </Avatar>
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

          <div
            style={{
              marginTop: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
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
            >
              {String(post.stats?.commentsCount ?? 0n)}
            </Button>
            <span style={{ flex: 1 }} />
            <Button
              type="text"
              size="small"
              icon={<MoreHorizontal size={14} />}
              aria-label={t('moments.action.more')}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}
