import { useTranslation } from 'react-i18next';
import { Avatar, Skeleton, Space, Typography, theme } from 'antd';
import type { Follower, Following } from '../../gen/proto/domain/social/relationship_pb';
import type { PostAuthor } from '../../gen/proto/domain/social/post_pb';
import { FollowButton } from './FollowButton';

const { Title, Text } = Typography;

// UserProfileHeader — actor identity card used at the top of the
// User profile page and inside follow-list rows.
//
// Sources two viewer signals:
//   - `actor` — the public-shape author info from a Post or
//     dedicated profile fetch.
//   - `viewerActorId` — passed down from the page so the
//     embedded FollowButton can hide itself for "this is me".
//
// Stats (followers / following / post count) come from the parent
// since they require separate fetches; we render them with skeleton
// placeholders when not yet available.

interface UserProfileHeaderProps {
  actor: PostAuthor | Follower | Following | null;
  viewerActorId?: string;
  followerCount?: number;
  followingCount?: number;
  postCount?: number;
  loading?: boolean;
  /** When provided, renders inline-style header for embedded contexts (e.g. user search). */
  inline?: boolean;
}

function actorIdOf(a: any): string {
  return String(a?.id ?? a?.actorId ?? '');
}
function actorDisplayOf(a: any): string {
  return String(a?.displayName ?? a?.username ?? '');
}
function actorUsernameOf(a: any): string {
  return String(a?.username ?? '');
}
function actorAvatarOf(a: any): string | undefined {
  return a?.avatarUrl || a?.avatar || undefined;
}

export function UserProfileHeader({
  actor,
  viewerActorId,
  followerCount,
  followingCount,
  postCount,
  loading,
  inline,
}: UserProfileHeaderProps) {
  const { t } = useTranslation('moments');
  const { token } = theme.useToken();

  if (loading || !actor) {
    return (
      <div
        style={{
          padding: inline ? 8 : 24,
          display: 'flex',
          gap: 16,
          alignItems: 'center',
          borderBottom: inline ? undefined : `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Skeleton.Avatar active size={inline ? 36 : 64} />
        <Skeleton paragraph={{ rows: 1 }} active />
      </div>
    );
  }

  const id = actorIdOf(actor);
  const display = actorDisplayOf(actor) || t('moments.author.unknown');
  const username = actorUsernameOf(actor);
  const avatar = actorAvatarOf(actor);

  return (
    <div
      style={{
        padding: inline ? 8 : 24,
        display: 'flex',
        gap: inline ? 12 : 16,
        alignItems: inline ? 'center' : 'flex-start',
        borderBottom: inline ? undefined : `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <Avatar size={inline ? 36 : 64} src={avatar}>
        {display.slice(0, 1).toUpperCase()}
      </Avatar>
      <div style={{ flex: 1, minWidth: 0 }}>
        {inline ? (
          <Space direction="vertical" size={0}>
            <Text strong>{display}</Text>
            {username && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                @{username}
              </Text>
            )}
          </Space>
        ) : (
          <>
            <Title level={4} style={{ margin: 0 }}>
              {display}
            </Title>
            {username && (
              <Text type="secondary" style={{ fontSize: 13 }}>
                @{username}
              </Text>
            )}
            <Space size={20} style={{ marginTop: 12 }}>
              <Text>
                <Text strong style={{ marginRight: 4 }}>
                  {postCount ?? '—'}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('moments.stats.posts')}
                </Text>
              </Text>
              <Text>
                <Text strong style={{ marginRight: 4 }}>
                  {followerCount ?? '—'}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('moments.stats.followers')}
                </Text>
              </Text>
              <Text>
                <Text strong style={{ marginRight: 4 }}>
                  {followingCount ?? '—'}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('moments.stats.following')}
                </Text>
              </Text>
            </Space>
          </>
        )}
      </div>
      {id && (
        <FollowButton
          targetActorId={id}
          viewerActorId={viewerActorId}
          compact={inline}
        />
      )}
    </div>
  );
}
