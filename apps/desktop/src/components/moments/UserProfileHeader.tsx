import { useTranslation } from 'react-i18next';
import { Skeleton, Space, Spin, Typography, theme } from 'antd';
import type { Follower, Following } from '../../gen/proto/domain/social/relationship_pb';
import type { PostAuthor } from '../../gen/proto/domain/social/post_pb';
import { FollowButton } from './FollowButton';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { FederatedHandle } from '../FederatedHandle';
import { useActiveMomentsFederationSlice } from './useActiveMomentsStore';

const { Title, Text } = Typography;

// UserProfileHeader — actor identity card used at the top of the
// User profile page and inside follow-list rows.
//
// Sources two viewer signals:
//   - `actor` — the public-shape author info from a Post or
//     dedicated profile fetch.
//   - `viewerActorPtid` — passed down from the page so the
//     embedded FollowButton can hide itself for "this is me".
//
// Stats (followers / following / post count) come from the parent
// since they require separate fetches; we render them with skeleton
// placeholders when not yet available.

interface UserProfileHeaderProps {
  actor: PostAuthor | Follower | Following | null;
  viewerActorPtid?: string;
  followerCount?: number;
  followingCount?: number;
  postCount?: number;
  loading?: boolean;
  refreshing?: boolean;
  /** When provided, renders inline-style header for embedded contexts (e.g. user search). */
  inline?: boolean;
  onAvatarClick?: () => void;
  avatarActionLabel?: string;
}

function actorPtidOf(a: any): string {
  return String(a?.id ?? a?.actorPtid ?? '');
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
// homeStationDomain — present on both PostAuthor and Follower /
// Following since the Tier B social-graph proto extension. Empty for
// pre-backfill rows.
function actorHomeOf(a: any): string | undefined {
  const v = a?.homeStationDomain;
  return v && String(v).length > 0 ? String(v) : undefined;
}

function actorSourceLabel({
  id,
  home,
  selfHome,
  t,
}: {
  id: string;
  home?: string;
  selfHome?: string;
  t: (k: string, options?: Record<string, string>) => string;
}) {
  if (!id) return t('moments.source.unresolved');
  if (home && selfHome && home === selfHome) return t('moments.source.local');
  if (home) return t('moments.source.station', { station: home });
  return t('moments.source.unresolved');
}

export function UserProfileHeader({
  actor,
  viewerActorPtid,
  followerCount,
  followingCount,
  postCount,
  loading,
  refreshing,
  inline,
  onAvatarClick,
  avatarActionLabel,
}: UserProfileHeaderProps) {
  const { t } = useTranslation('moments');
  const { token } = theme.useToken();
  const federationSelf = useActiveMomentsFederationSlice((s) => s.self);

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

  const id = actorPtidOf(actor);
  const display = actorDisplayOf(actor) || t('moments.author.unknown');
  const username = actorUsernameOf(actor);
  const avatar = actorAvatarOf(actor);
  // Resolve `home_station_domain` for the FederatedHandle.
  //
  //   1. First try the actor proto itself — Tier B populates it on
  //      PostAuthor / Follower / Following for any actor (local + remote
  //      cached), so this single read handles every site.
  //
  //   2. Safety net: if the actor row pre-dates the backfill AND this
  //      is the viewer's own profile, fall back to the federation
  //      runtime self-view. Drops to undefined for everyone else,
  //      which renders just "@username".
  const isSelf = Boolean(viewerActorPtid && id && viewerActorPtid === id);
  const home = actorHomeOf(actor) ?? (isSelf ? federationSelf?.home_station_domain : undefined);
  const source = actorSourceLabel({
    id,
    home,
    selfHome: federationSelf?.home_station_domain,
    t,
  });

  return (
    <div
      style={{
        padding: inline ? 8 : 24,
        display: 'flex',
        gap: inline ? 12 : 16,
        alignItems: inline ? 'center' : 'flex-start',
        flexWrap: inline ? 'nowrap' : 'wrap',
        borderBottom: inline ? undefined : `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      {onAvatarClick ? (
        <button
          type="button"
          data-moments-avatar-link
          onClick={onAvatarClick}
          aria-label={avatarActionLabel}
          title={avatarActionLabel}
          style={{
            display: 'inline-flex',
            padding: 0,
            border: 'none',
            borderRadius: inline ? 9 : 16,
            background: 'transparent',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <UserSquareAvatar
            remoteUrl={avatar}
            name={display}
            size={inline ? 36 : 64}
            radius={inline ? 9 : 16}
          />
        </button>
      ) : (
        <UserSquareAvatar
          remoteUrl={avatar}
          name={display}
          size={inline ? 36 : 64}
          radius={inline ? 9 : 16}
        />
      )}
      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
        {inline ? (
          <Space direction="vertical" size={0}>
            <Space size={6}>
              <Text strong>{display}</Text>
              {refreshing && <Spin size="small" aria-label={t('moments.profile.refreshing')} />}
            </Space>
            {username && (
              <FederatedHandle
                localPart={username}
                home={home}
                fontSize={12}
              />
            )}
            <Text type="secondary" style={{ fontSize: 12 }}>
              {source}
            </Text>
          </Space>
        ) : (
          <>
            <Space size={8} align="center">
              <Title level={4} style={{ margin: 0 }}>
                {display}
              </Title>
              {refreshing && <Spin size="small" aria-label={t('moments.profile.refreshing')} />}
            </Space>
            {username && (
              <FederatedHandle
                localPart={username}
                home={home}
                fontSize={13}
              />
            )}
            <Text
              type="secondary"
              style={{ display: 'block', marginTop: 4, fontSize: 12 }}
            >
              {source}
            </Text>
            <Space size={20} wrap style={{ marginTop: 12 }}>
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
          targetActorPtid={id}
          viewerActorPtid={viewerActorPtid}
          compact={inline}
        />
      )}
    </div>
  );
}
