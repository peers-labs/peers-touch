import { useTranslation } from 'react-i18next';
import { Spin, UserProfileHeader as PeerProfileHeader } from '@peers-touch/ui';
import type { Follower, Following } from '../../gen/proto/domain/social/relationship_pb';
import type { PostAuthor } from '../../gen/proto/domain/social/post_pb';
import { MomentRelationshipAction } from './MomentRelationshipAction';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { useActorIdentity } from '../common/useActorIdentity';

interface UserProfileHeaderProps {
  actor: PostAuthor | Follower | Following | null; viewerActorPtid?: string;
  followerCount?: number; followingCount?: number; postCount?: number;
  bio?: string;
  loading?: boolean; refreshing?: boolean; inline?: boolean;
  onAvatarClick?: () => void; avatarActionLabel?: string;
}
/** Profile data/command adapter: names and portraits come from canonical Actor projection. */
export function UserProfileHeader({ actor, viewerActorPtid, followerCount, followingCount,
  postCount, bio, loading, refreshing, inline, onAvatarClick, avatarActionLabel }: UserProfileHeaderProps) {
  const { t } = useTranslation('moments');
  const id = actor ? 'id' in actor ? actor.id : actor.actorPtid : '';
  const identity = useActorIdentity(id, { requireCanonicalProfile: true });
  const name = identity.displayName || t('moments.author.unknown');
  const avatar = <UserSquareAvatar remoteUrl={identity.avatarUrl || undefined} actorPtid={id || null}
    name={name} size={inline ? 36 : 72} radius={inline ? 9 : 20} />;
  return <PeerProfileHeader name={name} station={identity.homeStationName} bio={bio}
    isSelf={identity.isSelf} inline={inline} loading={loading} loadingLabel={t('moments.follow.loading')}
    refreshing={refreshing ? <Spin label={t('moments.profile.refreshing')} /> : undefined}
    avatar={onAvatarClick ? <button type="button" data-moments-avatar-link onClick={onAvatarClick}
      aria-label={avatarActionLabel} className="sk-post-author">{avatar}</button> : avatar}
    statistics={[
      { id: 'posts', label: t('moments.stats.posts'), value: postCount },
      { id: 'followers', label: t('moments.stats.followers'), value: followerCount },
      { id: 'following', label: t('moments.stats.following'), value: followingCount },
    ]}
    actions={id ? <MomentRelationshipAction targetActorPtid={id}
      viewerActorPtid={viewerActorPtid} compact={inline} /> : undefined} />;
}
